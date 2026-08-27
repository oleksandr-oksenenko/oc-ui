import type { FileListOutput, OpenCodeClient } from "@opencode-ai/client";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

import {
  NewSessionDialog,
  type NewSessionDialogProps,
  type NewSessionDialogState,
} from "./NewSessionDialog.tsx";

const projects = [
  { id: "oc-ui", name: "oc-ui", directory: "/srv/projects/oc-ui", vcs: "git" },
  { id: "api", name: "API", directory: "/srv/projects/api", vcs: "git" },
] as const;

const listDirectory = vi.fn<OpenCodeClient["file"]["list"]>((input) => {
  const base = input?.location?.directory ?? "/";
  const directory = input?.path === ".." ? "/srv/projects" : base;
  return Promise.resolve({
    location: {
      directory,
      project: { id: "oc-ui", directory, canonical: directory },
    },
    data: [{ path: "feature", type: "directory" }],
  } satisfies FileListOutput);
});

function callbacks() {
  return {
    onDismiss: vi.fn<() => void>(),
    onAddProject: vi.fn<() => void>(),
    onProjectChange: vi.fn<(projectID: string) => void>(),
    onModeChange: vi.fn<NewSessionDialogProps["onModeChange"]>(),
    onOpenWorktreeForm: vi.fn<NewSessionDialogProps["onOpenWorktreeForm"]>(),
    onWorktreeParentChange: vi.fn<(directory: string) => void>(),
    onWorktreeNameChange: vi.fn<(name: string) => void>(),
    onRetryProjects: vi.fn<() => void>(),
    onUseProject: vi.fn<NewSessionDialogProps["onUseProject"]>(),
    onCreateWorktree: vi.fn<NewSessionDialogProps["onCreateWorktree"]>(),
    onBack: vi.fn<() => void>(),
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
  const dispose = render(
    () => (
      <NewSessionDialog
        listDirectory={listDirectory}
        state={state()}
        mutation={mutation?.()}
        {...actions}
      />
    ),
    host,
  );
  return { host, actions, dispose: () => (dispose(), host.remove()) };
}

beforeAll(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.setAttribute("open", "");
      },
    },
    close: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.removeAttribute("open");
      },
    },
  });
});

describe("NewSessionDialog", () => {
  it("reports project selection and opens the add-project flow", () => {
    const mounted = mount(() => ({
      view: "select-project",
      projects,
      selectedProjectID: "oc-ui",
      mode: "direct",
    }));

    [...mounted.host.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Add project"))
      ?.click();
    expect(mounted.actions.onAddProject).toHaveBeenCalledOnce();

    mounted.host.querySelectorAll<HTMLElement>('[data-slot="radio-v2-item-input"]')[1]?.click();
    expect(mounted.actions.onProjectChange).toHaveBeenCalledWith("api");
    mounted.dispose();
  });

  it("creates a session for the selected project once", () => {
    const mounted = mount(() => ({
      view: "select-project",
      projects,
      selectedProjectID: "oc-ui",
      mode: "direct",
    }));
    const form = mounted.host.querySelector("form");
    form?.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));
    form?.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));
    expect(mounted.actions.onUseProject).toHaveBeenCalledOnce();
    expect(mounted.actions.onUseProject).toHaveBeenCalledWith("oc-ui");
    mounted.dispose();
  });

  it("opens worktree setup for the selected Git project", () => {
    const mounted = mount(() => ({
      view: "select-project",
      projects,
      selectedProjectID: "api",
      mode: "worktree",
    }));
    mounted.host.querySelector("form")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));
    expect(mounted.actions.onOpenWorktreeForm).toHaveBeenCalledWith("api");
    mounted.dispose();
  });

  it("keeps creation disabled until a project is selected", () => {
    const mounted = mount(() => ({ view: "select-project", projects, mode: "direct" }));
    expect(mounted.host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
      true,
    );
    mounted.dispose();
  });

  it("creates a worktree with its project identity and controlled inputs", () => {
    const mounted = mount(() => ({
      view: "worktree",
      project: projects[0],
      parentDirectory: "/srv/worktrees",
      folderName: "feature-one",
      finalDirectory: "/srv/worktrees/feature-one",
    }));
    mounted.host.querySelector("form")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));
    expect(mounted.actions.onCreateWorktree).toHaveBeenCalledOnce();
    mounted.dispose();
  });

  it("blocks dismissal and controls during both mutation phases", () => {
    const [mutation] = createSignal<NewSessionDialogProps["mutation"]>("creating-session");
    const mounted = mount(
      () => ({
        view: "worktree",
        project: projects[0],
        parentDirectory: "/srv/worktrees",
        folderName: "feature-one",
        finalDirectory: "/srv/worktrees/feature-one",
      }),
      mutation,
    );
    const dialog = mounted.host.querySelector<HTMLDialogElement>("dialog");
    dialog?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(mounted.actions.onDismiss).not.toHaveBeenCalled();
    expect(mounted.host.querySelector('[aria-label="Close new session dialog"]')).toBeNull();
    expect(
      [...mounted.host.querySelectorAll<HTMLInputElement>("input")].every(
        (input) => input.disabled,
      ),
    ).toBe(true);
    mounted.dispose();
  });
});
