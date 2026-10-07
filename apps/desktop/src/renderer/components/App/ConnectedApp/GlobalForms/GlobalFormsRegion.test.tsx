import type { FormAnswer, FormInfo, LocationRef } from "@opencode/client";
import { ServerFlowDialogProvider } from "../../../../ui/ServerFlowDialogProvider.tsx";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { deferred } from "../../../../test/deferred.ts";
import type { GlobalFormsController } from "./createGlobalForms.ts";
import { GlobalFormsRegion } from "./GlobalFormsRegion.tsx";
import { Workspace } from "../Shell/Workspace.tsx";

const location: LocationRef = {
  directory: "/srv/remote/strange folder",
  workspaceID: "remote-workspace",
};

function form(
  id: string,
  title = `Request ${id}`,
  fields: FormInfo["fields"] = [{ key: "answer", type: "string", title: "Answer", required: true }],
): FormInfo {
  return { id, sessionID: "global", title, fields };
}

function controller(initial: readonly FormInfo[] = []) {
  const answers = new Map<string, FormAnswer>();
  const [forms, setForms] = createSignal<readonly FormInfo[]>(initial);
  const [connected, setConnected] = createSignal(true);
  const [loading, setLoading] = createSignal(false);
  const [loadError, setLoadError] = createSignal<string>();
  const [pending, setPending] = createSignal(false);
  const [submittingIDs, setSubmittingIDs] = createSignal<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = createSignal<ReadonlyMap<string, string>>(new Map());
  const submitting = vi.fn<GlobalFormsController["submitting"]>((id) => submittingIDs().has(id));
  const errorFor = vi.fn<GlobalFormsController["errorFor"]>((id) => errors().get(id));
  const reply = vi.fn<GlobalFormsController["reply"]>(async (id) => {
    setForms((current) => current.filter((item) => item.id !== id));
    return true;
  });
  const cancel = vi.fn<GlobalFormsController["cancel"]>(async (id) => {
    setForms((current) => current.filter((item) => item.id !== id));
    return true;
  });
  const refresh = vi.fn<GlobalFormsController["refresh"]>(async () => undefined);
  const value: GlobalFormsController = {
    location,
    forms,
    connected,
    pending,
    submitting,
    errorFor,
    answerFor: (id) => answers.get(id),
    saveAnswer: (id, answer) => {
      answers.set(id, answer);
    },
    loading,
    loadError,
    refresh,
    reply,
    cancel,
  };
  return {
    value,
    setConnected,
    setForms,
    setLoading,
    setLoadError,
    setPending,
    setSubmittingIDs,
    submittingIDs,
    setErrors,
    submitting,
    errorFor,
    refresh,
    reply,
    cancel,
  };
}

function mount(value: GlobalFormsController) {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(
    () => (
      <ServerFlowDialogProvider>
        <GlobalFormsRegion controller={value} />
      </ServerFlowDialogProvider>
    ),
    host,
  );
  return { host, dispose };
}

function buttonWithText(root: ParentNode, text: string): HTMLButtonElement {
  const button = [...root.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.includes(text),
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${text}`);
  return button;
}

function launcher(root: ParentNode): HTMLButtonElement {
  const button = root.querySelector(".global-forms-region-button");
  if (!(button instanceof HTMLButtonElement)) throw new Error("Launcher button not found.");
  return button;
}

function answerInput(): HTMLInputElement {
  const input = document.body.querySelector("input[type='text']");
  if (!(input instanceof HTMLInputElement)) throw new Error("Answer input not found.");
  return input;
}

function enterAnswer(value: string): void {
  const input = answerInput();
  input.value = value;
  input.dispatchEvent(new InputEvent("input", { bubbles: true }));
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("GlobalFormsRegion", () => {
  it("does not look up fallback focus after the request launcher is disposed", async () => {
    const mounted = mount(controller([form("one")]).value);
    launcher(mounted.host).click();
    await settle();
    const lookup = vi.spyOn(document, "querySelector");
    vi.useFakeTimers();
    try {
      mounted.dispose();
      await vi.advanceTimersByTimeAsync(130);

      expect(lookup).not.toHaveBeenCalledWith(".shell-session-sidebar .shell-server-selector");
      expect(lookup).not.toHaveBeenCalledWith('.shell-titlebar [aria-label="Show sessions"]');
    } finally {
      lookup.mockRestore();
      vi.useRealTimers();
    }
  });

  it("shows the pending count, hides at zero, and keeps the complete server location in the dialog", async () => {
    const state = controller([form("one")]);
    const mounted = mount(state.value);
    expect(launcher(mounted.host).querySelector(".global-forms-region-count")?.textContent).toBe(
      "1",
    );
    expect(launcher(mounted.host).getAttribute("aria-label")).toContain("Review 1 request");
    state.setForms([form("one"), form("two")]);
    expect(launcher(mounted.host).querySelector(".global-forms-region-count")?.textContent).toBe(
      "2",
    );
    state.setForms([form("one")]);
    launcher(mounted.host).click();
    await settle();
    const dialog = document.body.querySelector('[data-slot="dialog-container"]');
    expect(dialog?.textContent).toContain(location.directory);
    expect(dialog?.textContent).toContain(location.workspaceID);
    state.setForms([]);
    expect(mounted.host.querySelector(".global-forms-region-button")).toBeNull();
    expect(document.body.textContent).toContain("No requests");
    mounted.dispose();
  });

  it("preserves answer snapshots across selection and dialog reopen", async () => {
    const state = controller([form("one"), form("two")]);
    const mounted = mount(state.value);
    launcher(mounted.host).click();
    await settle();
    enterAnswer("first answer");
    buttonWithText(document.body, "Request two").click();
    await settle();
    enterAnswer("second answer");
    buttonWithText(document.body, "Request one").click();
    await settle();
    expect(answerInput().value).toBe("first answer");

    buttonWithText(document.body, "Keep pending").click();
    await settle();
    launcher(mounted.host).click();
    await settle();
    expect(answerInput().value).toBe("first answer");

    state.setForms([form("one"), form("two"), form("three")]);
    await settle();
    expect(document.body.textContent).toContain("Request three");
    mounted.dispose();
  });

  it("keeps the open dialog through sidebar collapse and restores focus to the sidebar toggle", async () => {
    const state = controller([form("one")]);
    const [sidebarOpen, setSidebarOpen] = createSignal(true);
    const host = document.createElement("div");
    document.body.append(host);
    const dispose = render(
      () => (
        <ServerFlowDialogProvider>
          <div class="shell-titlebar">
            <button aria-label="Show sessions" onClick={() => setSidebarOpen(true)}>
              Show sessions
            </button>
          </div>
          <Workspace
            leftSidebarOpen={sidebarOpen()}
            rightPanelOpen={false}
            sidebar={
              <div class="shell-session-sidebar">
                <GlobalFormsRegion controller={state.value} />
                <button class="shell-server-selector">Server</button>
              </div>
            }
            main={<div>Main</div>}
          />
        </ServerFlowDialogProvider>
      ),
      host,
    );
    launcher(host).click();
    await settle();
    enterAnswer("keep this draft");

    setSidebarOpen(false);
    await settle();
    expect(answerInput().value).toBe("keep this draft");
    state.setForms([]);
    await settle();
    expect(document.body.textContent).toContain("No requests");
    expect(host.querySelector(".global-forms-region-button")).toBeNull();

    buttonWithText(document.body, "Keep pending").click();
    await new Promise<void>((resolve) => setTimeout(resolve, 130));
    expect(document.activeElement).toBe(host.querySelector('[aria-label="Show sessions"]'));
    dispose();
  });

  it("restores controller-owned drafts after region remount and form-object replacement", async () => {
    const state = controller([form("one")]);
    const mounted = mount(state.value);
    launcher(mounted.host).click();
    await settle();
    enterAnswer("saved answer");
    buttonWithText(document.body, "Keep pending").click();
    await settle();
    mounted.dispose();
    state.setForms([form("one", "Replaced request")]);
    const remounted = mount(state.value);
    launcher(remounted.host).click();
    await settle();
    expect(answerInput().value).toBe("saved answer");
    remounted.dispose();
  });

  it("uses QuestionForm validation, submits, then cancels the next request", async () => {
    const state = controller([form("one"), form("two")]);
    const mounted = mount(state.value);
    launcher(mounted.host).click();
    await settle();

    buttonWithText(document.body, "Continue").click();
    await settle();
    expect(document.body.textContent).toContain("Enter an answer.");
    expect(state.reply).not.toHaveBeenCalled();

    enterAnswer("ok");
    buttonWithText(document.body, "Continue").click();
    await settle();
    expect(state.reply).toHaveBeenCalledWith("one", { answer: "ok" } satisfies FormAnswer);
    expect(document.body.textContent).toContain("Request two");

    buttonWithText(document.body, "Cancel").click();
    await settle();
    expect(state.cancel).toHaveBeenCalledWith("two");
    expect(document.body.textContent).toContain("No requests");
    mounted.dispose();
  });

  it("keeps a pending request visible during loading and load failure and retries", async () => {
    const state = controller([form("one")]);
    state.setLoading(true);
    const mounted = mount(state.value);
    expect(launcher(mounted.host).querySelector(".global-forms-region-count")?.textContent).toBe(
      "1",
    );
    launcher(mounted.host).click();
    await settle();
    expect(document.body.textContent).toContain("Loading requests");

    state.setLoading(false);
    state.setLoadError("Could not load requests");
    await settle();
    expect(launcher(mounted.host).querySelector(".global-forms-region-count")?.textContent).toBe(
      "1",
    );
    expect(launcher(mounted.host).getAttribute("aria-label")).toContain("updates unavailable");
    expect(launcher(mounted.host).hasAttribute("data-error")).toBe(true);
    expect(launcher(mounted.host).querySelector("svg use")?.getAttribute("href")).toContain(
      "warning",
    );
    expect(document.body.textContent).toContain("Could not load requests");
    buttonWithText(document.body, "Retry").click();
    expect(state.refresh).toHaveBeenCalledOnce();
    mounted.dispose();
  });

  it("keeps Retry reachable after an empty-cache failure, another failure, and recovery", async () => {
    const state = controller();
    state.setLoadError("Could not load requests");
    const firstRetry = deferred();
    state.refresh.mockImplementationOnce(async () => {
      state.setLoadError(undefined);
      state.setLoading(true);
      await firstRetry.promise;
      state.setLoading(false);
      state.setLoadError("Still unavailable");
    });
    state.refresh.mockImplementationOnce(async () => {
      state.setLoadError(undefined);
      state.setLoading(true);
      state.setForms([form("one")]);
      state.setLoading(false);
    });
    const mounted = mount(state.value);

    expect(launcher(mounted.host).getAttribute("aria-label")).toContain("Requests unavailable");
    expect(launcher(mounted.host).getAttribute("aria-label")).toBe(
      "Requests unavailable; open to retry",
    );
    expect(launcher(mounted.host).querySelector(".global-forms-region-count")?.textContent).toBe(
      "!",
    );
    expect(launcher(mounted.host).hasAttribute("data-error")).toBe(true);
    launcher(mounted.host).click();
    await settle();
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Could not load requests");
    buttonWithText(dialog!, "Retry").click();
    expect(state.refresh).toHaveBeenCalledOnce();
    await settle();
    expect(mounted.host.querySelector(".global-forms-region-button")).toBeNull();
    expect(dialog?.isConnected).toBe(true);
    expect(dialog?.textContent).toContain("Loading requests");

    firstRetry.resolve();
    await settle();
    expect(dialog?.isConnected).toBe(true);
    expect(dialog?.textContent).toContain("Still unavailable");
    expect(launcher(mounted.host).getAttribute("aria-label")).toContain("Requests unavailable");
    buttonWithText(dialog!, "Retry").click();
    await settle();
    expect(state.refresh).toHaveBeenCalledTimes(2);
    expect(dialog?.isConnected).toBe(true);
    expect(dialog?.textContent).toContain("Request one");
    expect(launcher(mounted.host).querySelector(".global-forms-region-count")?.textContent).toBe(
      "1",
    );
    mounted.dispose();
  });

  it("keeps cached requests inspectable while disconnected and disables mutations", async () => {
    const state = controller([form("one")]);
    const mounted = mount(state.value);
    launcher(mounted.host).click();
    await settle();

    state.setConnected(false);
    await settle();
    expect(launcher(mounted.host).querySelector(".global-forms-region-count")?.textContent).toBe(
      "1",
    );
    expect(launcher(mounted.host).getAttribute("aria-label")).toContain("cached request");
    expect(document.body.textContent).toContain("Disconnected");
    expect(document.body.textContent).toContain("Request one");
    expect(answerInput().disabled).toBe(true);
    expect(buttonWithText(document.body, "Continue").disabled).toBe(true);
    expect(buttonWithText(document.body, "Keep pending").disabled).toBe(false);
    mounted.dispose();
  });

  it("blocks Escape and backdrop dismissal while any request is pending", async () => {
    const state = controller([form("one")]);
    const mounted = mount(state.value);
    launcher(mounted.host).click();
    await settle();
    state.setSubmittingIDs(new Set(["one"]));
    state.setPending(true);
    await settle();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await settle();
    expect(document.body.textContent).toContain("Request one");

    const overlay = document.querySelector('[data-component="dialog-overlay"]');
    expect(overlay).not.toBeNull();
    overlay?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    overlay?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();
    expect(document.body.textContent).toContain("Request one");
    mounted.dispose();
  });

  it("allows another request to be selected and submitted independently", async () => {
    const state = controller([form("one"), form("two")]);
    const first = deferred<boolean>();
    const second = deferred<boolean>();
    state.reply.mockImplementation(async (id) => {
      const wait = id === "one" ? first : second;
      state.setSubmittingIDs((current) => new Set([...current, id]));
      state.setPending(true);
      const result = await wait.promise;
      state.setForms((current) => current.filter((item) => item.id !== id));
      state.setSubmittingIDs((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      state.setPending(state.submittingIDs().size > 0);
      return result;
    });
    const mounted = mount(state.value);
    launcher(mounted.host).click();
    await settle();
    enterAnswer("first");
    buttonWithText(document.body, "Continue").click();
    await settle();
    expect(buttonWithText(document.body, "Request one").disabled).toBe(true);
    expect(buttonWithText(document.body, "Request two").disabled).toBe(false);

    buttonWithText(document.body, "Request two").click();
    await settle();
    enterAnswer("second");
    buttonWithText(document.body, "Continue").click();
    expect(state.reply).toHaveBeenCalledTimes(2);

    first.resolve(true);
    second.resolve(true);
    await settle();
    expect(document.body.textContent).toContain("No requests");
    mounted.dispose();
  });

  it("retains cached forms with a load alert and only disables Retry offline", async () => {
    const state = controller([form("one")]);
    state.setLoadError("Refresh failed");
    const mounted = mount(state.value);
    launcher(mounted.host).click();
    await settle();
    expect(document.body.textContent).toContain("Refresh failed");
    expect(document.body.textContent).toContain("Request one");
    expect(buttonWithText(document.body, "Retry").disabled).toBe(false);

    state.setConnected(false);
    await settle();
    expect(document.body.textContent).toContain("Request one");
    expect(buttonWithText(document.body, "Retry").disabled).toBe(true);
    mounted.dispose();
  });

  it("surfaces action failures and ignores duplicate submission while pending", async () => {
    const state = controller([form("one")]);
    const pending = deferred<boolean>();
    state.reply.mockImplementationOnce(async (id) => {
      state.setSubmittingIDs(new Set([id]));
      state.setPending(true);
      const result = await pending.promise;
      state.setSubmittingIDs(new Set<string>());
      state.setPending(false);
      state.setErrors(new Map([[id, "Server rejected the response."]]));
      return result;
    });
    const mounted = mount(state.value);
    launcher(mounted.host).click();
    await settle();
    enterAnswer("ready");

    const submit = buttonWithText(document.body, "Continue");
    submit.click();
    submit.click();
    expect(state.reply).toHaveBeenCalledOnce();
    expect(buttonWithText(document.body, "Submitting").disabled).toBe(true);

    pending.resolve(false);
    await settle();
    expect(document.body.textContent).toContain("Server rejected the response.");
    expect(buttonWithText(document.body, "Continue").disabled).toBe(false);
    mounted.dispose();
  });

  it("repairs queue focus only for a removed focused request and restores launcher focus", async () => {
    const state = controller([form("one"), form("two"), form("three")]);
    const mounted = mount(state.value);
    launcher(mounted.host).click();
    await settle();
    const first = buttonWithText(document.body, "Request one");
    first.focus();
    state.setForms([form("two"), form("three")]);
    await settle();
    expect(document.activeElement).toBe(buttonWithText(document.body, "Request two"));

    answerInput().focus();
    state.setForms([form("three")]);
    await settle();
    expect(document.activeElement).not.toBe(buttonWithText(document.body, "Request three"));

    buttonWithText(document.body, "Keep pending").click();
    await new Promise<void>((resolve) => setTimeout(resolve, 130));
    expect(document.activeElement).toBe(launcher(mounted.host));
    mounted.dispose();
  });

  it("moves focus to the next request after a successful form settlement", async () => {
    const state = controller([form("one"), form("two"), form("three")]);
    const pending = deferred<boolean>();
    state.reply.mockImplementationOnce(async (id) => {
      state.setSubmittingIDs(new Set([id]));
      state.setPending(true);
      const result = await pending.promise;
      state.setForms((current) => current.filter((item) => item.id !== id));
      state.setSubmittingIDs(new Set<string>());
      state.setPending(false);
      return result;
    });
    const mounted = mount(state.value);
    launcher(mounted.host).click();
    await settle();
    enterAnswer("ready");
    answerInput().focus();
    document.querySelector<HTMLFormElement>("form")?.requestSubmit();
    await settle();
    pending.resolve(true);
    await settle();
    expect(document.activeElement).toBe(buttonWithText(document.body, "Request two"));
    mounted.dispose();
  });
});
