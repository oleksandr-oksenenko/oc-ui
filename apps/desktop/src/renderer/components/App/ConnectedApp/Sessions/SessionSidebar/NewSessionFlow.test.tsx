import type { FileListOutput, Project, SessionInfo } from "@opencode-ai/client";
import * as toastModule from "@opencode-ai/ui/toast";
import { Show, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  createSessionWorktree,
  type CreatedSessionWorktree,
} from "../../../../../opencode/create-session-worktree.ts";
import {
  NewSessionFlow,
  type NewSessionFlowProps,
  type NewSessionFlowRuntime,
} from "./NewSessionFlow.tsx";
import { ServerFlowDialogProvider } from "../../../../../ui/ServerFlowDialogProvider.tsx";

vi.mock("../../../../../opencode/create-session-worktree.ts", () => ({
  createSessionWorktree: vi.fn<typeof createSessionWorktree>(),
}));

beforeAll(() => {
  Object.defineProperty(window, "scrollTo", { configurable: true, value: () => undefined });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: () => undefined,
  });
});

beforeEach(() => vi.mocked(createSessionWorktree).mockReset());

const dismissToast = vi.spyOn(toastModule.toaster, "dismiss");
const showToast = vi.spyOn(toastModule, "showToast");

beforeEach(() => {
  toastModule.toaster.dismiss();
  dismissToast.mockClear();
  showToast.mockClear();
});

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
  return { location, data: [{ path: "worktrees", type: "directory" }] };
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
      location: { get: vi.fn<NewSessionFlowRuntime["api"]["location"]["get"]>() },
      shell: {
        create: vi.fn<NewSessionFlowRuntime["api"]["shell"]["create"]>(),
        output: vi.fn<NewSessionFlowRuntime["api"]["shell"]["output"]>(),
        remove: vi.fn<NewSessionFlowRuntime["api"]["shell"]["remove"]>(),
        list: vi.fn<NewSessionFlowRuntime["api"]["shell"]["list"]>(),
        get: vi.fn<NewSessionFlowRuntime["api"]["shell"]["get"]>(),
        timeout: vi.fn<NewSessionFlowRuntime["api"]["shell"]["timeout"]>(),
      },
      worktree: {
        create: vi.fn<NewSessionFlowRuntime["api"]["worktree"]["create"]>(),
        list: vi.fn<NewSessionFlowRuntime["api"]["worktree"]["list"]>(),
        remove: vi.fn<NewSessionFlowRuntime["api"]["worktree"]["remove"]>(),
        refresh: vi.fn<NewSessionFlowRuntime["api"]["worktree"]["refresh"]>(),
      },
    },
    onShellExited: vi.fn<NewSessionFlowRuntime["onShellExited"]>(() => () => undefined),
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

async function chooseProject(host: HTMLElement, name: string): Promise<void> {
  host.querySelector<HTMLButtonElement>(".new-session-project-trigger")?.click();
  await flush();
  const pickerID = host
    .querySelector<HTMLButtonElement>(".new-session-project-trigger")
    ?.getAttribute("aria-controls");
  const picker = pickerID ? document.getElementById(pickerID) : undefined;
  [...(picker?.querySelectorAll<HTMLButtonElement>('[data-slot="list-item"]') ?? [])]
    .find((button) => button.textContent?.includes(name))
    ?.click();
  await flush();
}

describe("NewSessionFlow", () => {
  it("creates a direct session in the selected project", async () => {
    const fake = fakeRuntime([Promise.resolve(session("session-1", project.canonical))]);
    const mounted = mount(fake.runtime);
    await flush();
    submit(mounted.root);
    await flushDialogClose();
    expect(fake.sessionCreate).toHaveBeenCalledWith({
      projectID: project.id,
      location: { directory: project.canonical },
    });
    expect(mounted.onSessionCreated).toHaveBeenCalledWith("session-1");
    mounted.dispose();
  });

  it("creates a non-Git project directly without offering a worktree", async () => {
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
    mounted.dispose();
  });

  it("retries a failed direct session in the selected project", async () => {
    const fake = fakeRuntime([
      Promise.reject(new Error("session failed")),
      Promise.resolve(session("session-2", project.canonical)),
    ]);
    const mounted = mount(fake.runtime);
    await flush();
    submit(mounted.root);
    await flush();
    await vi.waitFor(() => expect(mounted.root.textContent).toContain("Session creation failed"));
    submit(mounted.root);
    await flushDialogClose();
    expect(fake.sessionCreate).toHaveBeenCalledTimes(2);
    expect(fake.sessionCreate).toHaveBeenLastCalledWith({
      projectID: project.id,
      location: { directory: project.canonical },
    });
    expect(mounted.onSessionCreated).toHaveBeenCalledWith("session-2");
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

  it("keeps Add Project browsing on the connected server", async () => {
    const fake = fakeRuntime([Promise.resolve(session("session-1", project.canonical))]);
    const mounted = mount(fake.runtime);
    await flush();
    clickButton(mounted.root, "Add project");
    await flushDialogClose();
    expect(fake.fileList).toHaveBeenCalledWith({
      location: { directory: "/srv/projects" },
      path: ".",
    });
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

  it("clears the failed session error after adding a project", async () => {
    vi.mocked(createSessionWorktree).mockResolvedValueOnce({
      location: { directory: "/srv/worktrees/feature-one" },
    });
    const fake = fakeRuntime(
      [
        Promise.reject(new Error("session failed")),
        Promise.resolve(session("session-2", nonGitProject.canonical)),
      ],
      { projects: [project, nonGitProject] },
    );
    fake.projectCurrent.mockResolvedValueOnce({
      id: nonGitProject.id,
      directory: "/srv/projects/worktrees",
      canonical: nonGitProject.canonical,
    });
    const mounted = mount(fake.runtime);
    await flush();

    mounted.root.querySelector<HTMLInputElement>('input[value="worktree"]')?.click();
    submit(mounted.root);
    await flush();
    await vi.waitFor(() =>
      expect(mounted.root.textContent).toContain("/srv/worktrees/feature-one"),
    );

    clickButton(mounted.root, "Add project");
    await flushDialogClose();
    clickButton(mounted.root, "worktrees");
    await flush();
    submit(mounted.root);
    await flushDialogClose();

    expect(mounted.root.textContent).not.toContain("/srv/worktrees/feature-one");
    expect(mounted.root.textContent).toContain("Create session");
    submit(mounted.root);
    await flushDialogClose();
    expect(mounted.onSessionCreated).toHaveBeenCalledWith("session-2");
    mounted.dispose();
  });

  it("keeps an abandoned worktree notice after an unrelated session succeeds", async () => {
    vi.mocked(createSessionWorktree).mockResolvedValueOnce({
      location: { directory: "/srv/worktrees/feature-one" },
    });
    const fake = fakeRuntime(
      [
        Promise.reject(new Error("session failed")),
        Promise.resolve(session("session-2", nonGitProject.canonical)),
      ],
      { projects: [project, nonGitProject] },
    );
    const mounted = mount(fake.runtime);
    await flush();

    mounted.root.querySelector<HTMLInputElement>('input[value="worktree"]')?.click();
    submit(mounted.root);
    await flush();
    await vi.waitFor(() =>
      expect(mounted.root.textContent).toContain("/srv/worktrees/feature-one"),
    );
    await chooseProject(mounted.root, "docs");
    submit(mounted.root);
    await flushDialogClose();

    expect(mounted.onSessionCreated).toHaveBeenCalledWith("session-2");
    expect(dismissToast).not.toHaveBeenCalled();
    mounted.dispose();
  });

  it("shows a second retained notice when a later worktree also fails", async () => {
    vi.mocked(createSessionWorktree)
      .mockResolvedValueOnce({ location: { directory: "/srv/worktrees/feature-one" } })
      .mockResolvedValueOnce({ location: { directory: "/srv/worktrees/feature-two" } });
    const fake = fakeRuntime([
      Promise.reject(new Error("first session failed")),
      Promise.reject(new Error("second session failed")),
    ]);
    const mounted = mount(fake.runtime);
    await flush();

    mounted.root.querySelector<HTMLInputElement>('input[value="worktree"]')?.click();
    submit(mounted.root);
    await flush();
    await vi.waitFor(() =>
      expect(mounted.root.textContent).toContain("/srv/worktrees/feature-one"),
    );

    mounted.root.querySelector<HTMLInputElement>('input[value="direct"]')?.click();
    mounted.root.querySelector<HTMLInputElement>('input[value="worktree"]')?.click();
    submit(mounted.root);
    await flush();
    await vi.waitFor(() =>
      expect(mounted.root.textContent).toContain("/srv/worktrees/feature-two"),
    );

    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "The worktree remains at /srv/worktrees/feature-one.",
        persistent: true,
      }),
    );
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "The worktree remains at /srv/worktrees/feature-two.",
        persistent: true,
      }),
    );
    mounted.dispose();
  });

  it.each(["/Users/alex/code/oc-ui", "C:\\Users\\alex\\code\\oc-ui", "\\\\server\\share\\oc-ui"])(
    "opens the add-project browser at the exact server default %s",
    async (location) => {
      const fake = fakeRuntime([Promise.resolve(session("session-1", project.canonical))]);
      const mounted = mount({ ...fake.runtime, defaultLocation: { directory: location } });
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

  it("creates the worktree before creating its session", async () => {
    const worktree = {
      location: { directory: "/srv/worktrees/feature-one" },
    } satisfies CreatedSessionWorktree;
    vi.mocked(createSessionWorktree).mockResolvedValueOnce(worktree);
    const fake = fakeRuntime([Promise.resolve(session("session-1", worktree.location.directory))]);
    const mounted = mount(fake.runtime);
    await flush();
    mounted.root.querySelector<HTMLInputElement>('input[value="worktree"]')?.click();
    submit(mounted.root);
    await flushDialogClose();
    expect(createSessionWorktree).toHaveBeenCalledWith(
      expect.objectContaining({ api: fake.runtime.api, isCurrent: expect.any(Function) }),
      { directory: project.canonical },
    );
    expect(fake.sessionCreate).toHaveBeenCalledWith({
      projectID: project.id,
      location: worktree.location,
    });
    mounted.dispose();
  });

  it("shows a new retained warning when a retry fails after dismissal", async () => {
    vi.mocked(createSessionWorktree).mockResolvedValueOnce({
      location: { directory: "/srv/worktrees/feature-one" },
    });
    const retry = deferred<SessionInfo>();
    const fake = fakeRuntime([Promise.reject(new Error("session failed")), retry.promise]);
    const mounted = mount(fake.runtime);
    await flush();
    mounted.root.querySelector<HTMLInputElement>('input[value="worktree"]')?.click();
    submit(mounted.root);
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledOnce());
    const firstToast = showToast.mock.results[0]?.value;
    toastModule.toaster.dismiss(firstToast);
    submit(mounted.root);
    retry.resolve(Promise.reject(new Error("retry failed")));
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledTimes(2));
    expect(showToast.mock.results[1]?.value).not.toBe(firstToast);
    expect(createSessionWorktree).toHaveBeenCalledOnce();
    mounted.dispose();
  });

  it("retries only session creation for a ready retained worktree", async () => {
    vi.mocked(createSessionWorktree).mockResolvedValueOnce({
      location: { directory: "/srv/worktrees/feature-one" },
    });
    const fake = fakeRuntime([
      Promise.reject(new Error("session failed")),
      Promise.resolve(session("session-2", "/srv/worktrees/feature-one")),
    ]);
    const mounted = mount(fake.runtime);
    await flush();
    mounted.root.querySelector<HTMLInputElement>('input[value="worktree"]')?.click();
    submit(mounted.root);
    await flush();
    await vi.waitFor(() =>
      expect(mounted.root.textContent).toContain("/srv/worktrees/feature-one"),
    );
    submit(mounted.root);
    await flushDialogClose();
    expect(createSessionWorktree).toHaveBeenCalledOnce();
    expect(fake.sessionCreate).toHaveBeenCalledTimes(2);
    expect(mounted.onSessionCreated).toHaveBeenCalledWith("session-2");
    expect(dismissToast).toHaveBeenCalledOnce();
    mounted.dispose();
  });

  it("keeps a session acknowledged by the event stream when its request rejects", async () => {
    const acknowledged = session("session-1", project.canonical);
    const fake = fakeRuntime([Promise.reject(new Error("response lost"))], {
      acknowledged: new Map([[acknowledged.id, acknowledged]]),
    });
    const mounted = mount(fake.runtime);
    await flush();

    submit(mounted.root);
    await flushDialogClose();

    expect(fake.sessionGet).toHaveBeenCalledWith("session-1");
    expect(fake.remove).not.toHaveBeenCalled();
    expect(mounted.onSessionCreated).toHaveBeenCalledWith("session-1");
    expect(mounted.onDismiss).toHaveBeenCalledOnce();
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

  it("does not start worktree or session creation after teardown", async () => {
    const pending = deferred<CreatedSessionWorktree>();
    vi.mocked(createSessionWorktree).mockReturnValueOnce(pending.promise);
    const fake = fakeRuntime([Promise.resolve(session("session-1", project.canonical))]);
    const mounted = mount(fake.runtime);
    await flush();
    mounted.root.querySelector<HTMLInputElement>('input[value="worktree"]')?.click();
    submit(mounted.root);
    mounted.unmountFlow();
    pending.resolve({ location: { directory: "/srv/worktrees/late" } });
    await flushDialogClose();
    expect(fake.sessionCreate).not.toHaveBeenCalled();
    mounted.dispose();
  });
});
