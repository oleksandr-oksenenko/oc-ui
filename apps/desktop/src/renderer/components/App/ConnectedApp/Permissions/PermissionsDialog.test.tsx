import { createSignal } from "solid-js";
import { onMount } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { ServerFlowDialogProvider } from "../../../../ui/ServerFlowDialogProvider.tsx";
import { useDialog } from "@opencode-ai/ui/context/dialog";
import { PermissionsDialog } from "./PermissionsDialog.tsx";
import { permissionsFixture, project, request, rule, session } from "./permissions-test-fixture.ts";

function button(text: string): HTMLButtonElement {
  const result = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.includes(text),
  );
  if (!result) throw new Error(`Button not found: ${text}`);
  return result;
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function mountDialog() {
  const fixture = permissionsFixture();
  const [connected, setConnected] = createSignal(true);
  const onOpenSession = vi.fn<(sessionID: string) => void>();
  const host = document.createElement("div");
  document.body.append(host);
  const Harness = () => {
    const dialog = useDialog();
    onMount(() => {
      void dialog.show(() => (
        <PermissionsDialog
          controller={fixture.value}
          connected={connected}
          onOpenSession={onOpenSession}
        />
      ));
    });
    return null;
  };
  const dispose = render(
    () => (
      <ServerFlowDialogProvider>
        <Harness />
      </ServerFlowDialogProvider>
    ),
    host,
  );
  return { fixture, connected, setConnected, onOpenSession, host, dispose };
}

afterEach(() => document.body.replaceChildren());

describe("PermissionsDialog", () => {
  it("uses the shared dialog's content-sized mode instead of an imposed large height", async () => {
    const mounted = mountDialog();
    await settle();
    const shell = document.body.querySelector<HTMLElement>('[data-component="dialog-v2"]');
    expect(shell?.dataset.fit).toBe("true");
    expect(shell?.dataset.size).toBe("normal");
    mounted.dispose();
  });

  it("shows every session location and exact pending request detail without reply controls", async () => {
    const mounted = mountDialog();
    await settle();
    mounted.fixture.setEntries([
      {
        session: session({
          id: "fallback-session",
          title: "",
          location: { directory: "/remote/a", workspaceID: "workspace-a" },
        }),
        requests: [request({ action: "", resources: ["", "/remote/a/file"] })],
      },
    ]);
    expect(document.body.textContent).toContain("fallback-session");
    expect(document.body.textContent).toContain("/remote/a");
    expect(document.body.textContent).toContain("Workspace: workspace-a");
    expect(document.body.textContent).toContain("(empty)");
    expect(document.body.textContent).toContain("/remote/a/file");
    expect(button("Open session").disabled).toBe(false);
    expect(document.body.textContent).not.toContain("Allow once");
    expect(document.body.textContent).not.toContain("Reject all");
    mounted.dispose();
  });

  it("keeps cached rows visible on failure and disables navigation while disconnected", async () => {
    const mounted = mountDialog();
    await settle();
    mounted.fixture.setInboxState("failed");
    mounted.fixture.setInboxError("One location could not be inspected.");
    mounted.setConnected(false);
    expect(document.body.textContent).toContain("One location could not be inspected.");
    expect(document.body.textContent).toContain("Release work");
    expect(button("Open session").disabled).toBe(true);
    expect(button("Refresh pending permissions").disabled).toBe(true);
    mounted.fixture.setInboxState("loading");
    expect(document.body.textContent).not.toContain("Loading pending permissions");
    button("Saved approvals").click();
    mounted.fixture.setSavedState("loading");
    expect(document.body.textContent).not.toContain("Loading saved approvals");
    mounted.dispose();
  });

  it("shows the global recovery barrier separately and refreshes through the controller", async () => {
    const mounted = mountDialog();
    await settle();
    mounted.fixture.setRecoveryError("Reconciliation must finish before another response.");
    expect(document.body.textContent).toContain("Permission recovery required");
    button("Refresh permissions").click();
    expect(mounted.fixture.inboxSync).toHaveBeenCalledOnce();
    mounted.dispose();
  });

  it("shows all projects and raw rule values independent of the selected session", async () => {
    const mounted = mountDialog();
    await settle();
    mounted.fixture.setProjects([
      project(),
      project({ id: "project-two", name: undefined, canonical: "/srv/projects/two" }),
    ]);
    mounted.fixture.setRules([
      rule(),
      rule({ id: "rule-empty", projectID: "project-two", action: "", resource: "" }),
    ]);
    button("Saved approvals").click();
    expect(document.body.textContent).toContain("Project One");
    expect(document.body.textContent).toContain("/srv/projects/one");
    expect(document.body.textContent).toContain("Project ID: project-one");
    expect(document.body.textContent).toContain("/srv/projects/two");
    expect(document.body.textContent).toContain("Project ID: project-two");
    expect(document.body.textContent).toContain("(empty)");
    mounted.dispose();
  });

  it("cancels inline revocation with Cancel or Escape and persists row errors", async () => {
    const mounted = mountDialog();
    await settle();
    button("Saved approvals").click();
    button("Revoke").click();
    await Promise.resolve();
    expect(document.activeElement).toBe(button("Cancel"));
    expect(document.body.textContent).toContain("future permission checks");
    button("Cancel").click();
    expect(mounted.fixture.remove).not.toHaveBeenCalled();

    button("Revoke").click();
    button("Cancel").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(mounted.fixture.remove).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("Confirm revoke");

    mounted.fixture.setRowErrors(new Map([["rule-one", "Revocation could not be confirmed."]]));
    expect(document.body.textContent).toContain("Revocation could not be confirmed.");
    mounted.dispose();
  });

  it("keeps Cancel and Escape available while a workspace revoke continues", async () => {
    const mounted = mountDialog();
    await settle();
    button("Saved approvals").click();
    button("Revoke").click();
    mounted.fixture.setRemoving("rule-one");
    mounted.fixture.setPending(true);
    expect(button("Cancel").disabled).toBe(false);
    button("Cancel").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain("Confirm revoke");
    expect(document.body.textContent).toContain("Revoking…");
    expect(mounted.fixture.remove).not.toHaveBeenCalled();
    mounted.dispose();
  });

  it("restores keyboard focus to the next rule after confirmed removal", async () => {
    const mounted = mountDialog();
    await settle();
    mounted.fixture.setRules([rule(), rule({ id: "rule-two", resource: "/srv/other/**" })]);
    button("Saved approvals").click();
    const firstRevoke = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Revoke saved approval for read files and /srv/projects/one/**"]',
    )!;
    firstRevoke.click();
    const confirm = button("Confirm revoke");
    confirm.focus();
    confirm.click();
    await settle();
    expect(mounted.fixture.remove).toHaveBeenCalledWith("rule-one");
    expect(document.activeElement).toBe(
      document.body.querySelector<HTMLButtonElement>(
        'button[aria-label="Revoke saved approval for read files and /srv/other/**"]',
      ),
    );
    mounted.dispose();
  });

  it("does not move focus after removal when the user moved elsewhere", async () => {
    const mounted = mountDialog();
    await settle();
    button("Saved approvals").click();
    button("Revoke").click();
    await Promise.resolve();
    const savedRefresh = button("Refresh saved approvals");
    const removal = new Promise<void>((resolve) => {
      mounted.fixture.remove.mockImplementationOnce(async (_ruleID) => {
        await Promise.resolve();
        mounted.fixture.setRules([]);
        resolve();
      });
    });
    button("Confirm revoke").click();
    savedRefresh.focus();
    await removal;
    await settle();
    expect(document.activeElement).toBe(savedRefresh);
    mounted.dispose();
  });
});
