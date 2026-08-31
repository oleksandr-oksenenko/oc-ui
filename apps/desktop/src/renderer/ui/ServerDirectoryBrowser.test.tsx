import type { FileListOutput, LocationRef, OpenCodeClient } from "@opencode-ai/client";
import { render } from "solid-js/web";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";

import { ServerDirectoryBrowser } from "./ServerDirectoryBrowser.tsx";

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (cause: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function response(
  directory: string,
  data: Array<{ readonly path: string; readonly type: "file" | "directory" }>,
  workspaceID?: string,
): FileListOutput {
  return {
    location: {
      directory,
      workspaceID,
      project: { id: "project", directory, canonical: directory },
    },
    data,
  };
}

function queuedApi() {
  const requests: Deferred<FileListOutput>[] = [];
  const list = vi.fn<OpenCodeClient["file"]["list"]>(() => {
    const request = deferred<FileListOutput>();
    requests.push(request);
    return request.promise;
  });
  return { list, requests };
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  await new Promise<void>((resolve) => queueMicrotask(resolve));
}

function mount(
  listDirectory: OpenCodeClient["file"]["list"],
  options: {
    readonly initialLocation?: LocationRef;
    readonly disabled?: boolean;
    readonly validationError?: string;
  } = {},
) {
  const host = document.createElement("div");
  document.body.append(host);
  const onDirectoryChange = vi.fn<(location: LocationRef) => void>();
  const dispose = render(
    () => (
      <ServerDirectoryBrowser
        listDirectory={listDirectory}
        label="Project directory"
        initialLocation={options.initialLocation ?? { directory: "/srv/projects" }}
        disabled={options.disabled}
        validationError={options.validationError}
        onDirectoryChange={onDirectoryChange}
      />
    ),
    host,
  );
  return { host, onDirectoryChange, dispose: () => (dispose(), host.remove()) };
}

describe("ServerDirectoryBrowser", () => {
  it("loads the initial directory and maps only directory entries", async () => {
    const queued = queuedApi();
    const mounted = mount(queued.list);
    await flush();

    expect(mounted.host.textContent).toContain("Loading server directories");
    expect(queued.list).toHaveBeenCalledWith({
      location: { directory: "/srv/projects" },
      path: ".",
    });

    queued.requests[0]?.resolve(
      response("/srv/projects", [
        { path: "oc-ui", type: "directory" },
        { path: "README.md", type: "file" },
        { path: "opencode", type: "directory" },
      ]),
    );
    await flush();

    expect(mounted.host.textContent).toContain("/srv/projects");
    expect(mounted.host.textContent).toContain("oc-ui");
    expect(mounted.host.textContent).toContain("opencode");
    expect(mounted.host.textContent).not.toContain("README.md");
    expect(mounted.onDirectoryChange).toHaveBeenCalledOnce();
    expect(mounted.onDirectoryChange).toHaveBeenCalledWith({ directory: "/srv/projects" });
    mounted.dispose();
  });

  it("preserves the server workspace identity while navigating", async () => {
    const queued = queuedApi();
    const mounted = mount(queued.list, {
      initialLocation: { directory: "/srv/projects", workspaceID: "workspace-1" },
    });
    await flush();
    expect(queued.list).toHaveBeenLastCalledWith({
      location: { directory: "/srv/projects", workspace: "workspace-1" },
      path: ".",
    });
    queued.requests
      .at(-1)
      ?.resolve(response("/srv/projects", [{ path: "oc-ui", type: "directory" }], "workspace-2"));
    await flush();
    mounted.host.querySelector<HTMLButtonElement>('[aria-label="Browse directory oc-ui"]')?.click();
    expect(queued.list).toHaveBeenLastCalledWith({
      location: { directory: "/srv/projects/oc-ui", workspace: "workspace-2" },
      path: ".",
    });
    queued.requests.at(-1)?.resolve(response("/srv/projects/oc-ui", [], "workspace-2"));
    await flush();
    expect(mounted.onDirectoryChange).toHaveBeenLastCalledWith({
      directory: "/srv/projects/oc-ui",
      workspaceID: "workspace-2",
    });
    mounted.dispose();
  });

  it("associates directory validation with the browser controls", async () => {
    const queued = queuedApi();
    const mounted = mount(queued.list, { validationError: "Choose a valid directory." });
    await flush();
    queued.requests[0]?.resolve(response("/srv/projects", []));
    await flush();

    const browser = mounted.host.querySelector<HTMLElement>(".server-directory-browser");
    const parent = mounted.host.querySelector<HTMLButtonElement>(
      '[aria-label="Go to parent directory"]',
    );
    const error = mounted.host.querySelector<HTMLElement>(".server-directory-error");
    expect(browser?.getAttribute("aria-invalid")).toBe("true");
    expect(browser?.getAttribute("aria-describedby")).toBe(error?.id);
    expect(parent?.getAttribute("aria-describedby")).toBe(error?.id);
    mounted.dispose();
  });

  it("navigates to a child and then to its parent", async () => {
    const queued = queuedApi();
    const mounted = mount(queued.list);
    await flush();
    queued.requests[0]?.resolve(response("/srv/projects", [{ path: "oc-ui", type: "directory" }]));
    await flush();

    const child = mounted.host.querySelector<HTMLButtonElement>(
      '[aria-label="Browse directory oc-ui"]',
    );
    const entries = mounted.host.querySelector<HTMLUListElement>(".server-directory-entries");
    if (entries) entries.scrollTop = 120;
    child?.click();
    expect(queued.requests).toHaveLength(2);
    await flush();
    expect(mounted.host.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(
      mounted.host.querySelector<HTMLButtonElement>('[aria-label="Browse directory oc-ui"]')
        ?.disabled,
    ).toBe(true);
    expect(queued.list).toHaveBeenLastCalledWith({
      location: { directory: "/srv/projects/oc-ui" },
      path: ".",
    });
    queued.requests[1]?.resolve(response("/srv/projects/oc-ui", []));
    await flush();

    expect(mounted.host.querySelector(".server-directory-browser-path")?.textContent).toBe(
      "/srv/projects/oc-ui",
    );
    expect(entries?.scrollTop).toBe(0);
    const parent = mounted.host.querySelector<HTMLButtonElement>(
      '[aria-label="Go to parent directory"]',
    );
    parent?.click();
    expect(queued.requests).toHaveLength(3);
    expect(queued.list).toHaveBeenLastCalledWith({
      location: { directory: "/srv/projects" },
      path: ".",
    });
    queued.requests[2]?.resolve(response("/srv/projects", [{ path: "oc-ui", type: "directory" }]));
    await flush();

    expect(mounted.host.querySelector(".server-directory-browser-path")?.textContent).toBe(
      "/srv/projects",
    );
    expect(mounted.onDirectoryChange).toHaveBeenCalledWith({ directory: "/srv/projects/oc-ui" });
    expect(mounted.onDirectoryChange).toHaveBeenCalledWith({ directory: "/srv/projects" });
    mounted.dispose();
  });

  it("ignores stale responses from an older directory request", async () => {
    const queued = queuedApi();
    const [initialDirectory, setInitialDirectory] = createSignal("/srv/first");
    const mountedHost = document.createElement("div");
    document.body.append(mountedHost);
    const onDirectoryChange = vi.fn<(location: LocationRef) => void>();
    const dispose = render(
      () => (
        <ServerDirectoryBrowser
          listDirectory={queued.list}
          label="Project directory"
          initialLocation={{ directory: initialDirectory() }}
          onDirectoryChange={onDirectoryChange}
        />
      ),
      mountedHost,
    );
    await flush();
    setInitialDirectory("/srv/second");
    await flush();

    queued.requests[1]?.resolve(response("/srv/second", []));
    await flush();
    queued.requests[0]?.resolve(response("/srv/first", []));
    await flush();

    expect(mountedHost.querySelector(".server-directory-browser-path")?.textContent).toBe(
      "/srv/second",
    );
    expect(onDirectoryChange).toHaveBeenCalledOnce();
    expect(onDirectoryChange).toHaveBeenCalledWith({ directory: "/srv/second" });
    dispose();
    mountedHost.remove();
  });

  it("keeps the last resolved directory when navigation fails", async () => {
    const queued = queuedApi();
    const mounted = mount(queued.list);
    await flush();
    queued.requests[0]?.resolve(response("/srv/projects", [{ path: "oc-ui", type: "directory" }]));
    await flush();

    mounted.host.querySelector<HTMLButtonElement>('[aria-label="Browse directory oc-ui"]')?.click();
    queued.requests[1]?.reject(new Error("Directory unavailable."));
    await flush();

    expect(mounted.host.querySelector(".server-directory-browser-path")?.textContent).toBe(
      "/srv/projects",
    );
    expect(mounted.host.querySelector('[role="alert"]')?.textContent).toContain(
      "Directory unavailable.",
    );
    expect(mounted.onDirectoryChange).toHaveBeenCalledOnce();
    mounted.dispose();
  });

  it("retries a failed listing in place", async () => {
    const queued = queuedApi();
    const mounted = mount(queued.list);
    await flush();
    queued.requests[0]?.reject(new Error("Directory unavailable."));
    await flush();

    mounted.host.querySelector<HTMLButtonElement>("button:not([disabled])")?.click();
    await flush();
    expect(queued.list).toHaveBeenLastCalledWith({
      location: { directory: "/srv/projects" },
      path: ".",
    });
    expect(mounted.host.querySelector(".server-directory-browser-path")?.textContent).toBe(
      "/srv/projects",
    );
    queued.requests[1]?.resolve(response("/srv/projects", []));
    await flush();
    expect(mounted.host.textContent).toContain("No child directories.");
    mounted.dispose();
  });

  it("renders loading, error, empty, and parent states accessibly", async () => {
    const queued = queuedApi();
    const mounted = mount(queued.list);
    await flush();
    expect(mounted.host.querySelector('[aria-busy="true"]')).not.toBeNull();
    queued.requests[0]?.resolve(response("/", []));
    await flush();
    expect(mounted.host.textContent).toContain("No child directories.");
    mounted.dispose();

    const failed = queuedApi();
    const failedMount = mount(failed.list);
    await flush();
    failed.requests[0]?.reject(new Error("Directory unavailable."));
    await flush();
    expect(failedMount.host.querySelector('[role="alert"]')?.textContent).toContain(
      "Directory unavailable.",
    );
    failedMount.dispose();
  });

  it("disables navigation while loading and when disabled", async () => {
    const queued = queuedApi();
    const mounted = mount(queued.list, { disabled: true });
    await flush();
    expect(mounted.host.querySelector('[aria-busy="true"]')).not.toBeNull();
    queued.requests[0]?.resolve(response("/srv/projects", [{ path: "oc-ui", type: "directory" }]));
    await flush();
    const button = mounted.host.querySelector<HTMLButtonElement>(
      ".server-directory-entries button",
    );
    expect(button?.disabled).toBe(true);
    button?.click();
    expect(queued.requests).toHaveLength(1);
    mounted.dispose();
  });
});
