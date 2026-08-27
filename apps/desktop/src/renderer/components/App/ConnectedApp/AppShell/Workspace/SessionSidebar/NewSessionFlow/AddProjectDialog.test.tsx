import type { FileListOutput, OpenCodeClient } from "@opencode-ai/client";
import { render } from "solid-js/web";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { AddProjectDialog, type AddProjectDialogError } from "./AddProjectDialog.tsx";

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
    const base = input?.location?.directory ?? "/";
    const directory =
      input?.path === "oc-ui" && base === "/srv/projects" ? "/srv/projects/oc-ui" : base;
    return Promise.resolve(response(directory));
  });
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  await new Promise<void>((resolve) => queueMicrotask(resolve));
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

function mount(
  options: {
    readonly adding?: boolean;
    readonly error?: AddProjectDialogError;
  } = {},
) {
  const host = document.createElement("div");
  document.body.append(host);
  const list = listDirectory();
  const onDismiss = vi.fn<() => void>();
  const onAddProject = vi.fn<(directory: string) => void>();
  const dispose = render(
    () => (
      <AddProjectDialog
        listDirectory={list}
        initialDirectory="/srv/projects"
        adding={options.adding}
        error={options.error}
        onDismiss={onDismiss}
        onAddProject={onAddProject}
      />
    ),
    host,
  );
  return {
    host,
    list,
    onDismiss,
    onAddProject,
    dispose: () => (dispose(), host.remove()),
  };
}

describe("AddProjectDialog", () => {
  it("submits the directory currently open in the server browser", async () => {
    const mounted = mount();
    await flush();
    mounted.host.querySelector<HTMLButtonElement>('[aria-label="Browse directory oc-ui"]')?.click();
    await flush();

    mounted.host.querySelector("form")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));
    expect(mounted.onAddProject).toHaveBeenCalledOnce();
    expect(mounted.onAddProject).toHaveBeenCalledWith("/srv/projects/oc-ui");
    mounted.dispose();
  });

  it("shows validation without clearing the open directory", async () => {
    const mounted = mount({
      error: { kind: "validation", message: "This directory cannot be added as a project." },
    });
    await flush();
    const browser = mounted.host.querySelector<HTMLElement>(".server-directory-browser");
    expect(mounted.host.textContent).toContain("This directory cannot be added as a project.");
    expect(mounted.host.textContent).toContain("/srv/projects");
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
    expect(mounted.host.textContent).toContain("Project could not be added");
    expect(mounted.host.querySelector<HTMLElement>(".server-flow-operation-error")).toBe(
      document.activeElement,
    );
    expect(
      mounted.host.querySelector<HTMLButtonElement>('button[type="submit"]')?.textContent,
    ).toContain("Try again");
    mounted.dispose();
  });

  it("blocks dismissal and disables controls while adding", async () => {
    const mounted = mount({ adding: true });
    await flush();
    const dialog = mounted.host.querySelector<HTMLDialogElement>("dialog");
    dialog?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(mounted.onDismiss).not.toHaveBeenCalled();
    expect(mounted.host.querySelector('[aria-label="Close add project dialog"]')).toBeNull();
    expect(
      [...mounted.host.querySelectorAll<HTMLButtonElement>("button")].every(
        (button) => button.disabled,
      ),
    ).toBe(true);
    expect(mounted.host.textContent).toContain("Adding project");
    mounted.dispose();
  });
});
