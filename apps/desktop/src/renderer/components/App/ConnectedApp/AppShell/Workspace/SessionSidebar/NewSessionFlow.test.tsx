import type { FileListOutput, Project, SessionInfo } from "@opencode-ai/client";
import { render } from "solid-js/web";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

import {
  NewSessionFlow,
  type NewSessionFlowProps,
  type NewSessionFlowRuntime,
} from "./NewSessionFlow.tsx";

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

function fakeRuntime(
  sessionRequests: readonly Promise<SessionInfo>[],
  options: {
    readonly projects?: readonly Project[];
    readonly acknowledged?: ReadonlyMap<string, SessionInfo>;
    readonly defaultLocation?: NewSessionFlowRuntime["defaultLocation"];
  } = {},
) {
  let createIndex = 0;
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
    const resolved =
      input?.path === ".." && directory === project.canonical ? "/srv/projects" : directory;
    return Promise.resolve(fileResponse(resolved, input?.location?.workspace));
  });
  const sessionGet = vi.fn<NewSessionFlowRuntime["data"]["session"]["get"]>((sessionID) =>
    options.acknowledged ? options.acknowledged.get(sessionID) : undefined,
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
      session: { create: sessionCreate, get: sessionGet },
    },
    defaultLocation: options.defaultLocation ?? { directory: "/srv/projects" },
    sessions: { admit, remove },
  };

  return {
    runtime,
    sessionCreate,
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

function mount(runtime: NewSessionFlowProps["runtime"]) {
  const host = document.createElement("div");
  document.body.append(host);
  const onDismiss = vi.fn<() => void>();
  const onSessionCreated = vi.fn<(sessionID: string) => void>();
  const dispose = render(
    () => (
      <NewSessionFlow runtime={runtime} onDismiss={onDismiss} onSessionCreated={onSessionCreated} />
    ),
    host,
  );
  return { host, onDismiss, onSessionCreated, dispose: () => (dispose(), host.remove()) };
}

function submit(host: HTMLElement): void {
  host.querySelector("form")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));
}

function clickButton(host: HTMLElement, text: string): void {
  [...host.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === text)
    ?.click();
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

describe("NewSessionFlow", () => {
  it("creates a direct session in the selected project's canonical directory", async () => {
    const fake = fakeRuntime([Promise.resolve(session("session-1", project.canonical))]);
    const mounted = mount(fake.runtime);
    await flush();

    submit(mounted.host);
    await flush();

    expect(fake.sessionCreate).toHaveBeenCalledWith({
      projectID: project.id,
      location: { directory: project.canonical },
    });
    expect(fake.admit).toHaveBeenCalledWith("session-1");
    expect(fake.remove).not.toHaveBeenCalled();
    expect(mounted.onSessionCreated).toHaveBeenCalledWith("session-1");
    mounted.dispose();
  });

  it("creates a non-Git project session directly without offering a worktree", async () => {
    const fake = fakeRuntime([Promise.resolve(session("session-1", nonGitProject.canonical))], {
      projects: [nonGitProject],
    });
    const mounted = mount(fake.runtime);
    await flush();

    expect(mounted.host.textContent).not.toContain("Create a worktree");
    submit(mounted.host);
    await flush();

    expect(fake.sessionCreate).toHaveBeenCalledWith({
      projectID: nonGitProject.id,
      location: { directory: nonGitProject.canonical },
    });
    expect(mounted.onSessionCreated).toHaveBeenCalledWith("session-1");
    mounted.dispose();
  });

  it("preserves workspace scope when browsing, adding, and using a project", async () => {
    const fake = fakeRuntime([Promise.resolve(session("session-1", project.canonical))], {
      defaultLocation: { directory: "/srv/projects", workspaceID: "workspace-a" },
    });
    const mounted = mount(fake.runtime);
    await flush();

    clickButton(mounted.host, "Add project");
    await flush();

    expect(fake.fileList).toHaveBeenCalledWith({
      location: { directory: "/srv/projects", workspace: "workspace-a" },
      path: ".",
    });
    submit(mounted.host);
    await flush();

    expect(fake.projectCurrent).toHaveBeenCalledWith({
      location: { directory: "/srv/projects", workspace: "workspace-a" },
    });
    submit(mounted.host);
    await flush();

    expect(fake.sessionCreate).toHaveBeenCalledWith({
      projectID: project.id,
      location: { directory: "/srv/projects", workspaceID: "workspace-a" },
    });
    mounted.dispose();
  });

  it("registers the directory currently open in the add-project browser", async () => {
    const fake = fakeRuntime([Promise.resolve(session("session-1", project.canonical))]);
    const mounted = mount(fake.runtime);
    await flush();

    clickButton(mounted.host, "Add project");
    await flush();
    submit(mounted.host);
    await flush();

    expect(fake.projectCurrent).toHaveBeenCalledWith({
      location: { directory: "/srv/projects" },
    });
    expect(fake.projectSync).toHaveBeenCalledTimes(2);
    expect(mounted.host.textContent).toContain("New session");
    mounted.dispose();
  });

  it.each([
    ["/Users/alex/code/oc-ui", "/Users/alex"],
    ["/home/alex/code/oc-ui", "/home/alex"],
    ["/var/home/alex/code/oc-ui", "/var/home/alex"],
    ["C:\\Users\\alex\\code\\oc-ui", "C:\\Users\\alex"],
    ["/srv/projects/oc-ui", "/srv/projects/oc-ui"],
  ])(
    "opens the add-project browser at the server home inferred from %s",
    async (location, home) => {
      const fake = fakeRuntime([Promise.resolve(session("session-1", project.canonical))]);
      const mounted = mount({
        ...fake.runtime,
        defaultLocation: { directory: location },
      });
      await flush();

      clickButton(mounted.host, "Add project");
      await flush();

      expect(fake.fileList).toHaveBeenCalledWith({
        location: { directory: home },
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

    const radios = mounted.host.querySelectorAll<HTMLElement>('[data-slot="radio-v2-item-input"]');
    radios[2]?.click();
    submit(mounted.host);
    await flush();

    const name = mounted.host.querySelector<HTMLInputElement>("input");
    if (name) {
      name.value = "feature-one";
      name.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }
    submit(mounted.host);
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
      expect(mounted.host.textContent).toContain("/srv/worktrees/feature-one");
    });

    submit(mounted.host);
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

    const radios = mounted.host.querySelectorAll<HTMLElement>('[data-slot="radio-v2-item-input"]');
    radios[2]?.click();
    submit(mounted.host);
    await flush();
    const name = mounted.host.querySelector<HTMLInputElement>("input");
    if (name) {
      name.value = "feature-one";
      name.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }

    submit(mounted.host);
    await flush();

    expect(mounted.host.textContent).toContain("Worktree creation failed");
    expect(mounted.host.querySelector<HTMLInputElement>("input")?.value).toBe("feature-one");
    submit(mounted.host);
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

    submit(mounted.host);
    await flush();
    expect(mounted.host.textContent).toContain("Session creation failed");

    submit(mounted.host);
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

    submit(mounted.host);
    await flush();

    expect(fake.sessionGet).toHaveBeenCalledWith("session-1");
    expect(fake.remove).not.toHaveBeenCalled();
    expect(mounted.onSessionCreated).toHaveBeenCalledWith("session-1");
    mounted.dispose();
  });
});
