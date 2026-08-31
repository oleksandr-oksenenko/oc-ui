import type { FileListOutput, LocationRef, OpenCodeClient } from "@opencode-ai/client";
import { useDialog } from "@opencode-ai/ui/context/dialog";
import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vite-plus/test";

import { AddProjectDialog, type AddProjectDialogError } from "./AddProjectDialog.tsx";
import {
  ServerFlowDialogProvider,
  useServerFlowDismissBlock,
} from "../../../../../../ui/ServerFlowDialogProvider.tsx";

function response(directory: string): FileListOutput {
  return {
    location: {
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
  const host = document.createElement("div");
  document.body.append(host);
  const list = options.listDirectory ?? listDirectory();
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
            listDirectory={list}
            initialLocation={{ directory: "/srv/projects" }}
            adding={options.adding}
            error={options.error}
            onDismissBlockedChange={setBlocked}
            onAddProject={onAddProject}
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
    list,
    onClose,
    onAddProject,
    dispose: () => (dispose(), host.remove()),
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
    expect(mounted.onAddProject).toHaveBeenCalledWith({ directory: "/srv/projects/oc-ui" });
    mounted.dispose();
  });

  it("does not submit the previous directory while navigation is loading", async () => {
    let resolveChild!: (output: FileListOutput) => void;
    const child = new Promise<FileListOutput>((resolve) => {
      resolveChild = resolve;
    });
    const mounted = mount({
      listDirectory: (input) =>
        input?.location?.directory === "/srv/projects/oc-ui"
          ? child
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

    resolveChild(response("/srv/projects/oc-ui"));
    await flush();
    mounted.root.querySelector("form")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));
    expect(mounted.onAddProject).toHaveBeenCalledWith({ directory: "/srv/projects/oc-ui" });
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
    const mounted = mount({
      error: { kind: "add-project", message: "The server rejected this project." },
    });
    await flush();
    expect(mounted.root.textContent).toContain("Project could not be added");
    expect(document.activeElement).toBeTruthy();
    expect(
      mounted.root.querySelector<HTMLButtonElement>('button[type="submit"]')?.textContent,
    ).toContain("Try again");
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
