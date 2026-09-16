import type { Accessor, ParentProps } from "solid-js";
import { createContext, useContext } from "solid-js";
import type { WorkerPoolManager } from "@pierre/diffs/worker";

type DiffHighlightControls = {
  readonly manager: Accessor<WorkerPoolManager | undefined>;
};

const DiffHighlightContext = createContext<DiffHighlightControls>();

/**
 * Undefined outside a provider (tests, non-worker hosts) keeps the diff on the
 * main-thread renderer. The pool is owned by the renderer runtime, not a view.
 */
export function useDiffHighlight(): Accessor<WorkerPoolManager | undefined> {
  return useContext(DiffHighlightContext)?.manager ?? (() => undefined);
}

export function DiffHighlightProvider(
  props: ParentProps<{ readonly manager: Accessor<WorkerPoolManager | undefined> }>,
): ReturnType<typeof DiffHighlightContext.Provider> {
  return (
    <DiffHighlightContext.Provider value={{ manager: props.manager }}>
      {props.children}
    </DiffHighlightContext.Provider>
  );
}
