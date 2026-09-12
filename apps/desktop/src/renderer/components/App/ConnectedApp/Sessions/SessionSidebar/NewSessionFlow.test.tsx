import { RegistryContext } from "@effect/atom-solid";
import { Effect, Exit, Scope } from "effect";
import { withTestWorkspace } from "../../../../../test/workspace.ts";
import { deferred } from "../../../../../test/deferred.ts";
import { sessionFixture } from "../../../../../test/session-fixture.ts";
import type { FileListOutput, Project, SessionInfo } from "@opencode-ai/client";
import * as toastModule from "@opencode-ai/ui/toast";
import { Show, createSignal } from "solid-js";
import { mount as mountView } from "../../../../../test/mount.ts";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  createSessionWorktree,
  type CreatedSessionWorktree,
} from "../../../../../opencode/create-session-worktree.ts";
import {
  NewSessionFlow,
  createNewSessionFlow,
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

beforeEach(() => {
  vi.mocked(createSessionWorktree).mockReset();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => vi.useRealTimers());

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
  return sessionFixture({ id, projectID: project.id, location: { directory } });
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
    effects: withTestWorkspace((effects) => effects),
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
  await flush();
  // The pinned DialogProvider closes after 100 ms; the app restores focus at 110 ms.
  vi.advanceTimersByTime(110);
  await flush();
}

function controller(runtime: NewSessionFlowRuntime) {
  const onDismiss = vi.fn<() => void>();
  const onSessionCreated = vi.fn<(sessionID: string) => void>();
  const flow = createNewSessionFlow({ runtime, onDismiss, onSessionCreated });
  return { flow, onDismiss, onSessionCreated, dispose: flow.dispose };
}

function mount(runtime: NewSessionFlowRuntime) {
  const { flow, onDismiss, onSessionCreated } = controller(runtime);
  const [visible, setVisible] = createSignal(true);
  const { dispose } = mountView(() => (
    <RegistryContext.Provider value={runtime.effects.registry}>
      <ServerFlowDialogProvider>
        <Show when={visible()}>
          <NewSessionFlow flow={flow} />
        </Show>
      </ServerFlowDialogProvider>
    </RegistryContext.Provider>
  ));
  return {
    get root() {
      return [...document.querySelectorAll<HTMLElement>("[data-dialog-layer]")].at(-1)!;
    },
    onDismiss,
    onSessionCreated,
    flow,
    unmountFlow: () => setVisible(false),
    remountFlow: () => setVisible(true),
    dispose,
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
  it("reconnects a remounted view to the pending creation without admitting a duplicate", async () => {
    const pending = deferred<SessionInfo>();
    const fake = fakeRuntime([pending.promise]);
    const mounted = mount(fake.runtime);
    await flush();
    submit(mounted.root);
    await flush();
    mounted.unmountFlow();
    mounted.remountFlow();
    await flushDialogClose();
    expect(mounted.root.textContent).toContain("Creating session");
    mounted.flow.useProject(project.id);
    submit(mounted.root);
    expect(fake.sessionCreate).toHaveBeenCalledOnce();
    pending.reject(new Error("offline"));
    await flush();
    expect(mounted.root.textContent).toContain("The session could not be created.");
    mounted.dispose();
  });

  it.each([
    {
      outcome: "failed",
      admitted: [],
      removed: [["session-1"]],
      notices: [
        {
          title: "Worktree retained",
          description: "The worktree remains at /srv/worktrees/interrupted.",
        },
      ],
    },
    { outcome: "acknowledged", admitted: [["session-1"]], removed: [], notices: [] },
  ])(
    "reconciles $outcome session creation after workspace interruption retains its worktree",
    async ({ outcome, admitted, removed, notices }) => {
      const location = { directory: "/srv/worktrees/interrupted" };
      vi.mocked(createSessionWorktree).mockReturnValueOnce(Effect.succeed({ location }));
      const pending = deferred<SessionInfo>();
      const fake = fakeRuntime([pending.promise], {
        syncAcknowledgement:
          outcome === "acknowledged" ? session("session-1", location.directory) : undefined,
      });
      const onSessionCreated = vi.fn<(sessionID: string) => void>();
      const flow = createNewSessionFlow({
        runtime: fake.runtime,
        onDismiss: vi.fn<() => void>(),
        onSessionCreated,
      });
      await flush();
      flow.createWorktree();
      await vi.waitFor(() => expect(fake.sessionCreate).toHaveBeenCalledOnce());
      let closed = false;
      const closing = Effect.runPromise(Scope.close(fake.runtime.effects.scope, Exit.void)).then(
        () => {
          closed = true;
          return undefined;
        },
      );
      await flush();
      expect(closed).toBe(false);
      pending.reject(new Error("response lost"));
      await closing;
      expect(fake.sessionSync).toHaveBeenCalledWith("session-1");
      expect(onSessionCreated).not.toHaveBeenCalled();
      expect(fake.remove.mock.calls).toEqual(removed);
      expect(fake.admit.mock.calls).toEqual(admitted);
      expect(showToast.mock.calls.map(([notice]) => notice)).toMatchObject(notices);
    },
  );

  it("creates a direct session in the selected project", async () => {
    const fake = fakeRuntime([Promise.resolve(session("session-1", project.canonical))]);
    const operation = controller(fake.runtime);
    await flush();
    operation.flow.useProject(project.id);
    await vi.waitFor(() => expect(operation.flow.pending()).toBe(false));
    expect(fake.sessionCreate).toHaveBeenCalledWith({
      projectID: project.id,
      location: { directory: project.canonical },
    });
    expect(operation.onSessionCreated).toHaveBeenCalledWith("session-1");
    operation.dispose();
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
    const operation = controller(fake.runtime);
    await flush();
    operation.flow.useProject(project.id);
    await flush();
    await vi.waitFor(() => expect(operation.flow.current().error?.kind).toBe("session"));
    operation.flow.retry();
    await vi.waitFor(() => expect(operation.flow.pending()).toBe(false));
    expect(fake.sessionCreate).toHaveBeenCalledTimes(2);
    expect(fake.sessionCreate).toHaveBeenLastCalledWith({
      projectID: project.id,
      location: { directory: project.canonical },
    });
    expect(operation.onSessionCreated).toHaveBeenCalledWith("session-2");
    operation.dispose();
  });

  it("completes session creation after the view unmounts", async () => {
    const pendingSession = deferred<SessionInfo>();
    const fake = fakeRuntime([pendingSession.promise]);
    const mounted = mount(fake.runtime);
    await flush();

    submit(mounted.root);
    await flush();
    expect(fake.admit).not.toHaveBeenCalled();
    mounted.unmountFlow();
    pendingSession.resolve(session("session-1", project.canonical));
    await flushDialogClose();

    expect(mounted.onSessionCreated).toHaveBeenCalledWith("session-1");
    expect(fake.admit).toHaveBeenCalledWith("session-1");
    expect(mounted.onDismiss).toHaveBeenCalledOnce();
    mounted.dispose();
  });

  it("keeps Add Project browsing on the connected server", async () => {
    const fake = fakeRuntime([Promise.resolve(session("session-1", project.canonical))]);
    const mounted = mount(fake.runtime);
    await flush();
    clickButton(mounted.root, "Add project");
    await flushDialogClose();
    expect(fake.fileList).toHaveBeenCalledWith(
      {
        location: { directory: "/srv/projects" },
        path: ".",
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
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

    expect(fake.fileList).toHaveBeenCalledWith(
      {
        location: { directory: "/srv/projects", workspace: "workspace-a" },
        path: ".",
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    submit(mounted.root);
    await flushDialogClose();

    expect(fake.projectCurrent).toHaveBeenCalledWith(
      {
        location: { directory: "/srv/projects", workspace: "workspace-a" },
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
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

    expect(fake.projectCurrent).toHaveBeenCalledWith(
      {
        location: { directory: "/srv/projects/worktrees" },
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
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
    vi.mocked(createSessionWorktree).mockReturnValueOnce(
      Effect.succeed({
        location: { directory: "/srv/worktrees/feature-one" },
      }),
    );
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
    vi.mocked(createSessionWorktree).mockReturnValueOnce(
      Effect.succeed({
        location: { directory: "/srv/worktrees/feature-one" },
      }),
    );
    const fake = fakeRuntime(
      [
        Promise.reject(new Error("session failed")),
        Promise.resolve(session("session-2", nonGitProject.canonical)),
      ],
      { projects: [project, nonGitProject] },
    );
    const operation = controller(fake.runtime);
    await flush();

    operation.flow.changeMode("worktree");
    operation.flow.createWorktree();
    await flush();
    await vi.waitFor(() => expect(operation.flow.current().error?.kind).toBe("session"));
    operation.flow.changeProject(nonGitProject.id);
    operation.flow.useProject(nonGitProject.id);
    await vi.waitFor(() => expect(operation.flow.pending()).toBe(false));

    expect(operation.onSessionCreated).toHaveBeenCalledWith("session-2");
    expect(dismissToast).not.toHaveBeenCalled();
    operation.dispose();
  });

  it("shows a second retained notice when a later worktree also fails", async () => {
    vi.mocked(createSessionWorktree)
      .mockReturnValueOnce(
        Effect.succeed({ location: { directory: "/srv/worktrees/feature-one" } }),
      )
      .mockReturnValueOnce(
        Effect.succeed({ location: { directory: "/srv/worktrees/feature-two" } }),
      );
    const fake = fakeRuntime([
      Promise.reject(new Error("first session failed")),
      Promise.reject(new Error("second session failed")),
    ]);
    const operation = controller(fake.runtime);
    await flush();

    operation.flow.changeMode("worktree");
    operation.flow.createWorktree();
    await flush();
    await vi.waitFor(() => expect(operation.flow.current().error?.kind).toBe("session"));

    operation.flow.changeMode("direct");
    operation.flow.changeMode("worktree");
    operation.flow.createWorktree();
    await flush();
    await vi.waitFor(() =>
      expect(operation.flow.current().error).toMatchObject({
        kind: "session",
        worktreeLocation: { directory: "/srv/worktrees/feature-two" },
      }),
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
    operation.dispose();
  });

  it.each(["/Users/alex/code/oc-ui", "C:\\Users\\alex\\code\\oc-ui", "\\\\server\\share\\oc-ui"])(
    "opens the add-project browser at the exact server default %s",
    async (location) => {
      const fake = fakeRuntime([Promise.resolve(session("session-1", project.canonical))]);
      const mounted = mount({ ...fake.runtime, defaultLocation: { directory: location } });
      await flush();

      clickButton(mounted.root, "Add project");
      await flush();

      expect(fake.fileList).toHaveBeenCalledWith(
        {
          location: { directory: location },
          path: ".",
        },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      mounted.dispose();
    },
  );

  it("creates the worktree before creating its session", async () => {
    const worktree = {
      location: { directory: "/srv/worktrees/feature-one" },
    } satisfies CreatedSessionWorktree;
    vi.mocked(createSessionWorktree).mockReturnValueOnce(Effect.succeed(worktree));
    const fake = fakeRuntime([Promise.resolve(session("session-1", worktree.location.directory))]);
    const operation = controller(fake.runtime);
    await flush();
    operation.flow.createWorktree();
    await vi.waitFor(() => expect(operation.flow.pending()).toBe(false));
    expect(createSessionWorktree).toHaveBeenCalledWith(
      expect.objectContaining({ api: fake.runtime.api, isCurrent: expect.any(Function) }),
      { directory: project.canonical },
    );
    expect(vi.mocked(createSessionWorktree).mock.invocationCallOrder[0]).toBeLessThan(
      fake.sessionCreate.mock.invocationCallOrder[0]!,
    );
    expect(fake.sessionCreate).toHaveBeenCalledWith({
      projectID: project.id,
      location: worktree.location,
    });
    operation.dispose();
  });

  it("shows a new retained warning when a retry fails after dismissal", async () => {
    vi.mocked(createSessionWorktree).mockReturnValueOnce(
      Effect.succeed({
        location: { directory: "/srv/worktrees/feature-one" },
      }),
    );
    const retry = deferred<SessionInfo>();
    const fake = fakeRuntime([Promise.reject(new Error("session failed")), retry.promise]);
    const operation = controller(fake.runtime);
    await flush();
    operation.flow.createWorktree();
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledOnce());
    const firstToast = showToast.mock.results[0]?.value;
    toastModule.toaster.dismiss(firstToast);
    operation.flow.retry();
    retry.resolve(Promise.reject(new Error("retry failed")));
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledTimes(2));
    expect(showToast.mock.results[1]?.value).not.toBe(firstToast);
    expect(createSessionWorktree).toHaveBeenCalledOnce();
    operation.dispose();
  });

  it("retries only session creation for a ready retained worktree", async () => {
    vi.mocked(createSessionWorktree).mockReturnValueOnce(
      Effect.succeed({
        location: { directory: "/srv/worktrees/feature-one" },
      }),
    );
    const fake = fakeRuntime([
      Promise.reject(new Error("session failed")),
      Promise.resolve(session("session-2", "/srv/worktrees/feature-one")),
    ]);
    const operation = controller(fake.runtime);
    await flush();
    operation.flow.createWorktree();
    await flush();
    await vi.waitFor(() =>
      expect(operation.flow.current().error).toMatchObject({
        kind: "session",
        worktreeLocation: { directory: "/srv/worktrees/feature-one" },
      }),
    );
    operation.flow.retry();
    await vi.waitFor(() => expect(operation.flow.pending()).toBe(false));
    expect(createSessionWorktree).toHaveBeenCalledOnce();
    expect(fake.sessionCreate).toHaveBeenCalledTimes(2);
    expect(operation.onSessionCreated).toHaveBeenCalledWith("session-2");
    expect(dismissToast).toHaveBeenCalledOnce();
    operation.dispose();
  });

  it("keeps a session acknowledged by the event stream when its request rejects", async () => {
    const acknowledged = session("session-1", project.canonical);
    const fake = fakeRuntime([Promise.reject(new Error("response lost"))], {
      acknowledged: new Map([[acknowledged.id, acknowledged]]),
    });
    const operation = controller(fake.runtime);
    await flush();

    operation.flow.useProject(project.id);
    await vi.waitFor(() => expect(operation.flow.pending()).toBe(false));

    expect(fake.sessionGet).toHaveBeenCalledWith("session-1");
    expect(fake.remove).not.toHaveBeenCalled();
    expect(operation.onSessionCreated).toHaveBeenCalledWith("session-1");
    expect(operation.onDismiss).toHaveBeenCalledOnce();
    operation.dispose();
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
    const operation = controller(fake.runtime);
    await flush();

    operation.flow.useProject(project.id);
    await flush();

    expect(fake.sessionSync).toHaveBeenCalledWith("session-1");
    expect(fake.sessionGet).not.toHaveBeenCalled();
    expect(fake.remove).not.toHaveBeenCalled();

    resolveSync();
    await vi.waitFor(() => expect(operation.flow.pending()).toBe(false));

    expect(fake.sessionGet).toHaveBeenCalledWith("session-1");
    expect(operation.onSessionCreated).toHaveBeenCalledWith("session-1");
    expect(operation.onDismiss).toHaveBeenCalledOnce();
    operation.dispose();
  });

  it("finishes worktree and session creation after view teardown", async () => {
    const pending = deferred<CreatedSessionWorktree>();
    vi.mocked(createSessionWorktree).mockReturnValueOnce(Effect.promise(() => pending.promise));
    const fake = fakeRuntime([Promise.resolve(session("session-1", project.canonical))]);
    const mounted = mount(fake.runtime);
    await flush();
    mounted.root.querySelector<HTMLInputElement>('input[value="worktree"]')?.click();
    submit(mounted.root);
    mounted.unmountFlow();
    pending.resolve({ location: { directory: "/srv/worktrees/late" } });
    await flushDialogClose();
    expect(fake.sessionCreate).toHaveBeenCalledOnce();
    expect(mounted.onSessionCreated).toHaveBeenCalledWith("session-1");
    mounted.dispose();
  });
});
