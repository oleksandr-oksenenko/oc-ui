import { Effect } from "effect";

/**
 * Reference-counted tracker for application-owned SDK cache reads. The
 * transcript loader and the session inbox refresh both write SDK caches; the
 * eviction policy must not run while either is in flight, and must reconsider
 * residency once they finish. Notification fires only when a session's last
 * active read settles so a burst resolves to a single reconciliation.
 */
export type SessionReads = {
  readonly active: (sessionID: string) => boolean;
  /** Acquire on execution, release after native cleanup, even on interruption. */
  readonly track: <A, E, R>(
    sessionID: string,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
  readonly onIdleChange: (handler: (sessionID: string) => void) => () => void;
};

export function createSessionReads(): SessionReads {
  const counts = new Map<string, number>();
  const handlers = new Set<(sessionID: string) => void>();
  const begin = (sessionID: string): void => {
    counts.set(sessionID, (counts.get(sessionID) ?? 0) + 1);
  };
  const end = (sessionID: string): void => {
    const remaining = (counts.get(sessionID) ?? 0) - 1;
    if (remaining > 0) {
      counts.set(sessionID, remaining);
      return;
    }
    counts.delete(sessionID);
    for (const handler of handlers) {
      try {
        handler(sessionID);
      } catch (cause) {
        // A policy observer must not turn a settled read into a defect.
        Effect.runSync(Effect.logError("Session read settle observer failed", cause));
      }
    }
  };
  return {
    active: (sessionID) => (counts.get(sessionID) ?? 0) > 0,
    track: (sessionID, effect) =>
      Effect.acquireUseRelease(
        Effect.sync(() => begin(sessionID)),
        () => effect,
        () => Effect.sync(() => end(sessionID)),
      ),
    onIdleChange: (handler) => {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };
}
