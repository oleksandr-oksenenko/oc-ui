import type { AgentInfo, LocationRef, SessionInfo } from "@opencode-ai/client";
import { createRoot, createSignal } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";

import { sessionFixture } from "../../../../test/session-fixture.ts";
import { createSessionAgentSelection } from "./createSessionAgentSelection.ts";

const location = { directory: "/workspace", workspaceID: "workspace" } satisfies LocationRef;
const otherLocation = { directory: "/other", workspaceID: "other" } satisfies LocationRef;
type SelectionInput = Parameters<typeof createSessionAgentSelection>[0];
type SelectionApi = SelectionInput["api"];
type SelectionData = SelectionInput["data"];

function agent(
  id: string,
  options: Partial<Pick<AgentInfo, "hidden" | "mode" | "name">> = {},
): AgentInfo {
  return {
    id,
    name: options.name ?? id,
    hidden: options.hidden ?? false,
    mode: options.mode ?? "primary",
    request: { settings: {}, headers: {}, body: {} },
    permissions: [],
  };
}

function session(
  id: string,
  sessionLocation: LocationRef = location,
  agentID?: string,
): SessionInfo {
  return sessionFixture({
    id,
    agent: agentID,
    location: sessionLocation,
  });
}

function setup(
  options: {
    readonly selected?: SessionInfo;
    readonly listed?: AgentInfo[];
    readonly syncAgents?: SelectionData["location"]["agent"]["sync"];
    readonly switchAgent?: SelectionApi["session"]["switchAgent"];
    readonly syncSession?: SelectionData["session"]["sync"];
  } = {},
) {
  return createRoot((dispose) => {
    const [selectedSession, setSelectedSession] = createSignal<SessionInfo | undefined>(
      options.selected,
    );
    const [connected, setConnected] = createSignal(true);
    const [listed, setListed] = createSignal(options.listed ?? []);
    const syncAgents =
      options.syncAgents ??
      vi.fn<SelectionData["location"]["agent"]["sync"]>(() => Promise.resolve());
    const listAgents = vi.fn<SelectionData["location"]["agent"]["list"]>(() => listed());
    const switchAgent = vi.fn<SelectionApi["session"]["switchAgent"]>(
      options.switchAgent ?? (() => Promise.resolve()),
    );
    const syncSession = vi.fn<SelectionData["session"]["sync"]>(
      options.syncSession ?? (() => Promise.resolve()),
    );
    const invalidateSession = vi.fn<SelectionData["session"]["invalidate"]>();
    const selection = createSessionAgentSelection({
      api: { session: { switchAgent } },
      data: {
        location: { agent: { list: listAgents, sync: syncAgents } },
        session: { invalidate: invalidateSession, sync: syncSession },
      },
      selectedSession,
      connected,
    });
    return {
      dispose,
      selection,
      setSelectedSession,
      setConnected,
      setListed,
      syncAgents,
      listAgents,
      switchAgent,
      invalidateSession,
      syncSession,
    };
  });
}

describe("createSessionAgentSelection", () => {
  it("syncs the complete selected location and lets lifecycle refresh after reconnect", async () => {
    const fixture = setup({ selected: session("one", location), listed: [agent("primary")] });

    await vi.waitFor(() => expect(fixture.syncAgents).toHaveBeenCalledWith(location));
    expect(fixture.listAgents).toHaveBeenCalledWith(location);

    fixture.setConnected(false);
    await Promise.resolve();
    fixture.setConnected(true);
    expect(fixture.syncAgents).toHaveBeenCalledTimes(1);
    await fixture.selection.sync();
    await vi.waitFor(() => expect(fixture.syncAgents).toHaveBeenCalledTimes(2));

    fixture.setSelectedSession(session("two", otherLocation));
    await vi.waitFor(() => expect(fixture.syncAgents).toHaveBeenCalledWith(otherLocation));
    fixture.dispose();
  });

  it("shows unavailable when selection changes offline, then refreshes through lifecycle", async () => {
    const fixture = setup({ selected: session("one"), listed: [agent("primary")] });
    await vi.waitFor(() => expect(fixture.selection.state()).toBe("ready"));

    fixture.setConnected(false);
    fixture.setSelectedSession(session("two", otherLocation));
    await vi.waitFor(() => expect(fixture.selection.state()).toBe("failed"));
    expect(fixture.selection.error()).toBeUndefined();
    expect(fixture.syncAgents).toHaveBeenCalledOnce();

    fixture.setConnected(true);
    await fixture.selection.sync();
    expect(fixture.selection.state()).toBe("ready");
    expect(fixture.syncAgents).toHaveBeenCalledWith(otherLocation);
    fixture.dispose();
  });

  it("filters hidden and subagent entries without inventing a default", async () => {
    const fixture = setup({
      selected: session("one"),
      listed: [
        agent("hidden", { hidden: true }),
        agent("subagent", { mode: "subagent" }),
        agent("primary", { name: "Primary" }),
        agent("all", { mode: "all", name: "All" }),
      ],
    });

    await vi.waitFor(() => expect(fixture.selection.state()).toBe("ready"));
    expect(fixture.selection.agents()).toEqual([
      { id: "primary", label: "Primary" },
      { id: "all", label: "All" },
    ]);
    expect(fixture.selection.selectedAgentID()).toBeUndefined();

    fixture.setSelectedSession(session("one", location, "subagent"));
    await vi.waitFor(() => expect(fixture.selection.state()).toBe("ready"));
    expect(fixture.selection.selectedAgentID()).toBe("subagent");
    fixture.dispose();
  });

  it("projects live updates from the shared location agent cache", async () => {
    const fixture = setup({ selected: session("one"), listed: [agent("primary")] });
    await vi.waitFor(() => expect(fixture.selection.state()).toBe("ready"));
    expect(fixture.selection.agents()).toEqual([{ id: "primary", label: "primary" }]);

    fixture.setListed([
      agent("primary", { hidden: true }),
      agent("review", { mode: "all", name: "Review" }),
    ]);

    expect(fixture.selection.agents()).toEqual([{ id: "review", label: "Review" }]);
    fixture.dispose();
  });

  it("keeps an explicit valid selection and reconciles a valid switch through the server", async () => {
    const fixture = setup({
      selected: session("one", location, "primary"),
      listed: [agent("primary"), agent("all", { mode: "all" })],
    });
    await vi.waitFor(() => expect(fixture.selection.state()).toBe("ready"));

    fixture.syncSession.mockImplementationOnce(async () => {
      fixture.setSelectedSession(session("one", location, "all"));
    });
    await fixture.selection.selectAgent("all");

    expect(fixture.switchAgent).toHaveBeenCalledWith({ sessionID: "one", agent: "all" });
    expect(fixture.invalidateSession).toHaveBeenCalledWith("one");
    expect(fixture.syncSession).toHaveBeenCalledWith("one");
    expect(fixture.selection.selectedAgentID()).toBe("all");
    expect(fixture.selection.switching()).toBe(false);
    fixture.dispose();
  });

  it("ignores IDs that are not visible server choices", async () => {
    const fixture = setup({ selected: session("one"), listed: [agent("primary")] });
    await vi.waitFor(() => expect(fixture.selection.state()).toBe("ready"));

    await fixture.selection.selectAgent("invented");

    expect(fixture.switchAgent).not.toHaveBeenCalled();
    expect(fixture.syncSession).not.toHaveBeenCalled();
    fixture.dispose();
  });

  it("scopes switch failures to the session that initiated them", async () => {
    let rejectSwitch!: (cause: Error) => void;
    const switchAgent = vi.fn<SelectionApi["session"]["switchAgent"]>(
      () => new Promise<void>((_, reject) => (rejectSwitch = reject)),
    );
    const fixture = setup({
      selected: session("one"),
      listed: [agent("primary")],
      switchAgent,
    });
    await vi.waitFor(() => expect(fixture.selection.state()).toBe("ready"));

    const switching = fixture.selection.selectAgent("primary");
    fixture.setSelectedSession(session("two"));
    await vi.waitFor(() => expect(fixture.syncAgents).toHaveBeenCalledWith(location));
    rejectSwitch(new Error("offline"));
    await switching;

    expect(fixture.selection.error()).toBeUndefined();
    fixture.dispose();
  });

  it("keeps an active switch scoped through same-session metadata updates", async () => {
    let rejectSwitch!: (cause: Error) => void;
    const switchAgent = vi.fn<SelectionApi["session"]["switchAgent"]>(
      () => new Promise<void>((_, reject) => (rejectSwitch = reject)),
    );
    const fixture = setup({
      selected: session("one"),
      listed: [agent("primary")],
      switchAgent,
    });
    await vi.waitFor(() => expect(fixture.selection.state()).toBe("ready"));

    const switching = fixture.selection.selectAgent("primary");
    fixture.setSelectedSession({ ...session("one"), title: "Updated title" });
    rejectSwitch(new Error("offline"));
    await switching;

    expect(fixture.syncAgents).toHaveBeenCalledOnce();
    expect(fixture.selection.error()).toBe("The agent could not be changed. Try again.");
    fixture.dispose();
  });

  it("does not let a stale load failure replace the current session state", async () => {
    let rejectFirst!: (cause: Error) => void;
    const syncAgents = vi
      .fn<SelectionData["location"]["agent"]["sync"]>()
      .mockResolvedValue(undefined)
      .mockImplementationOnce(() => new Promise<void>((_, reject) => (rejectFirst = reject)));
    const fixture = setup({
      selected: session("one", location),
      listed: [agent("primary")],
      syncAgents,
    });
    await vi.waitFor(() => expect(syncAgents).toHaveBeenCalledTimes(1));

    fixture.setSelectedSession(session("two", otherLocation));
    await vi.waitFor(() => expect(syncAgents).toHaveBeenCalledTimes(2));
    rejectFirst(new Error("old location failed"));
    await Promise.resolve();
    expect(fixture.selection.error()).toBeUndefined();
    fixture.dispose();
  });

  it("serializes duplicate switches for one session and reports refresh failures", async () => {
    let resolveSwitch!: () => void;
    const switchAgent = vi.fn<SelectionApi["session"]["switchAgent"]>(
      () => new Promise<void>((resolve) => (resolveSwitch = resolve)),
    );
    const syncSession = vi.fn<SelectionData["session"]["sync"]>(() =>
      Promise.reject(new Error("refresh failed")),
    );
    const fixture = setup({
      selected: session("one"),
      listed: [agent("primary")],
      switchAgent,
      syncSession,
    });
    await vi.waitFor(() => expect(fixture.selection.state()).toBe("ready"));

    const first = fixture.selection.selectAgent("primary");
    await fixture.selection.selectAgent("primary");
    expect(switchAgent).toHaveBeenCalledOnce();
    expect(fixture.selection.switching()).toBe(true);
    resolveSwitch();
    await first;

    expect(fixture.selection.switching()).toBe(false);
    expect(fixture.selection.error()).toBe(
      "The agent changed, but its current value could not be refreshed.",
    );
    fixture.dispose();
  });
});
