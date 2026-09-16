import type { WorkerPoolManager } from "@pierre/diffs/worker";
import { getOrCreateWorkerPoolSingleton, terminateWorkerPoolSingleton } from "@pierre/diffs/worker";

import type { Theme } from "./appearance.ts";

/**
 * Pierre's pool reports initialization failures its own way, but a worker script
 * that fails to load never settles an initialization task at all. Without a
 * watchdog the diff would render no DOM and silently never highlight.
 */
export const DIFF_HIGHLIGHT_INIT_TIMEOUT_MS = 10_000;

export type DiffThemeName = "github-light-high-contrast" | "github-dark-high-contrast";

const LIGHT: DiffThemeName = "github-light-high-contrast";
const DARK: DiffThemeName = "github-dark-high-contrast";

/** Tokenize a single theme: the active one. Pierre tokenizes once per theme entry. */
export function activeDiffTheme(theme: Theme): DiffThemeName {
  return theme === "dark" ? DARK : LIGHT;
}

/** The subset of Pierre's pool that the renderer owns and drives. */
export interface DiffHighlightPool {
  isInitialized(): boolean;
  isWorkingPool(): boolean;
  initialize(): Promise<void>;
  setRenderOptions(options: { readonly theme: DiffThemeName }): Promise<void>;
  terminate(): void;
}

export type DiffHighlightController = {
  readonly setTheme: (theme: Theme) => void;
  readonly dispose: () => void;
};

export type DiffHighlightPoolFactory = (theme: DiffThemeName) => WorkerPoolManager;

/** Browser boundary: without a Worker constructor there is no pool to own. */
export function createDiffHighlightPool(): DiffHighlightPoolFactory | undefined {
  if (!("Worker" in globalThis)) return undefined;
  const cores = navigator.hardwareConcurrency ?? 4;
  const poolSize = Math.max(1, Math.min(4, cores - 1));
  return (theme) =>
    getOrCreateWorkerPoolSingleton({
      poolOptions: {
        workerFactory: () =>
          new Worker(new URL("@pierre/diffs/worker/worker.js", import.meta.url), {
            type: "module",
          }),
        poolSize,
      },
      highlighterOptions: { theme, preferredHighlighter: "shiki-wasm" },
    });
}

/** Renderer-wide owner of the Pierre highlight worker pool. */
export function createDiffHighlight<TPool extends DiffHighlightPool = WorkerPoolManager>(input: {
  readonly initialTheme: Theme;
  readonly onChange: (pool: TPool | undefined) => void;
  readonly createPool?: (theme: DiffThemeName) => TPool;
  readonly terminatePool?: () => void;
  readonly timeoutMs?: number;
}): DiffHighlightController {
  const { initialTheme, onChange, createPool } = input;
  const timeoutMs = input.timeoutMs ?? DIFF_HIGHLIGHT_INIT_TIMEOUT_MS;
  const terminatePool = input.terminatePool ?? (() => terminateWorkerPoolSingleton());
  // Tests and non-worker hosts keep the plain main-thread renderer.
  if (!createPool) {
    return { setTheme: () => undefined, dispose: () => undefined };
  }

  let pool: TPool | undefined;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const fail = (): void => {
    if (disposed) return;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    pool = undefined;
    onChange(undefined);
    terminatePool();
  };

  try {
    pool = createPool(activeDiffTheme(initialTheme));
  } catch {
    pool = undefined;
  }

  if (pool) {
    const starting = pool;
    // Publish immediately so the first highlight is dispatched to a worker rather
    // than blocking the main thread while initialization finishes.
    onChange(starting);
    // oxlint-disable-next-line effecttsgo/global-timers -- Watchdog for a worker that never signals readiness; this module runs outside the Effect runtime.
    timer = setTimeout(() => {
      if (!starting.isInitialized()) fail();
    }, timeoutMs);
    void starting.initialize().then(
      () => {
        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
        if (disposed) return undefined;
        if (!starting.isInitialized() || !starting.isWorkingPool()) fail();
        return undefined;
      },
      () => {
        fail();
        return undefined;
      },
    );
  }

  return {
    setTheme: (theme) => {
      if (disposed || !pool) return;
      // The pool's render options override per-instance theme, so theme changes
      // must be pushed here; this also invalidates the pool's highlight caches.
      void pool.setRenderOptions({ theme: activeDiffTheme(theme) }).catch(() => fail());
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      pool = undefined;
      terminatePool();
    },
  };
}
