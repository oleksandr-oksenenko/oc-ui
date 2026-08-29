import type { Data } from "@opencode-ai/client/solid";
import type { OpenCodeClient, SessionInfo } from "@opencode-ai/client";
import { createEffect, createMemo, createSignal, on, onCleanup, type Accessor } from "solid-js";

type SessionAgentSelectionInput = {
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

/** Owns the location-scoped agent catalog and selected session agent. */
export function createSessionAgentSelection(
  input: SessionAgentSelectionInput,
): SessionAgentSelectionController {
  const [state, setState] = createSignal<SessionAgentSelectionState>("loading");
  const [loadError, setLoadError] = createSignal<string>();
  const [switchError, setSwitchError] = createSignal<{
    readonly sessionID: string;
    readonly selection: number;
    readonly message: string;
  }>();
  const [switchingIDs, setSwitchingIDs] = createSignal<ReadonlySet<string>>(new Set());
  let selection = 0;
  let loadRun = 0;
  let alive = true;

  onCleanup(() => {
    alive = false;
    selection += 1;
    loadRun += 1;
  });

  const visibleAgents = createMemo(() => {
    void state();
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
    return sessionID !== undefined && switchingIDs().has(sessionID);
  });
  const error = createMemo(() => {
    if (state() === "failed") return loadError();
    const sessionID = input.selectedSession()?.id;
    const failure = switchError();
    return sessionID !== undefined &&
      failure?.sessionID === sessionID &&
      failure.selection === selection
      ? failure.message
      : undefined;
  });

  const isSelected = (sessionID: string, run: number): boolean =>
    alive && run === selection && input.connected() && input.selectedSession()?.id === sessionID;

  const load = async (session: SessionInfo, run: number): Promise<void> => {
    try {
      await input.data.location.agent.sync(session.location);
      if (!alive || run !== loadRun || !input.connected()) return;
      setState("ready");
    } catch {
      if (!alive || run !== loadRun || !input.connected()) return;
      setState("failed");
      setLoadError(LOAD_FAILURE_MESSAGE);
    }
  };

  const sync = async (): Promise<void> => {
    const session = input.selectedSession();
    const run = ++loadRun;
    setLoadError(undefined);

    if (!session) {
      setState("ready");
      return;
    }

    if (!input.connected()) {
      setState("failed");
      return;
    }
    setState("loading");
    await load(session, run);
  };

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
      selection += 1;
      setSwitchError(undefined);
      void sync();
    }),
  );

  const selectAgent = async (agentID: string): Promise<void> => {
    const session = input.selectedSession();
    const agent = visibleAgents().find((candidate) => candidate.id === agentID);
    if (!session || !agent || switchingIDs().has(session.id)) return;

    const sessionID = session.id;
    const switchSelection = selection;
    setSwitchError(undefined);
    setSwitchingIDs((current) => new Set(current).add(sessionID));
    try {
      try {
        await input.api.session.switchAgent({ sessionID, agent: agent.id });
      } catch {
        if (isSelected(sessionID, switchSelection)) {
          setSwitchError({
            sessionID,
            selection: switchSelection,
            message: SWITCH_FAILURE_MESSAGE,
          });
        }
        return;
      }

      try {
        input.data.session.invalidate(sessionID);
        await input.data.session.sync(sessionID);
      } catch {
        if (isSelected(sessionID, switchSelection)) {
          setSwitchError({
            sessionID,
            selection: switchSelection,
            message: SYNC_FAILURE_MESSAGE,
          });
        }
      }
    } finally {
      setSwitchingIDs((current) => {
        const next = new Set(current);
        next.delete(sessionID);
        return next;
      });
    }
  };

  return { state, error, switching, agents, selectedAgentID, sync, selectAgent };
}
