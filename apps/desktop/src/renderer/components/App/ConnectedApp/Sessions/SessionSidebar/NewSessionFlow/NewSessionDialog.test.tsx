import { useDialog } from "@opencode/ui/context/dialog";
import { createSignal } from "solid-js";
import { mount as mountView } from "../../../../../../test/mount.ts";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

import {
  NewSessionDialog,
  type NewSessionDialogProps,
  type NewSessionDialogState,
} from "./NewSessionDialog.tsx";
import {
  ServerFlowDialogProvider,
  useServerFlowDismissBlock,
} from "../../../../../../ui/ServerFlowDialogProvider.tsx";

const projects = [
  {
    id: "oc-ui",
    name: "oc-ui",
    location: { directory: "/srv/projects/oc-ui" },
    vcs: "git",
  },
  { id: "api", name: "API", location: { directory: "/srv/projects/api" }, vcs: "git" },
] as const;

beforeAll(() => {
  Object.defineProperty(window, "scrollTo", { configurable: true, value: () => undefined });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: () => undefined,
  });
});

function callbacks() {
  return {
    onAddProject: vi.fn<() => void>(),
    onProjectChange: vi.fn<(projectID: string) => void>(),
    onModeChange: vi.fn<NewSessionDialogProps["onModeChange"]>(),
    onRetryProjects: vi.fn<() => void>(),
    onUseProject: vi.fn<NewSessionDialogProps["onUseProject"]>(),
    onCreateWorktree: vi.fn<NewSessionDialogProps["onCreateWorktree"]>(),
    onRetry: vi.fn<NewSessionDialogProps["onRetry"]>(),
  };
}

function mount(
  state: () => NewSessionDialogState,
  mutation?: () => NewSessionDialogProps["mutation"],
  action?: () => NewSessionDialogProps["action"],
) {
  const actions = callbacks();
  const onClose = vi.fn<() => void>();
  let dialogRoot: HTMLDivElement | undefined;

  function TestDialogHost() {
    const dialog = useDialog();
    const setBlocked = useServerFlowDismissBlock();
    void dialog.show(
      () => (
        <div ref={(element) => (dialogRoot = element)}>
          <NewSessionDialog
            state={state()}
            mutation={mutation?.()}
            action={action?.()}
            onDismissBlockedChange={setBlocked}
            {...actions}
          />
        </div>
      ),
      onClose,
    );
    return null;
  }

  const { dispose } = mountView(() => (
    <ServerFlowDialogProvider>
      <TestDialogHost />
    </ServerFlowDialogProvider>
  ));
  return {
    get root() {
      return dialogRoot ?? document.body;
    },
    actions,
    onClose,
    dispose,
  };
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
}

function buttonByName(root: HTMLElement, name: string): HTMLButtonElement {
  const button = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!button) throw new Error(`Expected a "${name}" button`);
  return button;
}

describe("NewSessionDialog", () => {
  it("reports project changes and opens Add Project", async () => {
    const mounted = mount(() => ({
      projects,
      selectedProjectID: "oc-ui",
      mode: "direct",
    }));
    await flush();
    const root = mounted.root;
    [...root.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Add project"))
      ?.click();
    expect(mounted.actions.onAddProject).toHaveBeenCalledOnce();
    root.querySelector<HTMLButtonElement>(".new-session-project-trigger")?.click();
    await flush();
    const picker = document.getElementById(
      root.querySelector(".new-session-project-trigger")?.getAttribute("aria-controls") ?? "",
    );
    [...(picker?.querySelectorAll<HTMLButtonElement>('[data-slot="list-item"]') ?? [])]
      .find((button) => button.textContent?.includes("API"))
      ?.click();
    expect(mounted.actions.onProjectChange).toHaveBeenCalledWith("api");
    mounted.dispose();
  });

  it("creates a direct session for the selected project once", async () => {
    const mounted = mount(() => ({
      projects,
      selectedProjectID: "oc-ui",
      mode: "worktree",
    }));
    await flush();
    const form = mounted.root.querySelector("form");
    form?.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));
    form?.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));
    expect(mounted.actions.onUseProject).toHaveBeenCalledOnce();
    expect(mounted.actions.onUseProject).toHaveBeenCalledWith("oc-ui");
    mounted.dispose();
  });

  it("starts worktree creation directly from the location choice", async () => {
    const mounted = mount(() => ({
      projects,
      selectedProjectID: "oc-ui",
      mode: "direct",
    }));
    await flush();
    const worktree = [...mounted.root.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Start in worktree",
    );
    worktree?.click();
    worktree?.click();
    expect(mounted.actions.onUseProject).not.toHaveBeenCalled();
    expect(mounted.actions.onModeChange).toHaveBeenCalledWith("worktree");
    expect(mounted.actions.onCreateWorktree).toHaveBeenCalledOnce();
    mounted.dispose();
  });

  it("disables worktree creation for non-Git projects while allowing local sessions", async () => {
    const mounted = mount(() => ({
      projects: [{ id: "docs", name: "Docs", location: { directory: "/srv/docs" } }],
      selectedProjectID: "docs",
      mode: "direct",
    }));
    await flush();
    const worktree = [...mounted.root.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Start in worktree",
    );
    expect(worktree?.disabled).toBe(true);
    worktree?.click();
    expect(mounted.actions.onCreateWorktree).not.toHaveBeenCalled();
    mounted.root.querySelector("form")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));
    expect(mounted.actions.onUseProject).toHaveBeenCalledWith("docs");
    mounted.dispose();
  });

  it("shows retained worktrees and retries only session creation", async () => {
    const mounted = mount(() => ({
      projects,
      selectedProjectID: "oc-ui",
      mode: "worktree",
      error: {
        kind: "session",
        message: "The worktree exists, but its session could not be created.",
        worktreeLocation: { directory: "/srv/worktrees/new-session" },
      },
    }));
    await flush();
    expect(mounted.root.textContent).toContain("/srv/worktrees/new-session");
    mounted.root.querySelector("form")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));
    expect(mounted.actions.onRetry).toHaveBeenCalledOnce();
    expect(mounted.actions.onCreateWorktree).not.toHaveBeenCalled();
    mounted.dispose();
  });

  it("labels a worktree preparation path for manual recovery", async () => {
    const mounted = mount(() => ({
      projects,
      selectedProjectID: "oc-ui",
      mode: "worktree",
      error: {
        kind: "worktree",
        message: "The worktree location could not be resolved.",
        worktreeLocation: { directory: "/srv/worktrees/unknown" },
      },
    }));
    await flush();
    expect(mounted.root.textContent).toContain("/srv/worktrees/unknown");
    expect(mounted.root.textContent).toContain("Inspect this retained worktree manually.");
    expect(mounted.root.textContent).not.toContain("Retry will use this worktree");
    mounted.dispose();
  });

  it("blocks dismissal and controls while a mutation is active", async () => {
    const [mutation] = createSignal<NewSessionDialogProps["mutation"]>("creating-worktree");
    const mounted = mount(
      () => ({ projects, selectedProjectID: "oc-ui", mode: "worktree" }),
      mutation,
    );
    await flush();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(mounted.onClose).not.toHaveBeenCalled();
    expect(mounted.root.querySelector('[aria-label="Close new session dialog"]')).toBeNull();
    mounted.dispose();
  });

  it("shows the creating spinner on the clicked project-folder button", async () => {
    const [mutation, setMutation] = createSignal<NewSessionDialogProps["mutation"]>();
    const [action, setAction] = createSignal<NewSessionDialogProps["action"]>();
    const mounted = mount(
      () => ({ projects, selectedProjectID: "oc-ui", mode: "direct" }),
      mutation,
      action,
    );
    await flush();
    const body = mounted.root.querySelector(".server-flow-dialog-body");
    if (!body) throw new Error("Expected the dialog body");
    expect(body.querySelector('[data-component="loader-v2"]')).toBeNull();

    buttonByName(mounted.root, "Use project folder").click();
    expect(mounted.actions.onUseProject).toHaveBeenCalledWith("oc-ui");

    setAction("direct");
    setMutation("creating-session");
    await flush();
    const direct = buttonByName(mounted.root, "Creating session");
    expect(direct.disabled).toBe(true);
    expect(direct.querySelector('[data-component="loader-v2"]')).not.toBeNull();
    expect(
      buttonByName(mounted.root, "Start in worktree").querySelector('[data-component="loader-v2"]'),
    ).toBeNull();
    expect(body.querySelector('[data-component="loader-v2"]')).toBeNull();
    mounted.dispose();
  });

  it("keeps the spinner on the worktree button through the session phase", async () => {
    const [mutation, setMutation] = createSignal<NewSessionDialogProps["mutation"]>();
    const [action, setAction] = createSignal<NewSessionDialogProps["action"]>();
    const mounted = mount(
      () => ({ projects, selectedProjectID: "oc-ui", mode: "worktree" }),
      mutation,
      action,
    );
    await flush();
    const worktreeButton = buttonByName(mounted.root, "Start in worktree");
    worktreeButton.click();
    expect(mounted.actions.onCreateWorktree).toHaveBeenCalledOnce();

    setAction("worktree");
    setMutation("creating-worktree");
    await flush();
    const worktree = buttonByName(mounted.root, "Creating worktree");
    expect(worktree).toBe(worktreeButton);
    expect(worktree.disabled).toBe(true);
    expect(worktree.querySelector('[data-component="loader-v2"]')).not.toBeNull();

    setMutation("creating-session");
    await flush();
    expect(buttonByName(mounted.root, "Creating session")).toBe(worktreeButton);
    expect(worktreeButton.querySelector('[data-component="loader-v2"]')).not.toBeNull();
    expect(
      buttonByName(mounted.root, "Use project folder").querySelector(
        '[data-component="loader-v2"]',
      ),
    ).toBeNull();
    mounted.dispose();
  });

  it("keeps the retry action on its own button while retrying", async () => {
    const [mutation, setMutation] = createSignal<NewSessionDialogProps["mutation"]>();
    const [action, setAction] = createSignal<NewSessionDialogProps["action"]>();
    const [error, setError] = createSignal<NewSessionDialogState["error"]>({
      kind: "session",
      message: "The session could not be created. Try again.",
    });
    const mounted = mount(
      () => ({ projects, selectedProjectID: "oc-ui", mode: "worktree", error: error() }),
      mutation,
      action,
    );
    await flush();
    mounted.root.querySelector("form")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));
    expect(mounted.actions.onRetry).toHaveBeenCalledOnce();

    setError(undefined);
    setAction("retry");
    setMutation("creating-session");
    await flush();
    expect(
      buttonByName(mounted.root, "Creating session").querySelector('[data-component="loader-v2"]'),
    ).not.toBeNull();
    expect(mounted.root.textContent).not.toContain("Start in worktree");
    mounted.dispose();
  });

  it("clears the pending action after failure so the session can be retried", async () => {
    const [mutation, setMutation] = createSignal<NewSessionDialogProps["mutation"]>();
    const [action, setAction] = createSignal<NewSessionDialogProps["action"]>();
    const [error, setError] = createSignal<NewSessionDialogState["error"]>();
    const mounted = mount(
      () => ({ projects, selectedProjectID: "oc-ui", mode: "direct", error: error() }),
      mutation,
      action,
    );
    await flush();
    buttonByName(mounted.root, "Use project folder").click();
    setAction("direct");
    setMutation("creating-session");
    await flush();
    expect(buttonByName(mounted.root, "Creating session").disabled).toBe(true);

    // The owner publishes the failure and clears the operation.
    setMutation(undefined);
    setAction(undefined);
    setError({ kind: "session", message: "The session could not be created. Try again." });
    await flush();
    const retry = buttonByName(mounted.root, "Retry creating session");
    expect(retry.disabled).toBe(false);

    mounted.root.querySelector("form")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));
    expect(mounted.actions.onRetry).toHaveBeenCalledOnce();
    setAction("retry");
    setMutation("creating-session");
    await flush();
    expect(
      buttonByName(mounted.root, "Creating session").querySelector('[data-component="loader-v2"]'),
    ).not.toBeNull();
    mounted.dispose();
  });

  it("restores the spinning worktree button from the retained action after remount", async () => {
    const mounted = mount(
      () => ({ projects, selectedProjectID: "oc-ui", mode: "worktree" }),
      () => "creating-session",
      () => "worktree",
    );
    await flush();
    expect(
      buttonByName(mounted.root, "Creating session").querySelector('[data-component="loader-v2"]'),
    ).not.toBeNull();
    expect(
      buttonByName(mounted.root, "Use project folder").querySelector(
        '[data-component="loader-v2"]',
      ),
    ).toBeNull();
    mounted.dispose();
  });

  it("restores the retry button from the retained action after remount", async () => {
    const mounted = mount(
      () => ({ projects, selectedProjectID: "oc-ui", mode: "worktree" }),
      () => "creating-session",
      () => "retry",
    );
    await flush();
    expect(
      buttonByName(mounted.root, "Creating session").querySelector('[data-component="loader-v2"]'),
    ).not.toBeNull();
    expect(mounted.root.textContent).not.toContain("Start in worktree");
    mounted.dispose();
  });
});
