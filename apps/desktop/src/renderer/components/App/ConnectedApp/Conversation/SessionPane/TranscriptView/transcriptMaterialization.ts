import {
  createComputed,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
} from "solid-js";

type MessageRef = { readonly id: string };

type TranscriptMaterializationOptions = {
  /** Identity of the selected session; a change restarts from the newest rows. */
  readonly sessionID: () => string;
  /** Full SDK-owned message list, oldest first. */
  readonly messages: () => readonly MessageRef[];
  /**
   * Pauses prepending while true. A paused reader keeps the rendered range and
   * its frontier; no older row mounts until the pause clears, so the reader's
   * scroll position and selection cannot move because of materialization.
   */
  readonly paused?: () => boolean;
};

type Frontier = {
  /** Session the frontier belongs to; undefined before the first transition. */
  readonly session: string | undefined;
  /** Oldest rendered message id; undefined only while the history is empty. */
  readonly id: string | undefined;
  /** True once every message of the current session is rendered. */
  readonly complete: boolean;
};

type TranscriptMaterialization = {
  /** Index in `messages` where the rendered range begins; 0 when complete. */
  readonly startIndex: () => number;
  /** Whether older messages are still being prepended. */
  readonly materializing: () => boolean;
};

const INITIAL_SUFFIX = 20;
const BATCH_SIZE = 50;

/** Index of the oldest row of the initial newest suffix; 0 for a short list. */
function suffixStart(list: readonly MessageRef[]): number {
  return Math.max(0, list.length - INITIAL_SUFFIX);
}

/** The initial rendered range for a session: a newest suffix, or the whole list. */
function initialFrontier(session: string, list: readonly MessageRef[]): Frontier {
  const start = suffixStart(list);
  return { session, id: list[start]?.id, complete: start === 0 };
}

/**
 * Reveals a long transcript from its newest messages outward. A cached session
 * can present hundreds of message rows at once, so mounting a small newest
 * suffix and prepending bounded batches per frame keeps each mount and its
 * layout proportional to a batch instead of the full history.
 *
 * The frontier is the oldest rendered message id, kept even when it sits at
 * index 0, so an untouched history is not confused with a missing one. A single
 * transition keeps the frontier consistent for every consumer; `startIndex` and
 * `materializing` are pure reads.
 *
 * A large late prepend (a bulk history drain) under a completed frontier keeps
 * that frontier and batches again instead of mounting the whole history, and
 * `paused` freezes prepending entirely while a reader holds a position or
 * selection. `startIndex` derives from the frontier's actual index, so no
 * consumer can observe the prepended history before the transition runs.
 *
 * Solid re-subscribes a computation after each run, so this memo can execute
 * before the transition when the session and its list arrive in separate
 * updates. `startIndex` therefore re-derives the initial suffix whenever the
 * frontier row is absent, so no consumer can observe a full-history mount for a
 * session whose frontier lags one update. SDK page prepends and newer appends
 * never drop the oldest rendered row, and when the range reaches index 0 the
 * full history is in the ordinary DOM. All scheduling is one cancellable frame
 * owned by the caller's component.
 */
export function createTranscriptMaterialization(
  options: TranscriptMaterializationOptions,
): TranscriptMaterialization {
  const [frontier, setFrontier] = createSignal<Frontier>({
    session: undefined,
    id: undefined,
    complete: true,
  });
  const paused = () => options.paused?.() === true;
  let frame: number | undefined;

  function cancel(): void {
    if (frame === undefined) return;
    cancelAnimationFrame(frame);
    frame = undefined;
  }

  function schedule(session: string): void {
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      advance(session);
    });
  }

  function advance(session: string): void {
    if (options.sessionID() !== session) return;
    if (paused()) return;
    const list = options.messages();
    const current = untrack(frontier);
    if (current.session !== session || current.complete) return;
    const index =
      current.id === undefined ? 0 : list.findIndex((message) => message.id === current.id);
    if (index <= 0) {
      setFrontier({ session, id: list[0]?.id, complete: true });
      return;
    }
    const next = Math.max(0, index - BATCH_SIZE);
    setFrontier({ session, id: list[next]!.id, complete: next === 0 });
  }

  // The single transition point for selection, empty, replacement and
  // completion changes, so every consumer observes one consistent frontier.
  createComputed(() => {
    const session = options.sessionID();
    const list = options.messages();
    const current = untrack(frontier);

    if (current.session !== session) {
      // Selection change: drop queued work and start from the newest rows.
      cancel();
      setFrontier(initialFrontier(session, list));
      return;
    }

    if (list.length === 0) {
      if (current.id !== undefined || !current.complete)
        setFrontier({ session, id: undefined, complete: true });
      return;
    }

    if (current.complete) {
      if (current.id === undefined) {
        // An empty session received its history.
        setFrontier(initialFrontier(session, list));
        return;
      }
      const index = list.findIndex((message) => message.id === current.id);
      if (index < 0) {
        // The previous history was replaced; reveal the new one in batches.
        setFrontier(initialFrontier(session, list));
        return;
      }
      if (index > 0) {
        // Older rows prepended under a completed frontier (for example a bulk
        // history drain). Keep the rendered frontier and batch the prepend, so
        // a large arrival cannot mount the whole history in one update.
        setFrontier({ session, id: current.id, complete: false });
      }
      return;
    }

    // Materializing: a missing frontier means the history was replaced, and an
    // index-0 frontier means older rows were removed under the rendered range.
    const index =
      current.id === undefined ? 0 : list.findIndex((message) => message.id === current.id);
    if (index < 0) {
      setFrontier(initialFrontier(session, list));
      return;
    }
    if (index === 0) setFrontier({ session, id: list[0]!.id, complete: true });
  });

  createEffect(() => {
    const session = options.sessionID();
    const current = frontier();
    if (current.session !== session || current.complete || paused()) {
      cancel();
      return;
    }
    schedule(session);
  });

  onCleanup(cancel);

  // Derived defensively from the current list: a consumer must never observe a
  // range that omits rows it should keep. When the frontier row exists, the
  // start is its actual index even if `complete` still lags the transition
  // (Solid can run this memo before the transition above), so a late prepend
  // cannot transiently expose older rows as fully mounted.
  const startIndex = createMemo(() => {
    const list = options.messages();
    const current = frontier();
    if (current.id === undefined) return suffixStart(list);
    const index = list.findIndex((message) => message.id === current.id);
    if (index < 0) return suffixStart(list);
    return index;
  });

  const materializing = createMemo(() => {
    const current = frontier();
    return current.id !== undefined && !current.complete && !paused();
  });

  return {
    startIndex,
    materializing,
  };
}
