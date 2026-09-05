import { Effect, Exit, Scope } from "effect";
import * as toastModule from "@opencode-ai/ui/toast";
import { RegistryContext } from "@effect/atom-solid";
import { withTestWorkspace } from "../../../../../test/workspace.ts";
import { deferred } from "../../../../../test/deferred.ts";
import { sessionFixture } from "../../../../../test/session-fixture.ts";
import type { OpenCodeClient, SessionInfo } from "@opencode-ai/client";
import { createSignal, Show } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { ServerFlowDialogProvider } from "../../../../../ui/ServerFlowDialogProvider.tsx";
import {
  DeleteSessionFlow,
  createDeleteSessionFlow,
  type CreateDeleteSessionFlowInput,
} from "./DeleteSessionFlow.tsx";

const session = (
  id: string,
  directory = "/worktree/src",
  parentID?: string,
  options: { projectID?: string; workspaceID?: string } = {},
): SessionInfo =>
  sessionFixture({
    id,
    parentID,
    title: id,
    projectID: options.projectID ?? "project",
    location: {
      directory,
      workspaceID: options.workspaceID,
    },
  });

const root = session("root");

function setup(
  currentSessions: readonly SessionInfo[] = [root],
  overrides: Partial<CreateDeleteSessionFlowInput> = {},
) {
  const capturedSession = currentSessions[0] ?? root;
  const [sessions, setSessions] = createSignal<readonly SessionInfo[]>(currentSessions);
  const [catalogIDs, setCatalogIDs] = createSignal<readonly string[]>(
    currentSessions.map(({ id }) => id),
  );
  const syncCatalog = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const listWorktrees = vi
    .fn<OpenCodeClient["worktree"]["list"]>()
    .mockResolvedValue([{ directory: "/worktree", strategy: "git" }]);
  const removeSession = vi.fn<OpenCodeClient["session"]["remove"]>().mockResolvedValue(undefined);
  const removeWorktree = vi.fn<OpenCodeClient["worktree"]["remove"]>().mockResolvedValue(undefined);
  const onDeleted = vi.fn<(sessionIDs: readonly string[]) => void>().mockImplementation((ids) => {
    setSessions((current) => current.filter(({ id }) => !ids.includes(id)));
    setCatalogIDs((current) => current.filter((id) => !ids.includes(id)));
  });
  const props: CreateDeleteSessionFlowInput = {
    effects: withTestWorkspace((effects) => effects),
    session: capturedSession,
    subtreeIDs: [capturedSession.id],
    subtreeSessions: [capturedSession],
    sessions,
    sessionIDs: catalogIDs,
    syncCatalog,
    listWorktrees,
    removeSession,
    removeWorktree,
    deletionStatusForSession: () => "ready",
    onDeleted,
    onDismiss: () => undefined,
    ...overrides,
  };
  return {
    props,
    sessions,
    syncCatalog,
    listWorktrees: props.listWorktrees,
    removeSession,
    removeWorktree,
    onDeleted,
  };
}

function findDeleteButton(): HTMLButtonElement {
  const candidate = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === "Delete session",
  );
  if (candidate === undefined) throw new Error("Delete session button was not rendered");
  return candidate;
}

function mount(fixture: ReturnType<typeof setup>) {
  const host = document.createElement("div");
  document.body.append(host);
  const [visible, setVisible] = createSignal(true);
  const onDismiss = vi.fn<() => void>(() => setVisible(false));
  const flow = createDeleteSessionFlow({ ...fixture.props, onDismiss });
  const rootDispose = render(
    () => (
      <RegistryContext.Provider value={fixture.props.effects.registry}>
        <ServerFlowDialogProvider>
          <Show when={visible()}>
            <DeleteSessionFlow flow={flow} />
          </Show>
        </ServerFlowDialogProvider>
      </RegistryContext.Provider>
    ),
    host,
  );
  return {
    get root() {
      return [...document.querySelectorAll<HTMLElement>("[data-dialog-layer]")].at(-1)!;
    },
    get deleteButton() {
      return findDeleteButton();
    },
    onDismiss,
    flow,
    unmountFlow: () => setVisible(false),
    remountFlow: () => setVisible(true),
    dispose: () => {
      rootDispose();
      host.remove();
    },
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("DeleteSessionFlow", () => {
  it("reconnects a remounted view to pending deletion and retains its failure", async () => {
    const fixture = setup();
    const pending = deferred();
    fixture.removeSession.mockReturnValueOnce(pending.promise);
    const mounted = mount(fixture);
    (await vi.waitFor(() => mounted.deleteButton)).click();
    await vi.waitFor(() => expect(fixture.removeSession).toHaveBeenCalledOnce());
    mounted.unmountFlow();
    mounted.remountFlow();
    await vi.waitFor(() => expect(document.body.textContent).toContain("Deleting"));
    mounted.flow.delete();
    expect(fixture.removeSession).toHaveBeenCalledOnce();
    pending.reject(new Error("offline"));
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("The session could not be deleted."),
    );
    expect(fixture.onDeleted).not.toHaveBeenCalled();
    mounted.dispose();
  });

  it("closes the workspace while deletion waits for its owned catalog refresh", async () => {
    const fixture = setup();
    const catalog = fixture.props.effects.runPromise(Effect.never);
    const catalogOutcome = catalog.catch(() => undefined);
    fixture.syncCatalog.mockImplementation(() => catalog);
    const mounted = mount(fixture);
    (await vi.waitFor(() => mounted.deleteButton)).click();
    await vi.waitFor(() => expect(fixture.syncCatalog).toHaveBeenCalledOnce());
    await Effect.runPromise(Scope.close(fixture.props.effects.scope, Exit.void));
    await catalogOutcome;
    expect(fixture.removeSession).not.toHaveBeenCalled();
    mounted.dispose();
  });

  it("reports retained cleanup when the workspace closes after session deletion", async () => {
    const fixture = setup();
    const notify = vi.spyOn(toastModule, "showToast");
    fixture.removeWorktree.mockImplementationOnce(
      (_input, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(new Error("cancelled")), {
            once: true,
          });
        }),
    );
    const mounted = mount(fixture);
    (await vi.waitFor(() => mounted.deleteButton)).click();
    await vi.waitFor(() => expect(fixture.removeWorktree).toHaveBeenCalledOnce());
    await Effect.runPromise(Scope.close(fixture.props.effects.scope, Exit.void));
    expect(fixture.onDeleted).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Session deleted",
        description: expect.stringContaining("/worktree"),
      }),
    );
    mounted.dispose();
    notify.mockRestore();
  });

  it("closes cleanly when its owner unmounts during dismissal", async () => {
    const fixture = setup();
    const mounted = mount(fixture);
    const cancelButton = await vi.waitFor(() => {
      const candidate = [...mounted.root.querySelectorAll<HTMLButtonElement>("button")].find(
        (item) => item.textContent?.trim() === "Cancel",
      );
      if (candidate === undefined) throw new Error("Cancel button was not rendered");
      return candidate;
    });
    cancelButton.click();
    await vi.waitFor(() => expect(document.body.textContent).not.toContain("Delete session?"));
    mounted.dispose();
  });

  it("refreshes before deleting and removes each unused registered Git worktree", async () => {
    const fixture = setup();
    const mounted = mount(fixture);
    const button = await vi.waitFor(() => {
      expect(document.body.textContent).toContain(
        "Unused registered Git worktrees may also be permanently removed, including uncommitted changes.",
      );
      return mounted.deleteButton;
    });
    button.click();
    await vi.waitFor(() => {
      expect(fixture.removeSession).toHaveBeenCalledWith(
        { sessionID: "root" },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(fixture.removeWorktree).toHaveBeenCalledWith(
        {
          projectID: "project",
          directory: "/worktree",
          force: true,
        },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(fixture.onDeleted).toHaveBeenCalledWith(["root"]);
      expect(fixture.syncCatalog).toHaveBeenCalledTimes(2);
    });
    expect(fixture.listWorktrees).toHaveBeenCalledOnce();
    expect(fixture.removeSession.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.removeWorktree.mock.invocationCallOrder[0] ?? 0,
    );
    mounted.dispose();
  });

  it("deduplicates roots and caches one worktree listing per project", async () => {
    const duplicate = session("duplicate", "/worktree/src/deep", "root");
    const second = session("second", "/other/src", "root", { projectID: "other-project" });
    const fixture = setup([root, duplicate, second], {
      subtreeIDs: ["root", "duplicate", "second"],
      subtreeSessions: [root, duplicate, second],
      listWorktrees: vi
        .fn<OpenCodeClient["worktree"]["list"]>()
        .mockImplementation(async ({ projectID }) =>
          projectID === "other-project"
            ? [{ directory: "/other", strategy: "git" }]
            : [{ directory: "/worktree", strategy: "git" }],
        ),
    });
    const mounted = mount(fixture);
    (await vi.waitFor(() => mounted.deleteButton)).click();
    await vi.waitFor(() => expect(fixture.removeWorktree).toHaveBeenCalledTimes(2));
    expect(fixture.removeWorktree).toHaveBeenNthCalledWith(
      1,
      {
        projectID: "project",
        directory: "/worktree",
        force: true,
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fixture.removeWorktree).toHaveBeenNthCalledWith(
      2,
      {
        projectID: "other-project",
        directory: "/other",
        force: true,
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fixture.listWorktrees).toHaveBeenNthCalledWith(
      1,
      { projectID: "project" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fixture.listWorktrees).toHaveBeenNthCalledWith(
      2,
      { projectID: "other-project" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fixture.listWorktrees).toHaveBeenCalledTimes(2);
    mounted.dispose();
  });

  it("continues worktree cleanup after its view closes", async () => {
    const second = session("second", "/other/src", "root");
    const fixture = setup([root, second], {
      subtreeIDs: ["root", "second"],
      subtreeSessions: [root, second],
      listWorktrees: vi.fn<OpenCodeClient["worktree"]["list"]>().mockResolvedValue([
        { directory: "/worktree", strategy: "git" },
        { directory: "/other", strategy: "git" },
      ]),
    });
    const firstRemoval = deferred();
    fixture.removeWorktree.mockImplementationOnce(() => firstRemoval.promise);
    const mounted = mount(fixture);
    (await vi.waitFor(() => mounted.deleteButton)).click();
    await vi.waitFor(() => expect(fixture.removeWorktree).toHaveBeenCalledOnce());
    mounted.dispose();
    firstRemoval.resolve();
    await vi.waitFor(() => expect(fixture.removeWorktree).toHaveBeenCalledTimes(2));
  });

  it("does not let stale cleanup close or unblock a replacement flow", async () => {
    const oldFixture = setup();
    const oldRemoval = deferred();
    oldFixture.removeWorktree.mockImplementationOnce(() => oldRemoval.promise);

    const replacementSession = session("replacement");
    const replacementFixture = setup([replacementSession], {
      session: replacementSession,
      subtreeIDs: [replacementSession.id],
      subtreeSessions: [replacementSession],
    });
    const replacementRemoval = deferred();
    replacementFixture.removeWorktree.mockImplementationOnce(() => replacementRemoval.promise);

    const host = document.createElement("div");
    document.body.append(host);
    const [flow, setFlow] = createSignal<"old" | "replacement">("old");
    const oldFlow = createDeleteSessionFlow(oldFixture.props);
    const replacementFlow = createDeleteSessionFlow(replacementFixture.props);
    const rootDispose = render(
      () => (
        <ServerFlowDialogProvider>
          <Show when={flow() === "old"}>
            <RegistryContext.Provider value={oldFixture.props.effects.registry}>
              <DeleteSessionFlow flow={oldFlow} />
            </RegistryContext.Provider>
          </Show>
          <Show when={flow() === "replacement"}>
            <RegistryContext.Provider value={replacementFixture.props.effects.registry}>
              <DeleteSessionFlow flow={replacementFlow} />
            </RegistryContext.Provider>
          </Show>
        </ServerFlowDialogProvider>
      ),
      host,
    );

    (await vi.waitFor(findDeleteButton)).click();
    await vi.waitFor(() => expect(oldFixture.removeWorktree).toHaveBeenCalledOnce());

    setFlow("replacement");
    await vi.waitFor(() => expect(document.body.textContent).toContain("replacement"));
    (await vi.waitFor(findDeleteButton)).click();
    await vi.waitFor(() => expect(replacementFixture.removeWorktree).toHaveBeenCalledOnce());

    oldRemoval.resolve();
    await Promise.resolve();
    const escape = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
    });
    window.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);

    replacementRemoval.resolve();
    rootDispose();
    host.remove();
  });

  it.each(["/worktree", "/worktree/src/deep", "/worktree/missing/src"])(
    "retains a candidate used by a surviving stored path: %s",
    async (directory) => {
      const survivor = session("survivor", directory, undefined, { projectID: "nested-project" });
      const fixture = setup([root, survivor]);
      const mounted = mount(fixture);
      (await vi.waitFor(() => mounted.deleteButton)).click();
      await vi.waitFor(() => expect(fixture.onDeleted).toHaveBeenCalledOnce());
      expect(fixture.removeWorktree).not.toHaveBeenCalled();
      mounted.dispose();
    },
  );

  it.each([
    { directory: "/old-worktree", removed: true },
    { directory: "/worktree-old/src", removed: true },
    { directory: "/worktree\\old", removed: true },
    { directory: "/worktree/", removed: false },
    { directory: "/worktree/missing/src", removed: false },
  ])(
    "uses the stored path boundary when deciding whether a missing path blocks cleanup: $directory",
    async ({ directory, removed }) => {
      const survivor = session("survivor", directory);
      const fixture = setup([root, survivor]);
      const mounted = mount(fixture);
      (await vi.waitFor(() => mounted.deleteButton)).click();
      await vi.waitFor(() => expect(fixture.onDeleted).toHaveBeenCalledOnce());
      expect(fixture.removeWorktree).toHaveBeenCalledTimes(removed ? 1 : 0);
      expect(fixture.sessions()).toEqual([survivor]);
      mounted.dispose();
    },
  );

  it("skips a primary worktree with omitted strategy and an unregistered path", async () => {
    const primary = session("primary", "/project/src");
    const unregistered = session("unregistered", "/unregistered/src", "primary");
    const fixture = setup([primary, unregistered], {
      session: primary,
      subtreeIDs: ["primary", "unregistered"],
      subtreeSessions: [primary, unregistered],
      listWorktrees: vi
        .fn<OpenCodeClient["worktree"]["list"]>()
        .mockResolvedValue([{ directory: "/project" }, { directory: "/other", strategy: "git" }]),
    });
    const mounted = mount(fixture);
    (await vi.waitFor(() => mounted.deleteButton)).click();
    await vi.waitFor(() => expect(fixture.onDeleted).toHaveBeenCalledOnce());
    expect(fixture.listWorktrees).toHaveBeenCalledOnce();
    expect(fixture.removeWorktree).not.toHaveBeenCalled();
    mounted.dispose();
  });

  it.each([
    { strategy: "git", removed: "/trees/nested" },
    { strategy: "none", removed: undefined },
    { strategy: undefined, removed: undefined },
  ])(
    "selects the closest registered root before applying its strategy ($strategy)",
    async ({ strategy, removed }) => {
      const deleted = session("deleted", "/trees/nested/src");
      const fixture = setup([deleted], {
        session: deleted,
        subtreeIDs: ["deleted"],
        subtreeSessions: [deleted],
        listWorktrees: vi.fn<OpenCodeClient["worktree"]["list"]>().mockResolvedValue([
          { directory: "/trees", strategy: "git" },
          { directory: "/trees/nested", strategy },
        ]),
      });
      const mounted = mount(fixture);
      (await vi.waitFor(() => mounted.deleteButton)).click();
      await vi.waitFor(() => expect(fixture.onDeleted).toHaveBeenCalledOnce());
      expect(vi.mocked(fixture.removeWorktree).mock.calls.map(([input]) => [input])).toEqual(
        removed === undefined ? [] : [[{ projectID: "project", directory: removed, force: true }]],
      );
      mounted.dispose();
    },
  );

  it("retains a candidate used by a nested repository in another project", async () => {
    const survivor = session("survivor", "/worktree/nested-repo/src", undefined, {
      projectID: "nested-project",
    });
    const fixture = setup([root, survivor]);
    const mounted = mount(fixture);
    (await vi.waitFor(() => mounted.deleteButton)).click();
    await vi.waitFor(() => expect(fixture.onDeleted).toHaveBeenCalledOnce());
    expect(fixture.removeWorktree).not.toHaveBeenCalled();
    mounted.dispose();
  });

  it("continues session deletion when worktree discovery fails and retains its path", async () => {
    const listWorktrees = vi
      .fn<OpenCodeClient["worktree"]["list"]>()
      .mockRejectedValueOnce(new Error("offline"));
    const fixture = setup([root], { listWorktrees });
    const mounted = mount(fixture);
    (await vi.waitFor(() => mounted.deleteButton)).click();
    await vi.waitFor(() => expect(fixture.onDeleted).toHaveBeenCalledOnce());
    expect(fixture.removeSession).toHaveBeenCalledWith(
      { sessionID: "root" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fixture.removeWorktree).not.toHaveBeenCalled();
    mounted.dispose();
  });

  it("requires the refreshed catalog to contain every session before deleting", async () => {
    let hydrated = false;
    const fixture = setup([root], {
      sessionIDs: () => (hydrated ? ["root"] : ["root", "still-loading"]),
    });
    const mounted = mount(fixture);
    (await vi.waitFor(() => mounted.deleteButton)).click();
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain(
        "The session records could not be fully loaded. Retry before deleting.",
      ),
    );
    expect(fixture.removeSession).not.toHaveBeenCalled();

    hydrated = true;
    mounted.deleteButton.click();
    await vi.waitFor(() => expect(fixture.removeSession).toHaveBeenCalledOnce());
    mounted.dispose();
  });

  it("continues cleanup after one worktree removal fails", async () => {
    const second = session("second", "/other/src", "root");
    const fixture = setup([root, second], {
      subtreeIDs: ["root", "second"],
      subtreeSessions: [root, second],
      listWorktrees: vi.fn<OpenCodeClient["worktree"]["list"]>().mockResolvedValue([
        { directory: "/worktree", strategy: "git" },
        { directory: "/other", strategy: "git" },
      ]),
    });
    fixture.removeWorktree
      .mockRejectedValueOnce(new Error("busy"))
      .mockResolvedValueOnce(undefined);
    const mounted = mount(fixture);
    (await vi.waitFor(() => mounted.deleteButton)).click();
    await vi.waitFor(() => expect(fixture.removeWorktree).toHaveBeenCalledTimes(2));
    expect(fixture.removeSession).toHaveBeenCalledWith(
      { sessionID: "root" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fixture.onDeleted).toHaveBeenCalledWith(["root", "second"]);
    mounted.dispose();
  });

  it("keeps the session and worktree when session deletion fails, then allows retry", async () => {
    const fixture = setup();
    fixture.removeSession.mockRejectedValueOnce(new Error("offline"));
    const mounted = mount(fixture);
    (await vi.waitFor(() => mounted.deleteButton)).click();
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("The session could not be deleted."),
    );
    expect(fixture.onDeleted).not.toHaveBeenCalled();
    expect(fixture.removeWorktree).not.toHaveBeenCalled();
    mounted.deleteButton.click();
    await vi.waitFor(() => expect(fixture.removeWorktree).toHaveBeenCalledOnce());
    expect(fixture.removeSession).toHaveBeenCalledTimes(2);
    mounted.dispose();
  });

  it.each(["refresh failure", "incomplete records"])(
    "retains the worktree after deletion when the final catalog has %s",
    async (failure) => {
      let refreshed = false;
      const fixture = setup([root], {
        sessionIDs: () => (refreshed ? ["unloaded"] : [root.id]),
      });
      fixture.syncCatalog.mockResolvedValueOnce(undefined).mockImplementationOnce(async () => {
        if (failure === "refresh failure") throw new Error("offline");
        refreshed = true;
      });
      const mounted = mount(fixture);
      (await vi.waitFor(() => mounted.deleteButton)).click();
      await vi.waitFor(() => expect(document.body.textContent).not.toContain("Delete session?"));
      expect(fixture.removeSession).toHaveBeenCalledOnce();
      expect(fixture.onDeleted).toHaveBeenCalledOnce();
      expect(fixture.removeWorktree).not.toHaveBeenCalled();
      mounted.dispose();
    },
  );

  it("rechecks running state when the user confirms", async () => {
    const fixture = setup([root], {
      deletionStatusForSession: () => "running",
    });
    const mounted = mount(fixture);
    (await vi.waitFor(() => mounted.deleteButton)).click();
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain(
        "Wait for this session and its child sessions to finish before deleting.",
      ),
    );
    expect(fixture.removeSession).not.toHaveBeenCalled();
    expect(fixture.removeWorktree).not.toHaveBeenCalled();
    mounted.dispose();
  });

  it("rechecks running state after cleanup discovery", async () => {
    const fixture = setup([root], {
      deletionStatusForSession: vi
        .fn<(sessionID: string) => "ready" | "running" | "removed">()
        .mockReturnValueOnce("ready")
        .mockReturnValue("running"),
    });
    const mounted = mount(fixture);
    (await vi.waitFor(() => mounted.deleteButton)).click();
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain(
        "Wait for this session and its child sessions to finish before deleting.",
      ),
    );
    expect(fixture.removeSession).not.toHaveBeenCalled();
    expect(fixture.onDeleted).not.toHaveBeenCalled();
    mounted.dispose();
  });

  it("keeps a worktree used by an archived nested child session", async () => {
    const archived = {
      ...session("archived", "/worktree/src/deep", "surviving-parent"),
      time: { created: 1, updated: 1, archived: 1 },
    };
    const fixture = setup([root], {
      sessions: () => [archived],
      sessionIDs: () => ["archived"],
    });
    const mounted = mount(fixture);
    (await vi.waitFor(() => mounted.deleteButton)).click();
    await vi.waitFor(() => expect(fixture.onDeleted).toHaveBeenCalledOnce());
    expect(fixture.removeWorktree).not.toHaveBeenCalled();
    mounted.dispose();
  });

  it("finishes cleanup when the session was removed externally", async () => {
    const fixture = setup([], {
      session: root,
      subtreeIDs: ["root"],
      subtreeSessions: [root],
      sessions: () => [],
      sessionIDs: () => [],
      deletionStatusForSession: () => "removed",
    });
    const mounted = mount(fixture);
    (await vi.waitFor(() => mounted.deleteButton)).click();
    await vi.waitFor(() => expect(fixture.removeWorktree).toHaveBeenCalledOnce());
    expect(fixture.removeSession).not.toHaveBeenCalled();
    expect(fixture.removeWorktree).toHaveBeenCalledWith(
      {
        projectID: "project",
        directory: "/worktree",
        force: true,
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    mounted.dispose();
  });

  it("deletes a session in a workspace context without removing its worktree", async () => {
    const workspaceSession = session("workspace-root", "/worktree/src", undefined, {
      workspaceID: "remote",
    });
    const fixture = setup([workspaceSession], {
      session: workspaceSession,
      subtreeIDs: ["workspace-root"],
      subtreeSessions: [workspaceSession],
    });
    const mounted = mount(fixture);
    (await vi.waitFor(() => mounted.deleteButton)).click();
    await vi.waitFor(() => expect(fixture.onDeleted).toHaveBeenCalledOnce());
    expect(fixture.removeWorktree).not.toHaveBeenCalled();
    mounted.dispose();
  });

  it("requires a successful catalog refresh before deleting", async () => {
    const fixture = setup();
    fixture.syncCatalog.mockRejectedValueOnce(new Error("offline"));
    const mounted = mount(fixture);
    const button = await vi.waitFor(() => mounted.deleteButton);
    button.click();
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain(
        "The session catalog could not be refreshed. Retry before deleting.",
      ),
    );
    expect(fixture.removeSession).not.toHaveBeenCalled();
    button.click();
    await vi.waitFor(() => expect(fixture.removeSession).toHaveBeenCalledOnce());
    mounted.dispose();
  });
});
