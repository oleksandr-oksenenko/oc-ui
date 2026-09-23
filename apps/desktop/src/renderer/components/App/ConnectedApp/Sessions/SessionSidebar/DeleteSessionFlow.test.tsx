import { Effect, Exit, Scope } from "effect";
import { RegistryContext } from "@effect/atom-solid";
import { withTestWorkspace } from "../../../../../test/workspace.ts";
import { deferred } from "../../../../../test/deferred.ts";
import { sessionFixture } from "../../../../../test/session-fixture.ts";
import type { OpenCodeClient, SessionInfo } from "@opencode/client";
import { createSignal, Show } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { ServerFlowDialogProvider } from "../../../../../ui/ServerFlowDialogProvider.tsx";
import {
  DeleteSessionFlow,
  createDeleteSessionFlow,
  type CreateDeleteSessionFlowInput,
} from "./DeleteSessionFlow.tsx";

const session = (id: string, parentID?: string): SessionInfo =>
  sessionFixture({
    id,
    parentID,
    title: id,
    location: { directory: "/srv/project/src" },
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
  const removeSession = vi.fn<OpenCodeClient["session"]["remove"]>().mockResolvedValue(undefined);
  const onDeleted = vi.fn<(sessionIDs: readonly string[]) => void>().mockImplementation((ids) => {
    setSessions((current) => current.filter(({ id }) => !ids.includes(id)));
    setCatalogIDs((current) => current.filter((id) => !ids.includes(id)));
  });
  const props: CreateDeleteSessionFlowInput = {
    effects: withTestWorkspace((effects) => effects),
    session: capturedSession,
    subtreeIDs: [capturedSession.id],
    sessions,
    sessionIDs: catalogIDs,
    syncCatalog,
    removeSession,
    deletionStatusForSession: () => "ready",
    onDeleted,
    onDismiss: () => undefined,
    ...overrides,
  };
  const addSession = (added: SessionInfo): void => {
    setSessions((current) => [...current, added]);
    setCatalogIDs((current) => [...current, added.id]);
  };
  return {
    props,
    sessions,
    addSession,
    syncCatalog,
    removeSession,
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

  it("cancels a pending removal when the workspace closes", async () => {
    const fixture = setup();
    let aborted = false;
    fixture.removeSession.mockImplementationOnce(
      (_input, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("cancelled"));
          });
        }),
    );
    const mounted = mount(fixture);
    (await vi.waitFor(() => mounted.deleteButton)).click();
    await vi.waitFor(() => expect(fixture.removeSession).toHaveBeenCalledOnce());
    await Effect.runPromise(Scope.close(fixture.props.effects.scope, Exit.void));
    await vi.waitFor(() => expect(aborted).toBe(true));
    expect(fixture.onDeleted).not.toHaveBeenCalled();
    mounted.dispose();
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

  it("deletes only the session subtree and the dialog omits worktree warnings", async () => {
    const child = session("child", "root");
    const fixture = setup([root, child], { subtreeIDs: ["root", "child"] });
    const mounted = mount(fixture);
    const button = await vi.waitFor(() => {
      expect(document.body.textContent).toContain("This cannot be undone.");
      expect(document.body.textContent).toContain("1 child session");
      expect(document.body.textContent).not.toContain("worktree");
      return mounted.deleteButton;
    });
    button.click();
    await vi.waitFor(() => {
      expect(fixture.removeSession).toHaveBeenCalledWith(
        { sessionID: "root" },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(fixture.onDeleted).toHaveBeenCalledWith(["root", "child"]);
    });
    expect(fixture.syncCatalog).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(document.body.textContent).not.toContain("Delete session?"));
    expect(fixture.sessions()).toEqual([]);
    mounted.dispose();
  });

  it("includes a child added during the catalog refresh in the deleted subtree", async () => {
    const child = session("child", "root");
    const fixture = setup();
    const pending = deferred();
    fixture.syncCatalog.mockImplementationOnce(async () => {
      fixture.addSession(child);
      await pending.promise;
    });
    const mounted = mount(fixture);
    (await vi.waitFor(() => mounted.deleteButton)).click();
    await vi.waitFor(() => expect(fixture.syncCatalog).toHaveBeenCalledOnce());
    pending.resolve();
    await vi.waitFor(() => expect(fixture.onDeleted).toHaveBeenCalledWith(["root", "child"]));
    expect(fixture.removeSession).toHaveBeenCalledOnce();
    mounted.dispose();
  });

  it("blocks deletion when a child added during the refresh is running", async () => {
    const child = session("child", "root");
    let childAdded = false;
    const fixture = setup([root], {
      deletionStatusForSession: () => (childAdded ? "running" : "ready"),
    });
    const pending = deferred();
    fixture.syncCatalog.mockImplementationOnce(async () => {
      fixture.addSession(child);
      childAdded = true;
      await pending.promise;
    });
    const mounted = mount(fixture);
    (await vi.waitFor(() => mounted.deleteButton)).click();
    await vi.waitFor(() => expect(fixture.syncCatalog).toHaveBeenCalledOnce());
    pending.resolve();
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain(
        "Wait for this session and its child sessions to finish before deleting.",
      ),
    );
    expect(fixture.removeSession).not.toHaveBeenCalled();
    mounted.dispose();
  });

  it("finalizes an externally removed session without sending a removal", async () => {
    const fixture = setup([], {
      session: root,
      subtreeIDs: ["root"],
      sessions: () => [],
      sessionIDs: () => [],
      deletionStatusForSession: () => "removed",
    });
    const flow = createDeleteSessionFlow(fixture.props);
    flow.delete();
    await vi.waitFor(() => expect(flow.pending()).toBe(false));
    await vi.waitFor(() => expect(fixture.onDeleted).toHaveBeenCalledWith(["root"]));
    expect(fixture.removeSession).not.toHaveBeenCalled();
    flow.dispose();
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

  it("blocks deletion while the session or a child is running", async () => {
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
    mounted.dispose();
  });

  it("keeps the session when session deletion fails, then allows retry", async () => {
    const fixture = setup();
    fixture.removeSession.mockRejectedValueOnce(new Error("offline"));
    const mounted = mount(fixture);
    (await vi.waitFor(() => mounted.deleteButton)).click();
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("The session could not be deleted."),
    );
    expect(fixture.onDeleted).not.toHaveBeenCalled();
    mounted.deleteButton.click();
    await vi.waitFor(() => expect(fixture.onDeleted).toHaveBeenCalledWith(["root"]));
    expect(fixture.removeSession).toHaveBeenCalledTimes(2);
    mounted.dispose();
  });

  it("does not let a stale deletion unblock a replacement flow", async () => {
    const oldFixture = setup();
    const oldRemoval = deferred();
    oldFixture.removeSession.mockImplementationOnce(() => oldRemoval.promise);

    const replacementSession = session("replacement");
    const replacementFixture = setup([replacementSession], {
      session: replacementSession,
      subtreeIDs: [replacementSession.id],
    });
    const replacementRemoval = deferred();
    replacementFixture.removeSession.mockImplementationOnce(() => replacementRemoval.promise);

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
    await vi.waitFor(() => expect(oldFixture.removeSession).toHaveBeenCalledOnce());

    setFlow("replacement");
    await vi.waitFor(() => expect(document.body.textContent).toContain("replacement"));
    (await vi.waitFor(findDeleteButton)).click();
    await vi.waitFor(() => expect(replacementFixture.removeSession).toHaveBeenCalledOnce());

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
