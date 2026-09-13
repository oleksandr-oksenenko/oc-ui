import type { SessionInboxUser } from "@opencode-ai/client";
import { useAtomValue } from "@effect/atom-solid";
import { Effect, Semaphore } from "effect";
import { Atom } from "effect/unstable/reactivity";
import type { Accessor } from "solid-js";
import type { ConnectedRuntime } from "../../../../opencode/runtime.ts";
import type { WorkspaceOwner } from "../../../../workspace-owner.ts";

/** The SDK owns inbox contents. The workspace owns mutation settlement and errors. */
export function createSessionInbox(input: {
  readonly effects: WorkspaceOwner;
  readonly data: { readonly session: Pick<ConnectedRuntime["data"]["session"], "pending"> };
  readonly api: { readonly session: Pick<ConnectedRuntime["api"]["session"], "inbox"> };
  readonly selectedID: Accessor<string | undefined>;
  readonly connected: Accessor<boolean>;
}) {
  const { effects } = input;
  const state = Atom.make<{
    active: boolean;
    error?: { sessionID: string; message: string };
  }>({ active: false });
  effects.mount(state);
  const current = useAtomValue(() => state);
  const gate = Semaphore.makeUnsafe(1);
  const messages = (): readonly SessionInboxUser[] => {
    const id = input.selectedID();
    return id === undefined
      ? []
      : input.data.session.pending.list(id).filter((item) => item.type === "user");
  };
  const refresh = Effect.fn("SessionInbox.refresh")(function* (sessionID: string) {
    input.data.session.pending.invalidate(sessionID);
    yield* effects.request(() => input.data.session.pending.sync(sessionID));
  });
  const reportError = (sessionID: string, message: string) =>
    Effect.sync(() => {
      effects.registry.set(state, { active: true, error: { sessionID, message } });
    });
  const run = (action?: "cancel" | "steer", inboxID?: string): Promise<void> => {
    const sessionID = input.selectedID();
    if (!sessionID || !input.connected()) return Promise.resolve();
    if (action && !messages().some((item) => item.id === inboxID)) return Promise.resolve();
    return effects.runPromise(
      Effect.gen(function* () {
        effects.registry.set(state, { active: true });
        if (action && inboxID) {
          yield* effects
            .request((signal) =>
              input.api.session.inbox[action]({ sessionID, inboxID }, { signal }),
            )
            .pipe(
              Effect.catch(() =>
                reportError(
                  sessionID,
                  `Couldn't confirm ${action === "cancel" ? "cancellation" : "steering"}. The message may already have been delivered.`,
                ),
              ),
            );
        }
        yield* refresh(sessionID).pipe(
          Effect.catch(() =>
            reportError(
              sessionID,
              "Couldn't refresh pending messages. Refresh before trying again.",
            ),
          ),
        );
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            effects.registry.set(state, { ...effects.registry.get(state), active: false });
          }),
        ),
        gate.withPermitsIfAvailable(1),
        Effect.asVoid,
      ),
    );
  };
  return {
    messages,
    busy: () => current().active,
    error: () =>
      current().error?.sessionID === input.selectedID() ? current().error?.message : undefined,
    cancel: (id: string) => run("cancel", id),
    steer: (id: string) => run("steer", id),
    refresh: () => run(),
  };
}

export type SessionInboxController = ReturnType<typeof createSessionInbox>;
