import { useAtomValue } from "@effect/atom-solid";
import { Cause, Effect, Fiber } from "effect";
import { Atom } from "effect/unstable/reactivity";
import type { WorkspaceOwner } from "../../../../workspace-owner.ts";
import type { Data } from "@opencode/client/solid";
import type { OpenCodeClient, SessionInfo } from "@opencode/client";
import { createEffect, createMemo, on, onCleanup, type Accessor } from "solid-js";

type SessionAgentSelectionInput = {
  readonly effects: WorkspaceOwner;
  readonly api: {
    readonly session: Pick<OpenCodeClient["session"], "switchAgent">;
  };
  readonly data: {
    readonly location: {
      readonly agent: Pick<Data["location"]["agent"], "list" | "sync">;
    };
    readonly session: Pick<Data["session"], "invalidate" | "sync">;
  };
  readonly selectedSession: Accessor<SessionInfo | undefined>;
  readonly connected: Accessor<boolean>;
};

type SessionAgentSelectionState = "loading" | "ready" | "failed";

type SessionAgentChoice = {
  readonly id: string;
  readonly label: string;
};

export type SessionAgentSelectionController = {
  readonly state: Accessor<SessionAgentSelectionState>;
  readonly error: Accessor<string | undefined>;
  readonly switching: Accessor<boolean>;
  readonly agents: Accessor<readonly SessionAgentChoice[]>;
  readonly selectedAgentID: Accessor<string | undefined>;
  readonly sync: () => Promise<void>;
  readonly selectAgent: (agentID: string) => Promise<void>;
};

const LOAD_FAILURE_MESSAGE = "Agents could not be loaded. Check the connection and try again.";
const SWITCH_FAILURE_MESSAGE = "The agent could not be changed. Try again.";
const SYNC_FAILURE_MESSAGE = "The agent changed, but its current value could not be refreshed.";

/** Owns loading and mutation workflows for SDK-backed agent selection. */
export function createSessionAgentSelection(
  input: SessionAgentSelectionInput,
): SessionAgentSelectionController {
  const { effects } = input;
  const status = Atom.make<{
    state: SessionAgentSelectionState;
    loadError?: string;
    switchError?: { sessionID: string; message: string };
    switchingIDs: ReadonlySet<string>;
  }>({ state: "loading", switchingIDs: new Set<string>() });
  effects.mount(status);
  const current = useAtomValue(() => status);
  const state = createMemo(() => current().state);
  const update = (patch: Partial<Atom.Type<typeof status>>) => {
    effects.registry.set(status, { ...effects.registry.get(status), ...patch });
  };
  const read = effects.latest();
  let selection: object | undefined = {};
  onCleanup(() => {
    selection = undefined;
    read.cancel();
  });

  const visibleAgents = createMemo(() => {
    state();
    const session = input.selectedSession();
    return (
      (session ? input.data.location.agent.list(session.location) : undefined)?.filter(
        (agent) => !agent.hidden && agent.mode !== "subagent",
      ) ?? []
    );
  });
  const agents = createMemo<readonly SessionAgentChoice[]>(() =>
    visibleAgents().map((agent) => ({ id: agent.id, label: agent.name })),
  );
  const selectedAgentID = createMemo(() => input.selectedSession()?.agent);
  const switching = createMemo(() => {
    const sessionID = input.selectedSession()?.id;
    return sessionID !== undefined && current().switchingIDs.has(sessionID);
  });
  const error = createMemo(() => {
    const value = current();
    if (value.state === "failed") return value.loadError;
    return value.switchError?.sessionID === input.selectedSession()?.id
      ? value.switchError?.message
      : undefined;
  });

  const refresh = Effect.fn("agentSelection.refresh")(function* () {
    const session = input.selectedSession();
    update({ loadError: undefined });
    if (!session) {
      update({ state: "ready" });
      return;
    }
    if (!input.connected()) {
      update({ state: "failed" });
      return;
    }
    update({ state: "loading" });
    yield* effects
      .request(() => input.data.location.agent.sync(session.location))
      .pipe(
        Effect.match({
          onSuccess: () => update({ state: "ready" }),
          onFailure: () => update({ state: "failed", loadError: LOAD_FAILURE_MESSAGE }),
        }),
      );
  });
  const startRefresh = () => read.run(selection ? refresh() : Effect.void);
  const sync = (): Promise<void> =>
    effects.runPromise(
      Fiber.join(startRefresh()).pipe(
        Effect.catchCauseIf(Cause.hasInterruptsOnly, () => Effect.void),
      ),
    );

  const selectedContext = createMemo(() => {
    const session = input.selectedSession();
    return session
      ? JSON.stringify([
          session.id,
          session.location.directory,
          session.location.workspaceID ?? null,
        ])
      : undefined;
  });

  createEffect(
    on(selectedContext, () => {
      selection = {};
      update({ switchError: undefined });
      startRefresh();
    }),
  );
  createEffect(
    on(input.connected, (connected) => {
      if (!connected) read.cancel();
    }),
  );

  const selectAgent = Effect.fn("agentSelection.select")(function* (agentID: string) {
    const session = input.selectedSession();
    const agent = visibleAgents().find((candidate) => candidate.id === agentID);
    const initiatingSelection = selection;
    if (
      !initiatingSelection ||
      !session ||
      !agent ||
      effects.registry.get(status).switchingIDs.has(session.id)
    )
      return;
    const sessionID = session.id;
    update({
      switchError: undefined,
      switchingIDs: new Set(effects.registry.get(status).switchingIDs).add(sessionID),
    });
    const report = (message: string) => {
      if (selection === initiatingSelection && input.connected()) {
        update({ switchError: { sessionID, message } });
      }
    };
    yield* Effect.gen(function* () {
      const switched = yield* effects
        .request((signal) =>
          input.api.session.switchAgent({ sessionID, agent: agent.id }, { signal }),
        )
        .pipe(
          Effect.match({
            onSuccess: () => true,
            onFailure: () => {
              report(SWITCH_FAILURE_MESSAGE);
              return false;
            },
          }),
        );
      if (!switched) return;
      yield* effects
        .request(() => {
          input.data.session.invalidate(sessionID);
          return input.data.session.sync(sessionID);
        })
        .pipe(Effect.catch(() => Effect.sync(() => report(SYNC_FAILURE_MESSAGE))));
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          const next = new Set(effects.registry.get(status).switchingIDs);
          next.delete(sessionID);
          update({ switchingIDs: next });
        }),
      ),
    );
  });

  return {
    state,
    error,
    switching,
    agents,
    selectedAgentID,
    sync,
    selectAgent: (agentID) => effects.runPromise(selectAgent(agentID)),
  };
}
