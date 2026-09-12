import { createSignal } from "solid-js";
import { RegistryContext } from "@effect/atom-solid";
import { withTestWorkspace } from "../../../../../../test/workspace.ts";
import type { FileListOutput, LocationRef, OpenCodeClient } from "@opencode-ai/client";
import { useDialog } from "@opencode-ai/ui/context/dialog";
import { describe, expect, it, vi } from "vite-plus/test";

import { mount as mountView } from "../../../../../../test/mount.ts";
import { deferred } from "../../../../../../test/deferred.ts";
import { AddProjectDialog, type AddProjectDialogError } from "./AddProjectDialog.tsx";
import {
  ServerFlowDialogProvider,
  useServerFlowDismissBlock,
} from "../../../../../../ui/ServerFlowDialogProvider.tsx";

function response(directory: string): FileListOutput {
  return {
    location: {
      workspaceID: "remote-workspace",
      directory,
      project: { id: "project", directory, canonical: directory },
    },
    data: directory === "/srv/projects" ? [{ path: "oc-ui", type: "directory" }] : [],
  };
}

function listDirectory(): OpenCodeClient["file"]["list"] {
  return vi.fn<OpenCodeClient["file"]["list"]>((input) => {
    const directory = input?.location?.directory ?? "/";
    return Promise.resolve(response(directory));
  });
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  await new Promise<void>((resolve) => queueMicrotask(resolve));
}

function mount(
  options: {
    readonly adding?: boolean;
    readonly error?: AddProjectDialogError;
    readonly listDirectory?: OpenCodeClient["file"]["list"];
  } = {},
) {
  const effects = withTestWorkspace((owner) => owner);
  const list = options.listDirectory ?? listDirectory();
  const [adding, setAdding] = createSignal(options.adding);
  const [error, setError] = createSignal(options.error);
  const onClose = vi.fn<() => void>();
  const onAddProject = vi.fn<(location: LocationRef) => void>();
  let dialogRoot: HTMLDivElement | undefined;

  function TestDialogHost() {
    const dialog = useDialog();
    const setBlocked = useServerFlowDismissBlock();
    void dialog.show(
      () => (
        <div ref={(element) => (dialogRoot = element)}>
          <AddProjectDialog
            effects={effects}
            listDirectory={list}
            initialLocation={{ directory: "/srv/projects", workspaceID: "remote-workspace" }}
            adding={adding()}
            error={error()}
            onDismissBlockedChange={setBlocked}
            onAddProject={onAddProject}
          />
        </div>
      ),
      onClose,
    );
    return null;
  }

  const { dispose } = mountView(() => (
    <RegistryContext.Provider value={effects.registry}>
      <ServerFlowDialogProvider>
        <TestDialogHost />
      </ServerFlowDialogProvider>
    </RegistryContext.Provider>
  ));
  return {
    get root() {
      return dialogRoot ?? document.body;
    },
    list,
    setAdding,
    setError,
    onClose,
    onAddProject,
    dispose,
  };
}

describe("AddProjectDialog", () => {
  it("submits the directory currently open in the server browser", async () => {
    const mounted = mount();
    await flush();
    mounted.root.querySelector<HTMLButtonElement>('[aria-label="Browse directory oc-ui"]')?.click();
    await flush();

    mounted.root.querySelector("form")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));
    expect(mounted.onAddProject).toHaveBeenCalledOnce();
    expect(mounted.onAddProject).toHaveBeenCalledWith({
      directory: "/srv/projects/oc-ui",
      workspaceID: "remote-workspace",
    });
    mounted.dispose();
  });

  it("does not submit the previous directory while navigation is loading", async () => {
    const child = deferred<FileListOutput>();
    const mounted = mount({
      listDirectory: (input) =>
        input?.location?.directory === "/srv/projects/oc-ui"
          ? child.promise
          : Promise.resolve(response("/srv/projects")),
    });
    await flush();
    const childButton = mounted.root.querySelector<HTMLButtonElement>(
      '[aria-label="Browse directory oc-ui"]',
    );
    expect(childButton).not.toBeNull();
    childButton?.click();
    expect(mounted.root.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
      true,
    );
    mounted.root.querySelector("form")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));
    expect(mounted.onAddProject).not.toHaveBeenCalled();

    child.resolve(response("/srv/projects/oc-ui"));
    await flush();
    mounted.root.querySelector("form")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));
    expect(mounted.onAddProject).toHaveBeenCalledWith({
      directory: "/srv/projects/oc-ui",
      workspaceID: "remote-workspace",
    });
    mounted.dispose();
  });

  it("shows validation without clearing the open directory", async () => {
    const mounted = mount({
      error: { kind: "validation", message: "This directory cannot be added as a project." },
    });
    await flush();
    const browser = mounted.root.querySelector<HTMLElement>(".server-directory-browser");
    expect(mounted.root.textContent).toContain("This directory cannot be added as a project.");
    expect(mounted.root.textContent).toContain("/srv/projects");
    expect(browser?.contains(document.activeElement) || document.activeElement === browser).toBe(
      true,
    );
    mounted.dispose();
  });

  it("offers retry after the server rejects the project", async () => {
    const mounted = mount();
    await flush();
    const submit = mounted.root.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    submit.click();
    expect(mounted.onAddProject).toHaveBeenCalledTimes(1);
    mounted.setAdding(true);
    mounted.setAdding(false);
    mounted.setError({ kind: "add-project", message: "The server rejected this project." });
    await flush();
    expect(mounted.root.textContent).toContain("Project could not be added");
    expect(document.activeElement).toBe(mounted.root.querySelector('[role="alert"]'));
    expect(submit.textContent).toContain("Try again");
    expect(submit.disabled).toBe(false);
    submit.click();
    expect(mounted.onAddProject.mock.calls).toEqual([
      [{ directory: "/srv/projects", workspaceID: "remote-workspace" }],
      [{ directory: "/srv/projects", workspaceID: "remote-workspace" }],
    ]);
    mounted.dispose();
  });

  it("blocks dismissal and disables controls while adding", async () => {
    const mounted = mount({ adding: true });
    await flush();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(mounted.onClose).not.toHaveBeenCalled();
    expect(mounted.root.querySelector('[aria-label="Close add project dialog"]')).toBeNull();
    expect(
      [...mounted.root.querySelectorAll<HTMLButtonElement>("button")].every(
        (button) => button.disabled,
      ),
    ).toBe(true);
    expect(mounted.root.textContent).toContain("Adding project");
    mounted.dispose();
  });
});
