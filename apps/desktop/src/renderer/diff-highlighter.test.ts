import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  activeDiffTheme,
  createDiffHighlight,
  DIFF_HIGHLIGHT_INIT_TIMEOUT_MS,
  type DiffThemeName,
} from "./diff-highlighter.ts";

function makePool() {
  const pool = {
    initialized: false,
    working: true,
    resolveInit: (): void => undefined,
    rejectInit: (_error: Error): void => undefined,
    setRenderOptions: vi.fn<(options: { theme: DiffThemeName }) => Promise<void>>(() =>
      Promise.resolve(),
    ),
    terminate: vi.fn<() => void>(),
    isInitialized: (): boolean => pool.initialized,
    isWorkingPool: (): boolean => pool.working,
    initialize: (): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        pool.resolveInit = () => {
          pool.initialized = true;
          resolve();
        };
        pool.rejectInit = (error: Error) => reject(error);
      }),
  };
  return pool;
}

type Pool = ReturnType<typeof makePool>;

function setup(overrides: {
  initialTheme?: "light" | "dark";
  pool?: Pool;
  terminatePool?: ReturnType<typeof vi.fn<() => void>>;
  timeoutMs?: number;
}) {
  const pool = overrides.pool ?? makePool();
  const terminatePool = overrides.terminatePool ?? vi.fn<() => void>();
  const changes: Array<Pool | undefined> = [];
  const controller = createDiffHighlight({
    initialTheme: overrides.initialTheme ?? "light",
    onChange: (next) => changes.push(next),
    createPool: () => pool,
    terminatePool,
    timeoutMs: overrides.timeoutMs ?? DIFF_HIGHLIGHT_INIT_TIMEOUT_MS,
  });
  return { pool, terminatePool, changes, controller };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("activeDiffTheme", () => {
  it("selects the single active theme name", () => {
    expect(activeDiffTheme("light")).toBe("github-light-high-contrast");
    expect(activeDiffTheme("dark")).toBe("github-dark-high-contrast");
  });
});

describe("createDiffHighlight", () => {
  it("publishes the pool immediately and keeps it after successful init", async () => {
    const { pool, terminatePool, changes, controller } = setup({});
    expect(changes).toHaveLength(1);
    expect(changes[0]).toBe(pool);

    pool.resolveInit();
    await Promise.resolve();
    expect(changes).toHaveLength(1);
    expect(terminatePool).not.toHaveBeenCalled();

    controller.dispose();
    expect(terminatePool).toHaveBeenCalledTimes(1);
  });

  it("pushes the active theme to the pool", () => {
    const { pool, controller } = setup({});
    controller.setTheme("dark");
    expect(pool.setRenderOptions).toHaveBeenCalledWith({ theme: "github-dark-high-contrast" });
    controller.setTheme("light");
    expect(pool.setRenderOptions).toHaveBeenLastCalledWith({ theme: "github-light-high-contrast" });
  });

  it("falls back when initialization rejects", async () => {
    const { pool, terminatePool, changes } = setup({});
    pool.rejectInit(new Error("worker failed"));
    await Promise.resolve();
    await Promise.resolve();
    expect(changes).toHaveLength(2);
    expect(changes[0]).toBe(pool);
    expect(changes[1]).toBeUndefined();
    expect(terminatePool).toHaveBeenCalledTimes(1);
  });

  it("falls back when initialization never settles (watchdog)", () => {
    vi.useFakeTimers();
    const { pool, terminatePool, changes } = setup({ timeoutMs: 50 });
    expect(changes).toHaveLength(1);
    vi.advanceTimersByTime(49);
    expect(changes).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(changes).toHaveLength(2);
    expect(changes[0]).toBe(pool);
    expect(changes[1]).toBeUndefined();
    expect(terminatePool).toHaveBeenCalledTimes(1);
  });

  it("falls back when the initialized pool is not working", async () => {
    const pool = makePool();
    pool.working = false;
    const { terminatePool, changes } = setup({ pool });
    pool.resolveInit();
    await Promise.resolve();
    await Promise.resolve();
    expect(changes).toHaveLength(2);
    expect(changes[1]).toBeUndefined();
    expect(terminatePool).toHaveBeenCalledTimes(1);
  });

  it("terminates on dispose and ignores later initialization", async () => {
    const { pool, terminatePool, changes, controller } = setup({});
    controller.dispose();
    pool.resolveInit();
    await Promise.resolve();
    expect(terminatePool).toHaveBeenCalledTimes(1);
    expect(changes).toHaveLength(1);
  });

  it("is a no-op when no pool factory is available", () => {
    const changes: Array<Pool | undefined> = [];
    const controller = createDiffHighlight({
      initialTheme: "light",
      onChange: () => undefined,
    });
    expect(changes).toHaveLength(0);
    expect(() => controller.setTheme("dark")).not.toThrow();
    controller.dispose();
  });

  it("reports the active theme it was constructed with", () => {
    const seen: DiffThemeName[] = [];
    createDiffHighlight({
      initialTheme: "dark",
      onChange: () => undefined,
      createPool: (theme) => {
        seen.push(theme);
        return makePool();
      },
      terminatePool: vi.fn<() => void>(),
    });
    expect(seen).toEqual(["github-dark-high-contrast"]);
  });
});
