import type { FileListOutput, Project, SessionInfo } from "@opencode-ai/client";
import { Show, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  NewSessionFlow,
  type NewSessionFlowProps,
  type NewSessionFlowRuntime,
} from "./NewSessionFlow.tsx";
import { ServerFlowDialogProvider } from "../../../../../ui/ServerFlowDialogProvider.tsx";

const project: Project = {
  id: "oc-ui",
  canonical: "/srv/projects/oc-ui",
  name: "oc-ui",
  vcs: "git",
  time: { created: 1, updated: 1 },
  sandboxes: [],
};

const nonGitProject: Project = {
  id: "docs",
  canonical: "/srv/projects/docs",
  name: "docs",
  time: { created: 1, updated: 1 },
  sandboxes: [],
};

function session(id: string, directory: string): SessionInfo {
  return {
    id,
    projectID: project.id,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1 },
    location: { directory },
  };
}

function fileResponse(directory: string, workspaceID?: string): FileListOutput {
  const location: FileListOutput["location"] = workspaceID
    ? {
        directory,
        workspaceID,
        project: { id: project.id, directory, canonical: project.canonical },
      }
    : {
        directory,
        project: { id: project.id, directory, canonical: project.canonical },
      };
  return {
    location,
    data: [{ path: "worktrees", type: "directory" }],
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function fakeRuntime(
  sessionRequests: readonly Promise<SessionInfo>[],
  options: {
    readonly projects?: readonly Project[];
    readonly acknowledged?: ReadonlyMap<string, SessionInfo>;
    readonly syncAcknowledgement?: SessionInfo;
    readonly syncGate?: Promise<void>;
    readonly defaultLocation?: NewSessionFlowRuntime["defaultLocation"];
  } = {},
) {
  let createIndex = 0;
  const acknowledged = new Map(options.acknowledged);
  const sessionCreate = vi.fn<NewSessionFlowRuntime["data"]["session"]["create"]>(() => ({
    id: `session-${createIndex + 1}`,
    request: sessionRequests[createIndex++]!,
  }));
  const projectSync = vi.fn<NewSessionFlowRuntime["data"]["project"]["sync"]>(() =>
    Promise.resolve(),
  );
  const projectCurrent = vi.fn<NewSessionFlowRuntime["api"]["project"]["current"]>(() =>
    Promise.resolve({ id: project.id, directory: project.canonical, canonical: project.canonical }),
  );
  const worktreeCreate = vi.fn<NewSessionFlowRuntime["api"]["worktree"]["create"]>(() =>
    Promise.resolve({ directory: "/srv/worktrees/feature-one" }),
  );
  const fileList = vi.fn<NewSessionFlowRuntime["api"]["file"]["list"]>((input) => {
    const directory = input?.location?.directory ?? "/";
    return Promise.resolve(fileResponse(directory, input?.location?.workspace));
  });
  const sessionSync = vi.fn<NewSessionFlowRuntime["data"]["session"]["sync"]>(async (sessionID) => {
    await options.syncGate;
    if (options.syncAcknowledgement?.id === sessionID) {
      acknowledged.set(sessionID, options.syncAcknowledgement);
    }
  });
  const sessionGet = vi.fn<NewSessionFlowRuntime["data"]["session"]["get"]>((sessionID) =>
    acknowledged.get(sessionID),
  );
  const admit = vi.fn<(sessionID: string) => void>();
  const remove = vi.fn<(sessionID: string) => void>();

  const runtime: NewSessionFlowRuntime = {
    api: {
      file: { list: fileList },
      project: { current: projectCurrent },
      worktree: { create: worktreeCreate },
    },
    data: {
      project: { list: () => [...(options.projects ?? [project])], sync: projectSync },
      session: { create: sessionCreate, sync: sessionSync, get: sessionGet },
    },
    defaultLocation: options.defaultLocation ?? { directory: "/srv/projects" },
    sessions: { admit, remove },
  };

  return {
    runtime,
    sessionCreate,
    sessionSync,
    sessionGet,
    projectSync,
    projectCurrent,
    worktreeCreate,
    fileList,
    admit,
    remove,
  };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await new Promise<void>((resolve) => queueMicrotask(resolve));
  }
}

async function flushDialogClose(): Promise<void> {
  await new Promise<void>((resolve) => window.setTimeout(resolve, 200));
  await flush();
}

function mount(runtime: NewSessionFlowProps["runtime"]) {
  const host = document.createElement("div");
  document.body.append(host);
  const onDismiss = vi.fn<() => void>();
  const onSessionCreated = vi.fn<(sessionID: string) => void>();
  const [visible, setVisible] = createSignal(true);

  const dispose = render(
    () => (
      <ServerFlowDialogProvider>
        <Show when={visible()}>
          <NewSessionFlow
            runtime={runtime}
            onDismiss={onDismiss}
            onSessionCreated={onSessionCreated}
          />
        </Show>
      </ServerFlowDialogProvider>
    ),
    host,
  );
  return {
    get root() {
      return [...document.querySelectorAll<HTMLElement>("[data-dialog-layer]")].at(-1)!;
    },
    onDismiss,
    onSessionCreated,
    unmountFlow: () => setVisible(false),
    dispose: () => (dispose(), host.remove()),
  };
}

function submit(host: HTMLElement): void {
  host.querySelector("form")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));
}

function clickButton(host: HTMLElement, text: string): void {
  [...host.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === text)
    ?.click();
}

describe("NewSessionFlow", () => {
  it("closes the base dialog with Escape", async () => {
    const fake = fakeRuntime([Promise.resolve(session("session-1", project.canonical))]);
    const mounted = mount(fake.runtime);
    await flush();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(mounted.onDismiss).toHaveBeenCalledOnce();
    mounted.dispose();
  });

  it("closes the base dialog from its backdrop", async () => {
    const fake = fakeRuntime([Promise.resolve(session("session-1", project.canonical))]);
    const mounted = mount(fake.runtime);
    await flush();
    const layer = mounted.root.closest<HTMLElement>("[data-dialog-layer]");
    const overlay = layer?.previousElementSibling;

    overlay?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(mounted.onDismiss).toHaveBeenCalledOnce();
    mounted.dispose();
  });

  it("pops Add Project and restores focus to its opener", async () => {
    const fake = fakeRuntime([Promise.resolve(session("session-1", project.canonical))]);
    const mounted = mount(fake.runtime);
    await flush();
    expect(mounted.onDismiss).not.toHaveBeenCalled();
    const opener = [...mounted.root.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Add project",
    );
    opener?.focus();
    opener?.click();
    await flushDialogClose();
    expect(mounted.root.textContent).toContain("Choose one project directory");
    mounted.onDismiss.mockClear();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushDialogClose();

    expect(mounted.root.textContent).toContain("New session");
    expect(document.activeElement?.textContent?.trim()).toBe("Add project");
    mounted.dispose();
  });

  it("removes its base portal when the flow unmounts", async () => {
    const fake = fakeRuntime([Promise.resolve(session("session-1", project.canonical))]);
    const mounted = mount(fake.runtime);
    await flush();
    const dialogRoot = mounted.root;

    mounted.unmountFlow();
    await flushDialogClose();

    expect(dialogRoot.isConnected).toBe(false);
    expect(mounted.onDismiss).not.toHaveBeenCalled();
    mounted.dispose();
  });

  it("does not mount a base portal after an immediate flow unmount", async () => {
    const overlaysBefore = document.querySelectorAll('[data-component="dialog-overlay"]').length;
    const fake = fakeRuntime([Promise.resolve(session("session-1", project.canonical))]);
    const mounted = mount(fake.runtime);

    mounted.unmountFlow();
    await flushDialogClose();

    expect(document.querySelectorAll('[data-component="dialog-overlay"]')).toHaveLength(
      overlaysBefore,
    );
    mounted.dispose();
  });

  it("removes its Add Project portal when the flow unmounts", async () => {
    const fake = fakeRuntime([Promise.resolve(session("session-1", project.canonical))]);
    const mounted = mount(fake.runtime);
    await flush();
    clickButton(mounted.root, "Add project");
    await flush();
    const dialogRoot = mounted.root;

    mounted.unmountFlow();
    await flushDialogClose();

    expect(dialogRoot.isConnected).toBe(false);
    expect(mounted.onDismiss).not.toHaveBeenCalled();
    mounted.dispose();
  });

  it("does not mount Add Project after an immediate flow unmount", async () => {
    const overlaysBefore = document.querySelectorAll('[data-component="dialog-overlay"]').length;
    const fake = fakeRuntime([Promise.resolve(session("session-1", project.canonical))]);
    const mounted = mount(fake.runtime);
    await flush();

    clickButton(mounted.root, "Add project");
    mounted.unmountFlow();
    await flushDialogClose();

    expect(document.querySelectorAll('[data-component="dialog-overlay"]')).toHaveLength(
      overlaysBefore,
    );
    mounted.dispose();
  });

  it("creates a direct session in the selected project's canonical directory", async () => {
    const fake = fakeRuntime([Promise.resolve(session("session-1", project.canonical))]);
    const mounted = mount(fake.runtime);
    await flush();
    const dialogRoot = mounted.root;

    submit(dialogRoot);
    await flushDialogClose();

    expect(fake.sessionCreate).toHaveBeenCalledWith({
      projectID: project.id,
      location: { directory: project.canonical },
    });
    expect(fake.admit).toHaveBeenCalledWith("session-1");
    expect(fake.remove).not.toHaveBeenCalled();
    expect(mounted.onSessionCreated).toHaveBeenCalledWith("session-1");
    expect(mounted.onDismiss).toHaveBeenCalledOnce();
    expect(dialogRoot.isConnected).toBe(false);
    mounted.dispose();
  });

  it("creates a non-Git project session directly without offering a worktree", async () => {
    const fake = fakeRuntime([Promise.resolve(session("session-1", nonGitProject.canonical))], {
      projects: [nonGitProject],
    });
    const mounted = mount(fake.runtime);
    await flush();

    expect(mounted.root.textContent).not.toContain("Create a worktree");
    submit(mounted.root);
    await flushDialogClose();

    expect(fake.sessionCreate).toHaveBeenCalledWith({
      projectID: nonGitProject.id,
      location: { directory: nonGitProject.canonical },
    });
    expect(mounted.onSessionCreated).toHaveBeenCalledWith("session-1");
    mounted.dispose();
  });

  it("ignores a pending session creation after the flow unmounts", async () => {
    const pendingSession = deferred<SessionInfo>();
    const fake = fakeRuntime([pendingSession.promise]);
    const mounted = mount(fake.runtime);
    await flush();

    submit(mounted.root);
    await flush();
    mounted.unmountFlow();
    pendingSession.resolve(session("session-1", project.canonical));
    await flushDialogClose();

    expect(mounted.onSessionCreated).not.toHaveBeenCalled();
    expect(mounted.onDismiss).not.toHaveBeenCalled();
    mounted.dispose();
  });

  it("preserves workspace scope when browsing, adding, and using a project", async () => {
    const fake = fakeRuntime([Promise.resolve(session("session-1", project.canonical))], {
      defaultLocation: { directory: "/srv/projects", workspaceID: "workspace-a" },
    });
    const mounted = mount(fake.runtime);
    await flush();

    clickButton(mounted.root, "Add project");
    await flushDialogClose();

    expect(fake.fileList).toHaveBeenCalledWith({
      location: { directory: "/srv/projects", workspace: "workspace-a" },
      path: ".",
    });
    submit(mounted.root);
    await flushDialogClose();

    expect(fake.projectCurrent).toHaveBeenCalledWith({
      location: { directory: "/srv/projects", workspace: "workspace-a" },
    });
    submit(mounted.root);
    await flushDialogClose();

    expect(fake.sessionCreate).toHaveBeenCalledWith({
      projectID: project.id,
      location: { directory: "/srv/projects", workspaceID: "workspace-a" },
    });
    mounted.dispose();
  });

  it("uses the directory currently open in the add-project browser", async () => {
    const fake = fakeRuntime([Promise.resolve(session("session-1", project.canonical))]);
    const mounted = mount(fake.runtime);
    await flush();

    clickButton(mounted.root, "Add project");
    await flushDialogClose();
    clickButton(mounted.root, "worktrees");
    await flush();
    submit(mounted.root);
    await flushDialogClose();

    expect(fake.projectCurrent).toHaveBeenCalledWith({
      location: { directory: "/srv/projects/worktrees" },
    });
    expect(fake.projectSync).toHaveBeenCalledTimes(2);
    submit(mounted.root);
    await flushDialogClose();
    expect(fake.sessionCreate).toHaveBeenCalledWith({
      projectID: project.id,
      location: { directory: "/srv/projects/worktrees" },
    });
    mounted.dispose();
  });

  it.each(["/Users/alex/code/oc-ui", "C:\\Users\\alex\\code\\oc-ui", "\\\\server\\share\\oc-ui"])(
    "opens the add-project browser at the exact server default %s",
    async (location) => {
      const fake = fakeRuntime([Promise.resolve(session("session-1", project.canonical))]);
      const mounted = mount({
        ...fake.runtime,
        defaultLocation: { directory: location },
      });
      await flush();

      clickButton(mounted.root, "Add project");
      await flush();

      expect(fake.fileList).toHaveBeenCalledWith({
        location: { directory: location },
        path: ".",
      });
      mounted.dispose();
    },
  );

  it("retries only session creation when a created worktree is orphaned", async () => {
    const failedSession = Promise.reject(new Error("session failed"));
    const fake = fakeRuntime([
      failedSession,
      Promise.resolve(session("session-2", "/srv/worktrees/feature-one")),
    ]);
    const mounted = mount(fake.runtime);
    await flush();

    mounted.root.querySelector<HTMLInputElement>('input[value="worktree"]')?.click();
    submit(mounted.root);
    await flush();

    const name = mounted.root.querySelector<HTMLInputElement>("input");
    if (name) {
      name.value = "feature-one";
      name.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }
    submit(mounted.root);
    await flush();

    expect(fake.worktreeCreate).toHaveBeenCalledWith({
      projectID: project.id,
      strategy: "git",
      from: project.canonical,
      directory: "/srv/projects",
      name: "feature-one",
    });
    expect(fake.sessionCreate).toHaveBeenCalledWith({
      projectID: project.id,
      location: { directory: "/srv/worktrees/feature-one" },
    });
    expect(fake.remove).toHaveBeenCalledWith("session-1");
    await vi.waitFor(() => {
      expect(mounted.root.textContent).toContain("/srv/worktrees/feature-one");
    });

    submit(mounted.root);
    await flush();

    expect(fake.worktreeCreate).toHaveBeenCalledOnce();
    expect(fake.sessionCreate).toHaveBeenCalledTimes(2);
    expect(fake.remove).toHaveBeenCalledWith("session-1");
    expect(mounted.onSessionCreated).toHaveBeenCalledWith("session-2");
    mounted.dispose();
  });

  it("preserves worktree inputs and retries worktree creation after failure", async () => {
    const fake = fakeRuntime([Promise.resolve(session("session-1", "/srv/worktrees/feature-one"))]);
    fake.worktreeCreate
      .mockRejectedValueOnce(new Error("worktree failed"))
      .mockResolvedValueOnce({ directory: "/srv/worktrees/feature-one" });
    const mounted = mount(fake.runtime);
    await flush();

    mounted.root.querySelector<HTMLInputElement>('input[value="worktree"]')?.click();
    submit(mounted.root);
    await flush();
    const name = mounted.root.querySelector<HTMLInputElement>("input");
    if (name) {
      name.value = "feature-one";
      name.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }

    submit(mounted.root);
    await flush();

    expect(mounted.root.textContent).toContain("Worktree creation failed");
    expect(mounted.root.querySelector<HTMLInputElement>("input")?.value).toBe("feature-one");
    submit(mounted.root);
    await flush();

    expect(fake.worktreeCreate).toHaveBeenCalledTimes(2);
    expect(mounted.onSessionCreated).toHaveBeenCalledWith("session-1");
    mounted.dispose();
  });

  it("retries a failed direct session without changing the selected project", async () => {
    const fake = fakeRuntime([
      Promise.reject(new Error("session failed")),
      Promise.resolve(session("session-2", project.canonical)),
    ]);
    const mounted = mount(fake.runtime);
    await flush();
    const dialogRoot = mounted.root;

    submit(dialogRoot);
    await flush();
    expect(mounted.root.textContent).toContain("Session creation failed");

    submit(mounted.root);
    await flush();

    expect(fake.sessionCreate).toHaveBeenCalledTimes(2);
    expect(fake.remove).toHaveBeenCalledWith("session-1");
    expect(mounted.onSessionCreated).toHaveBeenCalledWith("session-2");
    mounted.dispose();
  });

  it("keeps a session acknowledged by the event stream when its request rejects", async () => {
    const acknowledged = session("session-1", project.canonical);
    const fake = fakeRuntime([Promise.reject(new Error("response lost"))], {
      acknowledged: new Map([[acknowledged.id, acknowledged]]),
    });
    const mounted = mount(fake.runtime);
    await flush();
    const dialogRoot = mounted.root;

    submit(dialogRoot);
    await flushDialogClose();

    expect(fake.sessionGet).toHaveBeenCalledWith("session-1");
    expect(fake.remove).not.toHaveBeenCalled();
    expect(mounted.onSessionCreated).toHaveBeenCalledWith("session-1");
    expect(mounted.onDismiss).toHaveBeenCalledOnce();
    expect(dialogRoot.isConnected).toBe(false);
    mounted.dispose();
  });

  it("reconciles session creation after a request rejection while hydration is pending", async () => {
    const acknowledged = session("session-1", project.canonical);
    let resolveSync!: () => void;
    const syncGate = new Promise<void>((resolve) => {
      resolveSync = resolve;
    });
    const fake = fakeRuntime([Promise.reject(new Error("response lost"))], {
      syncAcknowledgement: acknowledged,
      syncGate,
    });
    const mounted = mount(fake.runtime);
    await flush();

    submit(mounted.root);
    await flush();

    expect(fake.sessionSync).toHaveBeenCalledWith("session-1");
    expect(fake.sessionGet).not.toHaveBeenCalled();
    expect(fake.remove).not.toHaveBeenCalled();

    resolveSync();
    await flushDialogClose();

    expect(fake.sessionGet).toHaveBeenCalledWith("session-1");
    expect(mounted.onSessionCreated).toHaveBeenCalledWith("session-1");
    expect(mounted.onDismiss).toHaveBeenCalledOnce();
    mounted.dispose();
  });
});
