import type { FileListOutput, LocationRef, OpenCodeClient } from "@opencode-ai/client";
import { useDialog } from "@opencode-ai/ui/context/dialog";
import { createSignal } from "solid-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { mount as mountView } from "../../../../../../test/mount.ts";
import { deferred } from "../../../../../../test/deferred.ts";
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
    name: "/srv/projects/oc-ui",
    location: { directory: "/srv/projects/oc-ui" },
    vcs: "git",
  },
  { id: "api", name: "API", location: { directory: "/srv/projects/api" }, vcs: "git" },
] as const;

const originalElementScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: () => undefined,
  });
});

afterAll(() => {
  if (originalElementScrollTo) {
    Object.defineProperty(HTMLElement.prototype, "scrollTo", originalElementScrollTo);
    return;
  }
  Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
});

const listDirectory = vi.fn<OpenCodeClient["file"]["list"]>((input) => {
  const directory = input?.location?.directory ?? "/";
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
    onAddProject: vi.fn<() => void>(),
    onProjectChange: vi.fn<(projectID: string) => void>(),
    onModeChange: vi.fn<NewSessionDialogProps["onModeChange"]>(),
    onOpenWorktreeForm: vi.fn<NewSessionDialogProps["onOpenWorktreeForm"]>(),
    onWorktreeParentChange: vi.fn<(location: LocationRef) => void>(),
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
  directoryList: OpenCodeClient["file"]["list"] = listDirectory,
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
            listDirectory={directoryList}
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

async function flushDialogMount(): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
}

describe("NewSessionDialog", () => {
  it("reports project selection and keeps Back and Cancel actions current", async () => {
    const initialState: NewSessionDialogState = {
      view: "select-project",
      projects,
      selectedProjectID: "oc-ui",
      mode: "direct",
    };
    const [state, setState] = createSignal<NewSessionDialogState>(initialState);
    const mounted = mount(state);
    await flushDialogMount();

    [...mounted.root.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Add project"))
      ?.click();
    expect(mounted.actions.onAddProject).toHaveBeenCalledOnce();

    const trigger = mounted.root.querySelector<HTMLButtonElement>(".new-session-project-trigger");
    expect(trigger?.getAttribute("aria-label")).toBe("Project: oc-ui");
    trigger?.click();
    await flushDialogMount();
    const picker = document.getElementById(trigger?.getAttribute("aria-controls") ?? "");
    expect(mounted.root.contains(picker)).toBe(false);
    const selected = picker?.querySelector('[data-selected="true"] .new-session-project-option');
    expect(selected?.querySelector("strong")?.textContent).toBe("oc-ui");
    expect(selected?.querySelector("span")?.textContent).toBe("/srv/projects/oc-ui");
    [...(picker?.querySelectorAll<HTMLButtonElement>('[data-slot="list-item"]') ?? [])]
      .find((button) => button.textContent?.includes("API"))
      ?.click();
    expect(mounted.actions.onProjectChange).toHaveBeenCalledWith("api");

    setState({ view: "worktree", project: projects[0], folderName: "", finalDirectory: "" });
    mounted.actions.onBack.mockImplementation(() => setState(initialState));
    const back = [...mounted.root.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Back",
    );
    expect(back).toBeDefined();
    back?.click();
    expect(mounted.actions.onBack).toHaveBeenCalledOnce();
    expect(mounted.onClose).not.toHaveBeenCalled();
    expect(back?.textContent).toBe("Cancel");
    back?.click();
    expect(mounted.onClose).toHaveBeenCalledOnce();
    mounted.dispose();
  });

  it("filters projects by name and directory", async () => {
    const mounted = mount(() => ({
      view: "select-project",
      projects,
      selectedProjectID: "oc-ui",
      mode: "direct",
    }));
    await flushDialogMount();

    const trigger = mounted.root.querySelector<HTMLButtonElement>(".new-session-project-trigger");
    trigger?.click();
    await flushDialogMount();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    const contentID = trigger?.getAttribute("aria-controls") ?? "";
    await vi.waitFor(() => {
      expect(
        document.getElementById(contentID)?.querySelector('[data-component="list"] input'),
      ).not.toBeNull();
    });
    const picker = document.getElementById(contentID);
    const search = picker?.querySelector<HTMLInputElement>('[data-component="list"] input');
    expect(search).not.toBeNull();
    if (search) {
      search.value = "/srv/projects/api";
      search.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }
    await vi.waitFor(() => {
      const options = [
        ...(picker?.querySelectorAll<HTMLButtonElement>('[data-slot="list-item"]') ?? []),
      ];
      expect(options).toHaveLength(1);
      expect(options[0]?.textContent).toContain("API");
    });
    mounted.dispose();
  });

  it("closes the project picker with Escape without dismissing the dialog", async () => {
    const mounted = mount(() => ({
      view: "select-project",
      projects,
      selectedProjectID: "oc-ui",
      mode: "direct",
    }));
    await flushDialogMount();
    const trigger = mounted.root.querySelector<HTMLButtonElement>(".new-session-project-trigger");

    trigger?.click();
    await flushDialogMount();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    const contentID = trigger?.getAttribute("aria-controls") ?? "";
    await vi.waitFor(() => expect(document.getElementById(contentID)).not.toBeNull());

    expect(trigger?.matches('[data-server-flow-escape-trigger][aria-expanded="true"]')).toBe(true);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushDialogMount();
    await vi.waitFor(() => {
      expect(document.getElementById(contentID)).toBeNull();
    });
    expect(mounted.onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
    mounted.dispose();
  });

  it("creates a session for the selected project once", async () => {
    const mounted = mount(() => ({
      view: "select-project",
      projects,
      selectedProjectID: "oc-ui",
      mode: "direct",
    }));
    await flushDialogMount();
    const form = mounted.root.querySelector("form");
    form?.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));
    form?.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));
    expect(mounted.actions.onUseProject).toHaveBeenCalledOnce();
    expect(mounted.actions.onUseProject).toHaveBeenCalledWith("oc-ui");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(mounted.onClose).not.toHaveBeenCalled();
    mounted.dispose();
  });

  it("opens worktree setup for the selected Git project", async () => {
    const mounted = mount(() => ({
      view: "select-project",
      projects,
      selectedProjectID: "api",
      mode: "worktree",
    }));
    await flushDialogMount();
    mounted.root.querySelector("form")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));
    expect(mounted.actions.onOpenWorktreeForm).toHaveBeenCalledWith("api");
    mounted.dispose();
  });

  it("keeps creation disabled until a project is selected", async () => {
    const mounted = mount(() => ({ view: "select-project", projects, mode: "direct" }));
    await flushDialogMount();
    expect(
      mounted.root
        .querySelector<HTMLButtonElement>(".new-session-project-trigger")
        ?.getAttribute("aria-label"),
    ).toBe("Project: Select a project");
    expect(mounted.root.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
      true,
    );
    mounted.dispose();
  });

  it("associates project validation with and focuses the project picker", async () => {
    const mounted = mount(() => ({
      view: "select-project",
      projects,
      mode: "direct",
      error: { kind: "validation", field: "project", message: "Choose a project." },
    }));
    await flushDialogMount();
    const projectTrigger = mounted.root.querySelector<HTMLElement>(".new-session-project-trigger");
    expect(projectTrigger?.getAttribute("aria-invalid")).toBe("true");
    expect(projectTrigger?.getAttribute("aria-describedby")).toBe("new-session-project-error");
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(document.activeElement).toBe(projectTrigger);
    mounted.dispose();
  });

  it("does not submit a hidden stale project while projects are unavailable", async () => {
    for (const unavailable of [
      { projectsLoading: true },
      { projectsError: "Projects could not be loaded from the server." },
    ]) {
      const mounted = mount(() => ({
        view: "select-project",
        projects,
        selectedProjectID: "oc-ui",
        mode: "direct",
        ...unavailable,
      }));
      await flushDialogMount();
      const submit = mounted.root.querySelector<HTMLButtonElement>('button[type="submit"]');
      expect(submit?.disabled).toBe(true);
      mounted.root
        .querySelector("form")
        ?.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));
      expect(mounted.actions.onUseProject).not.toHaveBeenCalled();
      mounted.dispose();
    }
  });

  it.each([undefined, "worktree", "session"] as const)(
    "routes worktree submission after %s error",
    async (kind) => {
      const mounted = mount(() => ({
        view: "worktree",
        project: projects[0],
        parentLocation: { directory: "/srv/worktrees" },
        folderName: "feature-one",
        finalDirectory: "/srv/worktrees/feature-one",
        error: kind ? { kind, message: "Creation failed." } : undefined,
      }));
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      mounted.root
        .querySelector("form")
        ?.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));
      expect(mounted.actions.onRetry.mock.calls).toEqual(kind ? [[kind]] : []);
      expect(mounted.actions.onCreateWorktree).toHaveBeenCalledTimes(kind ? 0 : 1);
      mounted.dispose();
    },
  );

  it("does not submit an old worktree parent while navigation is loading", async () => {
    const child = deferred<FileListOutput>();
    const directoryList: OpenCodeClient["file"]["list"] = (input) => {
      const base = input?.location?.directory ?? "/";
      if (base === "/srv/projects/feature") return child.promise;
      return Promise.resolve({
        location: {
          directory: "/srv/projects",
          project: { id: "oc-ui", directory: base, canonical: base },
        },
        data: [{ path: "feature", type: "directory" }],
      });
    };
    const mounted = mount(
      () => ({
        view: "worktree",
        project: projects[0],
        parentLocation: { directory: "/srv/projects" },
        folderName: "feature-one",
        finalDirectory: "/srv/projects/feature-one",
      }),
      undefined,
      directoryList,
    );
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    mounted.root
      .querySelector<HTMLButtonElement>('[aria-label="Browse directory feature"]')
      ?.click();
    mounted.root.querySelector("form")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));
    expect(mounted.actions.onCreateWorktree).not.toHaveBeenCalled();

    child.resolve({
      location: {
        directory: "/srv/projects/feature",
        project: {
          id: "oc-ui",
          directory: "/srv/projects/feature",
          canonical: "/srv/projects/feature",
        },
      },
      data: [],
    });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    mounted.root.querySelector("form")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));
    expect(mounted.actions.onCreateWorktree).toHaveBeenCalledOnce();
    mounted.dispose();
  });

  it("blocks dismissal and controls during both mutation phases", async () => {
    const [mutation] = createSignal<NewSessionDialogProps["mutation"]>("creating-session");
    const mounted = mount(
      () => ({
        view: "worktree",
        project: projects[0],
        parentLocation: { directory: "/srv/worktrees" },
        folderName: "feature-one",
        finalDirectory: "/srv/worktrees/feature-one",
      }),
      mutation,
    );
    await flushDialogMount();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    const layer = mounted.root.closest<HTMLElement>("[data-dialog-layer]");
    const overlay = layer?.previousElementSibling;
    overlay?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    overlay?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(mounted.onClose).not.toHaveBeenCalled();
    expect(mounted.root.querySelector('[aria-label="Close new session dialog"]')).toBeNull();
    expect(
      [...mounted.root.querySelectorAll<HTMLInputElement>("input")].every(
        (input) => input.disabled,
      ),
    ).toBe(true);
    mounted.dispose();
  });
});
