import type { OpenCodeClient } from "@opencode-ai/client";
import { createSignal, Show } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { sessionFixture } from "../../../../../test/session-fixture.ts";
import { ServerFlowDialogProvider } from "../../../../../ui/ServerFlowDialogProvider.tsx";
import { DeleteSessionFlow } from "./DeleteSessionFlow.tsx";

const session = sessionFixture({
  id: "root",
  title: "Remove old experiment",
  location: { directory: "/project" },
});

function buttonWithText(label: string): HTMLButtonElement {
  const candidate = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === label,
  );
  if (candidate === undefined) throw new Error(`${label} button was not rendered`);
  return candidate;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("DeleteSessionFlow", () => {
  it("closes cleanly when its owner unmounts during dismissal", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const removeSession = vi.fn<OpenCodeClient["session"]["remove"]>().mockResolvedValue(undefined);
    const removeWorktree = vi
      .fn<OpenCodeClient["worktree"]["remove"]>()
      .mockResolvedValue(undefined);
    const dispose = render(() => {
      const [open, setOpen] = createSignal(true);
      return (
        <ServerFlowDialogProvider>
          <Show when={open()}>
            <DeleteSessionFlow
              session={session}
              subtreeIDs={["root"]}
              removeSession={removeSession}
              removeWorktree={removeWorktree}
              deletionStatusForSession={() => "ready"}
              onDeleted={() => undefined}
              onDismiss={() => setOpen(false)}
            />
          </Show>
        </ServerFlowDialogProvider>
      );
    }, host);

    const cancelButton = await vi.waitFor(() => {
      return buttonWithText("Cancel");
    });
    cancelButton.click();

    await vi.waitFor(() => {
      expect(document.body.textContent).not.toContain("Delete session?");
    });

    dispose();
  });

  it("deletes the session subtree and its worktree from one confirmation", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const removeSession = vi.fn<OpenCodeClient["session"]["remove"]>().mockResolvedValue(undefined);
    const removeWorktree = vi
      .fn<OpenCodeClient["worktree"]["remove"]>()
      .mockResolvedValue(undefined);
    const onDeleted = vi.fn<(sessionIDs: readonly string[]) => void>();
    const dispose = render(
      () => (
        <ServerFlowDialogProvider>
          <DeleteSessionFlow
            session={session}
            subtreeIDs={["root", "child", "grandchild"]}
            worktree={{ projectID: "project", directory: "/worktrees/experiment" }}
            removeSession={removeSession}
            removeWorktree={removeWorktree}
            deletionStatusForSession={() => "ready"}
            onDeleted={onDeleted}
            onDismiss={() => undefined}
          />
        </ServerFlowDialogProvider>
      ),
      host,
    );

    const button = await vi.waitFor(() => {
      expect(document.body.textContent).toContain("This will also delete 2 child sessions.");
      expect(document.body.textContent).toContain(
        "The worktree at /worktrees/experiment, including uncommitted changes and its branch, will also be permanently deleted.",
      );
      const candidate = buttonWithText("Delete session");
      expect(candidate).not.toBeUndefined();
      return candidate;
    });
    button.click();

    await vi.waitFor(() => {
      expect(removeSession).toHaveBeenCalledWith({ sessionID: "root" });
      expect(removeWorktree).toHaveBeenCalledWith({
        projectID: "project",
        directory: "/worktrees/experiment",
        force: true,
      });
      expect(onDeleted).toHaveBeenCalledWith(["root", "child", "grandchild"]);
    });
    expect(removeSession.mock.invocationCallOrder[0]).toBeLessThan(
      removeWorktree.mock.invocationCallOrder[0] ?? 0,
    );

    dispose();
  });

  it("rechecks running state when the user confirms", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const removeSession = vi.fn<OpenCodeClient["session"]["remove"]>().mockResolvedValue(undefined);
    const removeWorktree = vi
      .fn<OpenCodeClient["worktree"]["remove"]>()
      .mockResolvedValue(undefined);
    const dispose = render(
      () => (
        <ServerFlowDialogProvider>
          <DeleteSessionFlow
            session={session}
            subtreeIDs={["root", "child"]}
            removeSession={removeSession}
            removeWorktree={removeWorktree}
            deletionStatusForSession={() => "running"}
            onDeleted={() => undefined}
            onDismiss={() => undefined}
          />
        </ServerFlowDialogProvider>
      ),
      host,
    );

    const button = await vi.waitFor(() => {
      const candidate = buttonWithText("Delete session");
      expect(candidate).not.toBeUndefined();
      return candidate;
    });
    button.click();

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain(
        "Wait for this session and its child sessions to finish before deleting.",
      );
    });
    expect(removeSession).not.toHaveBeenCalled();
    expect(removeWorktree).not.toHaveBeenCalled();

    dispose();
  });

  it("finishes worktree cleanup when the session was removed externally", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const removeSession = vi.fn<OpenCodeClient["session"]["remove"]>().mockResolvedValue(undefined);
    const removeWorktree = vi
      .fn<OpenCodeClient["worktree"]["remove"]>()
      .mockResolvedValue(undefined);
    const onDeleted = vi.fn<(sessionIDs: readonly string[]) => void>();
    const dispose = render(
      () => (
        <ServerFlowDialogProvider>
          <DeleteSessionFlow
            session={session}
            subtreeIDs={["root", "child"]}
            worktree={{ projectID: "project", directory: "/worktrees/experiment" }}
            removeSession={removeSession}
            removeWorktree={removeWorktree}
            deletionStatusForSession={() => "removed"}
            onDeleted={onDeleted}
            onDismiss={() => undefined}
          />
        </ServerFlowDialogProvider>
      ),
      host,
    );

    const button = await vi.waitFor(() => {
      return buttonWithText("Delete session");
    });
    button.click();

    await vi.waitFor(() => {
      expect(removeWorktree).toHaveBeenCalledWith({
        projectID: "project",
        directory: "/worktrees/experiment",
        force: true,
      });
      expect(onDeleted).toHaveBeenCalledWith(["root", "child"]);
    });
    expect(removeSession).not.toHaveBeenCalled();

    dispose();
  });

  it("retries only worktree cleanup after session deletion succeeds", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const removeSession = vi.fn<OpenCodeClient["session"]["remove"]>().mockResolvedValue(undefined);
    const removeWorktree = vi
      .fn<OpenCodeClient["worktree"]["remove"]>()
      .mockRejectedValueOnce(new Error("busy"))
      .mockResolvedValue(undefined);
    const deletionStatusForSession = vi
      .fn<(sessionID: string) => "ready" | "running" | "removed">()
      .mockReturnValueOnce("ready")
      .mockReturnValue("removed");
    const onDeleted = vi.fn<(sessionIDs: readonly string[]) => void>();
    const dispose = render(
      () => (
        <ServerFlowDialogProvider>
          <DeleteSessionFlow
            session={session}
            subtreeIDs={["root"]}
            worktree={{ projectID: "project", directory: "/worktrees/experiment" }}
            removeSession={removeSession}
            removeWorktree={removeWorktree}
            deletionStatusForSession={deletionStatusForSession}
            onDeleted={onDeleted}
            onDismiss={() => undefined}
          />
        </ServerFlowDialogProvider>
      ),
      host,
    );

    const deleteButton = await vi.waitFor(() => {
      return buttonWithText("Delete session");
    });
    deleteButton.click();

    const finishButton = await vi.waitFor(() => {
      expect(document.body.textContent).toContain(
        "The session was deleted, but its worktree could not be removed.",
      );
      return buttonWithText("Finish deletion");
    });
    finishButton.click();

    await vi.waitFor(() => {
      expect(removeSession).toHaveBeenCalledTimes(1);
      expect(removeWorktree).toHaveBeenCalledTimes(2);
      expect(deletionStatusForSession).toHaveBeenCalledTimes(1);
      expect(onDeleted).toHaveBeenCalledWith(["root"]);
    });

    dispose();
  });

  it.each([
    ["Cancel", (button: HTMLButtonElement) => button.textContent?.trim() === "Cancel"],
    [
      "the close button",
      (button: HTMLButtonElement) =>
        button.getAttribute("aria-label") === "Close delete session dialog",
    ],
  ])("can dismiss with %s after deletion fails", async (_label, matchesButton) => {
    const host = document.createElement("div");
    document.body.append(host);
    const removeSession = vi
      .fn<OpenCodeClient["session"]["remove"]>()
      .mockRejectedValue(new Error("offline"));
    const removeWorktree = vi
      .fn<OpenCodeClient["worktree"]["remove"]>()
      .mockResolvedValue(undefined);
    const onDismiss = vi.fn<() => void>();
    const dispose = render(
      () => (
        <ServerFlowDialogProvider>
          <DeleteSessionFlow
            session={session}
            subtreeIDs={["root"]}
            removeSession={removeSession}
            removeWorktree={removeWorktree}
            deletionStatusForSession={() => "ready"}
            onDeleted={() => undefined}
            onDismiss={onDismiss}
          />
        </ServerFlowDialogProvider>
      ),
      host,
    );

    const deleteButton = await vi.waitFor(() => {
      return buttonWithText("Delete session");
    });
    deleteButton.click();

    const dismissButton = await vi.waitFor(() => {
      expect(document.body.textContent).toContain("The session could not be deleted.");
      const candidate = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
        matchesButton,
      );
      if (candidate === undefined) throw new Error("Dismiss button was not rendered");
      return candidate;
    });
    dismissButton.click();

    await vi.waitFor(() => expect(onDismiss).toHaveBeenCalledOnce());

    dispose();
  });
});
