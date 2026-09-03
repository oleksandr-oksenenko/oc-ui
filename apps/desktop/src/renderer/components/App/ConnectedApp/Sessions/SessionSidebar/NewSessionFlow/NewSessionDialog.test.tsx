import { useDialog } from "@opencode-ai/ui/context/dialog";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
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
) {
  const host = document.createElement("div");
  document.body.append(host);
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
            onDismissBlockedChange={setBlocked}
            {...actions}
          />
        </div>
      ),
      onClose,
    );
    return null;
  }

  const dispose = render(
    () => (
      <ServerFlowDialogProvider>
        <TestDialogHost />
      </ServerFlowDialogProvider>
    ),
    host,
  );
  return {
    get root() {
      return dialogRoot ?? document.body;
    },
    actions,
    onClose,
    dispose: () => (dispose(), host.remove()),
  };
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
}

describe("NewSessionDialog", () => {
  it("reports project and mode changes and opens Add Project", async () => {
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
    root.querySelector<HTMLInputElement>('input[value="worktree"]')?.click();
    expect(mounted.actions.onModeChange).toHaveBeenCalledWith("worktree");
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
      mode: "direct",
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
      mode: "worktree",
    }));
    await flush();
    mounted.root.querySelector("form")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));
    expect(mounted.actions.onCreateWorktree).toHaveBeenCalledOnce();
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
});
