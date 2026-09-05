import type { FormInfo } from "@opencode-ai/client";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";

import { withTestWorkspace } from "../../../../test/workspace.ts";
import { mount } from "../../../../test/mount.ts";
import { sessionFixture } from "../../../../test/session-fixture.ts";
import { stubResizeObserver } from "../../../../test/resize-observer.ts";
import { createAnnotationDraftStore } from "../../../../domain/annotation-drafts.ts";
import { ConversationRegion } from "./ConversationRegion.tsx";
import type { SessionFormsController } from "./createSessionForms.ts";
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

function setup(initialForms: readonly FormInfo[] = []) {
  stubResizeObserver();
  const [forms, setForms] = createSignal<readonly FormInfo[]>(initialForms);
  const [state, setState] = createSignal<"loading" | "ready" | "failed">("ready");
  const [connected, setConnected] = createSignal(true);
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
  const workspace: SessionWorkspace = {
    sessions: () => [session],
    selectedSession: () => session,
    selectedID: () => session.id,
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
        connected={connected}
      />
    )),
  );
  return {
    host,
    formsController,
    setForms,
    setState,
    setConnected,
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
