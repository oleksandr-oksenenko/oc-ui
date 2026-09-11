import type { FormInfo, PermissionRequest } from "@opencode-ai/client";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";

import { withTestWorkspace } from "../../../../test/workspace.ts";
import { mount } from "../../../../test/mount.ts";
import { sessionFixture } from "../../../../test/session-fixture.ts";
import { stubResizeObserver } from "../../../../test/resize-observer.ts";
import { createAnnotationDraftStore } from "../../../../domain/annotation-drafts.ts";
import { ConversationRegion } from "./ConversationRegion.tsx";
import type { SessionFormsController } from "./createSessionForms.ts";
import type { SessionPermissionsController } from "../Permissions/createPermissions.ts";
import type { SessionComposerController } from "./createSessionComposer.ts";
import type { SessionAgentSelectionController } from "./createSessionAgentSelection.ts";
import type { SessionWorkspace } from "../Sessions/createSessionWorkspace.ts";
import type { ModelSelection } from "../../../../opencode/model-selection.ts";

const session = sessionFixture({
  id: "ses_forms",
  title: "Forms",
  location: { directory: "/workspace" },
});

const form = (id: string, title: string): FormInfo => ({
  id,
  sessionID: session.id,
  title,
  fields: [{ key: "answer", type: "string", title: "Answer" }],
});

const formForSession = (sessionID: string, id: string, title: string): FormInfo => ({
  ...form(id, title),
  sessionID,
});

const permission = (id: string, action: string, sessionID = session.id): PermissionRequest => ({
  id,
  sessionID,
  action,
  resources: [`/workspace/${id}`],
  save: [`${id}/**`],
});

function setup(
  initialForms: readonly FormInfo[] = [],
  initialPermissions: readonly PermissionRequest[] = [],
) {
  stubResizeObserver();
  const [forms, setForms] = createSignal<readonly FormInfo[]>(initialForms);
  const [state, setState] = createSignal<"loading" | "ready" | "failed">("ready");
  const [connected, setConnected] = createSignal(true);
  const [selectedID, setSelectedID] = createSignal<string | undefined>(session.id);
  const [permissions, setPermissions] =
    createSignal<readonly PermissionRequest[]>(initialPermissions);
  const [permissionsState, setPermissionsState] = createSignal<"loading" | "ready" | "failed">(
    "ready",
  );
  const [permissionsPending, setPermissionsPending] = createSignal(false);
  const [recoveryError, setRecoveryError] = createSignal<string>();
  const formsController: SessionFormsController = {
    sessionForms: forms,
    state,
    error: () => (state() === "failed" ? "Refresh failed." : undefined),
    submitting: () => false,
    errorFor: () => undefined,
    sync: vi.fn<SessionFormsController["sync"]>(async () => undefined),
    reply: vi.fn<SessionFormsController["reply"]>(async () => undefined),
    cancel: vi.fn<SessionFormsController["cancel"]>(async () => undefined),
  };
  const permissionsController: SessionPermissionsController = {
    requests: permissions,
    state: permissionsState,
    error: () =>
      permissionsState() === "failed"
        ? "Permissions could not be refreshed. Try again."
        : undefined,
    recoveryError,
    pending: permissionsPending,
    submitting: (requestID) => permissionsPending() && requestID === permissions()[0]?.id,
    errorFor: () => undefined,
    sync: vi.fn<SessionPermissionsController["sync"]>(async () => undefined),
    reply: vi.fn<SessionPermissionsController["reply"]>(async () => undefined),
  };
  const workspace: SessionWorkspace = {
    sessions: () => [session],
    selectedSession: () => session,
    selectedID,
    running: () => false,
    stopError: () => undefined,
    transcript: () => [],
    transcriptStatus: () => "idle",
    transcriptLoading: () => false,
    transcriptError: () => undefined,
    select: () => undefined,
    stop: vi.fn<SessionWorkspace["stop"]>(async () => undefined),
    hydrate: vi.fn<SessionWorkspace["hydrate"]>(async () => undefined),
    syncCatalog: vi.fn<SessionWorkspace["syncCatalog"]>(async () => undefined),
    retryCatalog: vi.fn<SessionWorkspace["retryCatalog"]>(async () => undefined),
    beginRecovery: () => undefined,
    refreshAfterReconnect: vi.fn<SessionWorkspace["refreshAfterReconnect"]>(async () => undefined),
    failRecovery: () => undefined,
    markCreated: () => undefined,
    remove: () => undefined,
  };
  const composer: SessionComposerController = {
    files: () => [],
    pasteFiles: () => undefined,
    removeFile: () => undefined,
    value: () => "",
    disabled: () => false,
    submitting: () => false,
    error: () => undefined,
    review: () => undefined,
    input: () => undefined,
    submit: vi.fn<SessionComposerController["submit"]>(async () => undefined),
    clear: () => undefined,
  };
  const modelSelection: ModelSelection = {
    state: () => "ready",
    error: () => undefined,
    switching: () => false,
    models: () => [],
    selectedModelID: () => undefined,
    variants: () => [],
    selectedVariantID: () => undefined,
    sync: vi.fn<ModelSelection["sync"]>(async () => undefined),
    selectModel: vi.fn<ModelSelection["selectModel"]>(async () => undefined),
    selectVariant: vi.fn<ModelSelection["selectVariant"]>(async () => undefined),
  };
  const agentSelection: SessionAgentSelectionController = {
    state: () => "ready",
    error: () => undefined,
    switching: () => false,
    agents: () => [],
    selectedAgentID: () => undefined,
    sync: vi.fn<SessionAgentSelectionController["sync"]>(async () => undefined),
    selectAgent: vi.fn<SessionAgentSelectionController["selectAgent"]>(async () => undefined),
  };
  const { host, dispose } = withTestWorkspace((effects) =>
    mount(() => (
      <ConversationRegion
        annotationDrafts={createAnnotationDraftStore(effects)}
        workspace={workspace}
        composer={composer}
        modelSelection={modelSelection}
        agentSelection={agentSelection}
        forms={formsController}
        permissions={permissionsController}
        connected={connected}
      />
    )),
  );
  return {
    host,
    formsController,
    permissionsController,
    setForms,
    setState,
    setConnected,
    setSelectedID,
    setPermissions,
    setPermissionsState,
    setPermissionsPending,
    setRecoveryError,
    dispose: () => {
      dispose();
      vi.unstubAllGlobals();
    },
  };
}

describe("ConversationRegion session forms", () => {
  it("renders pending forms in server order and omits the surface when absent", () => {
    const mounted = setup([form("first", "First"), form("second", "Second")]);
    expect(
      [...mounted.host.querySelectorAll(".question-form-header h2")].map(
        (node) => node.textContent,
      ),
    ).toEqual(["First", "Second"]);
    mounted.setForms([]);
    expect(mounted.host.querySelector(".transcript-pending-interaction")).toBeNull();
    mounted.dispose();
  });

  it("preserves a form draft when sibling settlement and object replacement update the list", () => {
    const mounted = setup([form("first", "First"), form("second", "Second")]);
    const pendingInteraction = mounted.host.querySelector(".transcript-pending-interaction");
    const input = mounted.host
      .querySelectorAll<HTMLElement>(".question-form-card")
      .item(1)
      ?.querySelector<HTMLInputElement>('[data-form-field-key="answer"] input');
    expect(input).not.toBeNull();
    if (!input) return;
    input.value = "Keep this draft";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(input.value).toBe("Keep this draft");

    mounted.setForms([form("first", "First refreshed"), form("second", "Second refreshed")]);
    expect(mounted.host.querySelector(".transcript-pending-interaction")).toBe(pendingInteraction);
    expect(
      mounted.host
        .querySelectorAll<HTMLElement>(".question-form-card")
        .item(1)
        ?.querySelector<HTMLInputElement>('[data-form-field-key="answer"] input')?.value,
    ).toBe("Keep this draft");
    mounted.setForms([form("second", "Second settled sibling")]);

    expect(
      mounted.host.querySelector<HTMLInputElement>('[data-form-field-key="answer"] input')?.value,
    ).toBe("Keep this draft");
    mounted.dispose();
  });

  it("resets a draft when another session reuses the same form ID", () => {
    const mounted = setup([formForSession("session-a", "shared", "Session A")]);
    const input = mounted.host.querySelector<HTMLInputElement>(
      '[data-form-field-key="answer"] input',
    );
    expect(input).not.toBeNull();
    if (!input) return;
    input.value = "Only for session A";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));

    mounted.setForms([formForSession("session-b", "shared", "Session B")]);

    expect(
      mounted.host.querySelector<HTMLInputElement>('[data-form-field-key="answer"] input')?.value,
    ).toBe("");
    mounted.dispose();
  });

  it("disables cached forms and retry while disconnected after a sync failure", () => {
    const mounted = setup([form("first", "First")]);
    mounted.setConnected(false);
    mounted.setState("failed");
    expect(mounted.host.querySelector('[role="alert"]')?.textContent).toContain("Refresh failed.");
    expect(mounted.host.querySelector<HTMLButtonElement>("button")?.disabled).toBe(true);
    expect(
      [
        ...mounted.host.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button"),
      ].every((element) => element.disabled),
    ).toBe(true);
    mounted.dispose();
  });
});

describe("ConversationRegion session permissions", () => {
  it("renders permissions before questions and keeps both pending interactions", () => {
    const mounted = setup(
      [form("first", "Release question")],
      [permission("per_read", "read files")],
    );
    const pending = mounted.host.querySelector(".transcript-pending-interaction");
    expect(pending?.querySelector("[data-permission-request-id]")?.textContent).toContain(
      "read files",
    );
    expect(pending?.querySelector(".question-form-card")?.textContent).toContain(
      "Release question",
    );
    const permissionCard = pending?.querySelector("[data-permission-request-id]");
    const questionCard = pending?.querySelector(".question-form-card");
    expect(permissionCard).not.toBeNull();
    expect(questionCard).not.toBeNull();
    expect(
      permissionCard!.compareDocumentPosition(questionCard!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    mounted.dispose();
  });

  it("keeps refresh failures visible without a cached request and retries explicitly", () => {
    const mounted = setup();
    mounted.setPermissionsState("failed");
    expect(mounted.host.querySelector(".transcript-pending-interaction")).not.toBeNull();
    expect(mounted.host.querySelector('[role="alert"]')?.textContent).toContain(
      "Permissions could not be refreshed",
    );
    const retry = [...mounted.host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Retry permissions",
    );
    retry?.click();
    expect(mounted.permissionsController.sync).toHaveBeenCalledOnce();
    mounted.dispose();
  });

  it("keeps a global recovery failure visible and refreshable without a selected request", () => {
    const mounted = setup();
    mounted.setRecoveryError("Permission reconciliation could not be completed.");
    expect(mounted.host.querySelector(".transcript-pending-interaction")?.textContent).toContain(
      "Permission reconciliation could not be completed.",
    );
    const refresh = [...mounted.host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Refresh permissions",
    );
    refresh?.click();
    expect(mounted.permissionsController.sync).toHaveBeenCalledOnce();
    mounted.dispose();
  });

  it("disables every permission card while disconnected, loading, or workspace-pending", () => {
    const mounted = setup(
      [],
      [permission("per_first", "read files"), permission("per_second", "run command")],
    );
    const everyReplyDisabled = () =>
      [
        ...mounted.host.querySelectorAll<HTMLButtonElement>(".permission-request-card button"),
      ].every((button) => button.disabled);
    mounted.setConnected(false);
    expect(everyReplyDisabled()).toBe(true);
    mounted.setConnected(true);
    mounted.setPermissionsState("loading");
    expect(everyReplyDisabled()).toBe(true);
    mounted.setPermissionsState("ready");
    mounted.setPermissionsPending(true);
    expect(everyReplyDisabled()).toBe(true);
    mounted.dispose();
  });

  it("routes a controlled card reply through the session permission controller", () => {
    const mounted = setup([], [permission("per_first", "read files")]);
    [...mounted.host.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Allow once")
      ?.click();
    expect(mounted.permissionsController.reply).toHaveBeenCalledWith("per_first", "once");
    mounted.dispose();
  });

  it("restores focus to the next permission card after the focused card is removed", async () => {
    const second = permission("per_second", "run command");
    const mounted = setup([], [permission("per_first", "read files"), second]);
    mounted.host
      .querySelector<HTMLButtonElement>('[data-permission-request-id="per_first"] button')
      ?.focus();

    mounted.setPermissions([second]);
    await Promise.resolve();

    const nextCard = mounted.host.querySelector<HTMLElement>(
      '[data-permission-request-id="per_second"]',
    );
    expect(document.activeElement).toBe(nextCard);
    expect(nextCard?.getAttribute("role")).toBe("group");
    const labelID = nextCard?.getAttribute("aria-labelledby");
    expect(labelID).toBeTruthy();
    expect(mounted.host.querySelector(`#${labelID}`)?.textContent).toBe("run command");
    mounted.dispose();
  });

  it("restores focus to the prompt after the last focused card is removed", async () => {
    const mounted = setup([], [permission("per_first", "read files")]);
    mounted.host
      .querySelector<HTMLButtonElement>('[data-permission-request-id="per_first"] button')
      ?.focus();

    mounted.setPermissions([]);
    await Promise.resolve();

    expect(document.activeElement).toBe(
      mounted.host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Prompt"]'),
    );
    mounted.dispose();
  });

  it("preserves focus intent when submission disables the focused button before removal", async () => {
    const mounted = setup([], [permission("per_first", "read files")]);
    const allow = [...mounted.host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Allow once",
    );
    allow?.focus();
    allow?.click();
    expect(document.activeElement).toBe(
      mounted.host.querySelector('[data-permission-request-id="per_first"]'),
    );
    mounted.setPermissionsPending(true);

    mounted.setPermissions([]);
    await Promise.resolve();

    expect(document.activeElement).toBe(
      mounted.host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Prompt"]'),
    );
    mounted.dispose();
  });

  it("does not move focus on session navigation or when another control held focus", async () => {
    const mounted = setup([], [permission("per_first", "read files")]);
    const prompt = mounted.host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Prompt"]');
    prompt?.focus();
    mounted.setPermissions([]);
    await Promise.resolve();
    expect(document.activeElement).toBe(prompt);

    mounted.setPermissions([permission("per_other", "run command")]);
    mounted.host
      .querySelector<HTMLButtonElement>('[data-permission-request-id="per_other"] button')
      ?.focus();
    mounted.setSelectedID("ses_other");
    mounted.setPermissions([]);
    await Promise.resolve();
    expect(document.activeElement).not.toBe(prompt);
    mounted.dispose();
  });
});
