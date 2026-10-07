import { RegistryContext } from "@effect/atom-solid";
import { Effect, Exit, Scope } from "effect";
import { withTestWorkspace } from "../test/workspace.ts";
import type { FileListOutput, LocationRef, OpenCodeClient } from "@opencode/client";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";

import { mount as mountView } from "../test/mount.ts";
import { deferred } from "../test/deferred.ts";
import { ServerDirectoryBrowser } from "./ServerDirectoryBrowser.tsx";

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
  const requests: ReturnType<typeof deferred<FileListOutput>>[] = [];
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
    readonly requestLocation?: LocationRef;
    readonly disabled?: boolean;
    readonly validationError?: string;
  } = {},
) {
  const onDirectoryChange = vi.fn<(location: LocationRef | undefined) => void>();
  const effects = withTestWorkspace((owner) => owner);
  const { host, dispose } = mountView(() => (
    <RegistryContext.Provider value={effects.registry}>
      <ServerDirectoryBrowser
        effects={effects}
        listDirectory={listDirectory}
        requestLocation={
          options.requestLocation ?? options.initialLocation ?? { directory: "/srv/projects" }
        }
        label="Project directory"
        initialLocation={options.initialLocation ?? { directory: "/srv/projects" }}
        disabled={options.disabled}
        validationError={options.validationError}
        onDirectoryChange={onDirectoryChange}
      />
    </RegistryContext.Provider>
  ));
  return { host, onDirectoryChange, dispose, effects };
}

describe("ServerDirectoryBrowser", () => {
  it("keeps the browsed alias separate from the request context and rebases child entries", async () => {
    const queued = queuedApi();
    const mounted = mount(queued.list, {
      requestLocation: { directory: "/srv/context", workspaceID: "workspace-1" },
      initialLocation: { directory: "/srv/alias", workspaceID: "workspace-1" },
    });
    await flush();
    queued.requests[0]?.resolve(
      response(
        "/srv/context",
        [
          { path: "../alias/child/", type: "directory" },
          { path: "../alias/.hidden/", type: "directory" },
        ],
        "workspace-1",
      ),
    );
    await flush();
    expect(mounted.onDirectoryChange).toHaveBeenLastCalledWith({
      directory: "/srv/alias",
      workspaceID: "workspace-1",
    });
    mounted.host
      .querySelector<HTMLButtonElement>('[aria-label="Browse directory child/"]')
      ?.click();
    expect(queued.list).toHaveBeenLastCalledWith(
      {
        location: { directory: "/srv/context", workspace: "workspace-1" },
        path: "/srv/alias/child",
      },
      { signal: expect.any(AbortSignal) },
    );
    queued.requests[1]?.resolve(response("/srv/context", [], "workspace-1"));
    await flush();
    expect(mounted.onDirectoryChange).toHaveBeenLastCalledWith({
      directory: "/srv/alias/child",
      workspaceID: "workspace-1",
    });
    mounted.dispose();
  });

  it("loads the initial directory and maps only directory entries", async () => {
    const queued = queuedApi();
    const mounted = mount(queued.list);
    await flush();

    expect(mounted.host.textContent).toContain("Loading server directories");
    expect(queued.list).toHaveBeenCalledWith(
      {
        location: { directory: "/srv/projects" },
        path: "/srv/projects",
      },
      { signal: expect.any(AbortSignal) },
    );

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
    expect(queued.list).toHaveBeenLastCalledWith(
      {
        location: { directory: "/srv/projects", workspace: "workspace-1" },
        path: "/srv/projects",
      },
      { signal: expect.any(AbortSignal) },
    );
    queued.requests
      .at(-1)
      ?.resolve(response("/srv/projects", [{ path: "oc-ui", type: "directory" }], "workspace-2"));
    await flush();
    mounted.host.querySelector<HTMLButtonElement>('[aria-label="Browse directory oc-ui"]')?.click();
    expect(queued.list).toHaveBeenLastCalledWith(
      {
        location: { directory: "/srv/projects", workspace: "workspace-2" },
        path: "/srv/projects/oc-ui",
      },
      { signal: expect.any(AbortSignal) },
    );
    queued.requests.at(-1)?.resolve(response("/srv/projects", [], "workspace-2"));
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
    expect(queued.list).toHaveBeenLastCalledWith(
      {
        location: { directory: "/srv/projects" },
        path: "/srv/projects/oc-ui",
      },
      { signal: expect.any(AbortSignal) },
    );
    queued.requests[1]?.resolve(response("/srv/projects", []));
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
    expect(queued.list).toHaveBeenLastCalledWith(
      {
        location: { directory: "/srv/projects" },
        path: "/srv/projects",
      },
      { signal: expect.any(AbortSignal) },
    );
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
    const onDirectoryChange = vi.fn<(location: LocationRef | undefined) => void>();
    const effects = withTestWorkspace((owner) => owner);
    const { host: mountedHost, dispose } = mountView(() => (
      <RegistryContext.Provider value={effects.registry}>
        <ServerDirectoryBrowser
          effects={effects}
          listDirectory={queued.list}
          requestLocation={{ directory: "/srv/first" }}
          label="Project directory"
          initialLocation={{ directory: initialDirectory() }}
          onDirectoryChange={onDirectoryChange}
        />
      </RegistryContext.Provider>
    ));
    await flush();
    setInitialDirectory("/srv/second");
    await flush();
    expect(queued.list.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);

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
  });

  it("identifies the failed target and retries before listing the previous location again", async () => {
    const queued = queuedApi();
    const mounted = mount(queued.list, {
      requestLocation: { directory: "/srv/context", workspaceID: "workspace-1" },
      initialLocation: { directory: "/srv/projects", workspaceID: "workspace-1" },
    });
    await flush();
    queued.requests[0]?.resolve(
      response("/srv/context", [{ path: "oc-ui", type: "directory" }], "workspace-2"),
    );
    await flush();

    const header = mounted.host.querySelector(".server-directory-browser-header");
    const parent = mounted.host.querySelector<HTMLButtonElement>(
      '[aria-label="Go to parent directory"]',
    );
    mounted.host.querySelector<HTMLButtonElement>('[aria-label="Browse directory oc-ui"]')?.click();
    expect(parent?.disabled).toBe(true);
    queued.requests[1]?.reject(new Error("Directory unavailable."));
    await flush();

    expect(mounted.host.querySelector(".server-directory-browser-path")?.textContent).toBe(
      "/srv/projects/oc-ui",
    );
    expect(mounted.host.textContent).toContain("Not listed");
    expect(mounted.host.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not list /srv/projects/oc-ui.",
    );
    expect(mounted.host.querySelector('[role="alert"]')?.textContent).toContain(
      "Directory unavailable.",
    );
    expect(mounted.onDirectoryChange).toHaveBeenLastCalledWith(undefined);
    expect(mounted.host.querySelector(".server-directory-browser-header")).toBe(header);
    expect(parent?.isConnected).toBe(true);
    expect(parent?.disabled).toBe(false);
    const retry = mounted.host.querySelector<HTMLButtonElement>(
      ".server-directory-listing-error button",
    );
    expect(document.activeElement).toBe(retry);
    retry?.click();
    expect(queued.list).toHaveBeenLastCalledWith(
      {
        location: { directory: "/srv/context", workspace: "workspace-2" },
        path: "/srv/projects/oc-ui",
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(mounted.host.querySelector('[aria-busy="true"]')).not.toBeNull();
    queued.requests[2]?.reject(new Error("Still unavailable."));
    await flush();
    mounted.host
      .querySelector<HTMLButtonElement>(
        '[aria-label="Back to previous successfully listed directory"]',
      )
      ?.click();
    expect(queued.list).toHaveBeenLastCalledWith(
      {
        location: { directory: "/srv/context", workspace: "workspace-2" },
        path: "/srv/projects",
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(mounted.onDirectoryChange).toHaveBeenLastCalledWith(undefined);
    queued.requests[3]?.reject(new Error("Previous directory temporarily unavailable."));
    await flush();
    expect(mounted.host.querySelector(".server-directory-browser-path")?.textContent).toBe(
      "/srv/projects",
    );
    expect(mounted.host.textContent).toContain("Not listed");
    expect(mounted.onDirectoryChange).toHaveBeenLastCalledWith(undefined);
    mounted.host
      .querySelector<HTMLButtonElement>(".server-directory-listing-error button")
      ?.click();
    expect(queued.list.mock.lastCall?.[0]?.path).toBe("/srv/projects");
    queued.requests[4]?.resolve(
      response("/srv/context", [{ path: "opencode", type: "directory" }], "workspace-3"),
    );
    await flush();
    expect(mounted.host.querySelector(".server-directory-browser-path")?.textContent).toBe(
      "/srv/projects",
    );
    expect(mounted.host.querySelector('[role="alert"]')).toBeNull();
    expect(mounted.host.querySelector('[aria-label="Browse directory opencode"]')).not.toBeNull();
    expect(mounted.onDirectoryChange).toHaveBeenLastCalledWith({
      directory: "/srv/projects",
      workspaceID: "workspace-3",
    });
    expect(document.activeElement).toBe(parent);
    mounted.dispose();
  });

  it("retries a failed listing in place", async () => {
    const queued = queuedApi();
    const mounted = mount(queued.list);
    await flush();
    queued.requests[0]?.reject(new Error("Directory unavailable."));
    await flush();

    expect(mounted.onDirectoryChange).toHaveBeenCalledOnce();
    expect(mounted.onDirectoryChange).toHaveBeenLastCalledWith(undefined);
    expect(mounted.host.textContent).toContain("Not listed");
    expect(
      mounted.host.querySelector('[aria-label="Back to previous successfully listed directory"]'),
    ).toBeNull();
    mounted.host
      .querySelector<HTMLButtonElement>(".server-directory-listing-error button")
      ?.click();
    await flush();
    expect(queued.list).toHaveBeenLastCalledWith(
      {
        location: { directory: "/srv/projects" },
        path: "/srv/projects",
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(mounted.host.querySelector(".server-directory-browser-path")?.textContent).toBe(
      "/srv/projects",
    );
    queued.requests[1]?.resolve(response("/srv/projects", []));
    await flush();
    expect(mounted.host.textContent).toContain("No child directories.");
    mounted.dispose();
  });

  it.each([
    ["/srv/projects", "/srv/projects/child", "/srv"],
    ["C:\\projects", "C:\\projects\\child", "C:\\"],
    ["\\\\server\\share\\projects", "\\\\server\\share\\projects\\child", "\\\\server\\share"],
  ])("recovers child and parent failures using server paths at %s", async (base, child, parent) => {
    const queued = queuedApi();
    const mounted = mount(queued.list, {
      initialLocation: { directory: base, workspaceID: "workspace-1" },
    });
    await flush();
    queued.requests[0]?.resolve(
      response(base, [{ path: "child", type: "directory" }], "workspace-1"),
    );
    await flush();
    mounted.host.querySelector<HTMLButtonElement>('[aria-label="Browse directory child"]')?.click();
    expect(queued.list.mock.lastCall?.[0]?.path).toBe(child);
    queued.requests[1]?.reject(new Error("Child unavailable."));
    await flush();
    mounted.host
      .querySelector<HTMLButtonElement>(
        '[aria-label="Back to previous successfully listed directory"]',
      )
      ?.click();
    expect(queued.list.mock.lastCall?.[0]?.path).toBe(base);
    queued.requests[2]?.resolve(response(base, [], "workspace-1"));
    await flush();
    mounted.host.querySelector<HTMLButtonElement>('[aria-label="Go to parent directory"]')?.click();
    expect(queued.list.mock.lastCall?.[0]?.path).toBe(parent);
    queued.requests[3]?.reject(new Error("Parent unavailable."));
    await flush();
    expect(mounted.host.querySelector(".server-directory-browser-path")?.textContent).toBe(parent);
    mounted.host
      .querySelector<HTMLButtonElement>(
        '[aria-label="Back to previous successfully listed directory"]',
      )
      ?.click();
    expect(queued.list).toHaveBeenLastCalledWith(
      { location: { directory: base, workspace: "workspace-1" }, path: base },
      { signal: expect.any(AbortSignal) },
    );
    queued.requests[4]?.resolve(response(base, [], "workspace-1"));
    await flush();
    expect(mounted.onDirectoryChange).toHaveBeenLastCalledWith({
      directory: base,
      workspaceID: "workspace-1",
    });
    mounted.dispose();
  });

  it.each(["resolve", "reject"] as const)(
    "ignores a slow obsolete retry that later %ss after recovery",
    async (settlement) => {
      const queued = queuedApi();
      const [initialLocation, setInitialLocation] = createSignal<LocationRef>({
        directory: "/srv/projects",
        workspaceID: "workspace-1",
      });
      const onDirectoryChange = vi.fn<(location: LocationRef | undefined) => void>();
      const effects = withTestWorkspace((owner) => owner);
      const { host, dispose } = mountView(() => (
        <RegistryContext.Provider value={effects.registry}>
          <ServerDirectoryBrowser
            effects={effects}
            listDirectory={queued.list}
            requestLocation={{ directory: "/srv/context", workspaceID: "workspace-1" }}
            label="Project directory"
            initialLocation={initialLocation()}
            onDirectoryChange={onDirectoryChange}
          />
        </RegistryContext.Provider>
      ));
      await flush();
      queued.requests[0]?.resolve(
        response("/srv/context", [{ path: "child", type: "directory" }], "workspace-1"),
      );
      await flush();
      host.querySelector<HTMLButtonElement>('[aria-label="Browse directory child"]')?.click();
      queued.requests[1]?.reject(new Error("Unavailable."));
      await flush();
      host.querySelector<HTMLButtonElement>(".server-directory-listing-error button")?.click();
      await flush();
      setInitialLocation({ directory: "/srv/recovered", workspaceID: "workspace-1" });
      await flush();
      expect(queued.list.mock.calls[2]?.[1]?.signal?.aborted).toBe(true);
      queued.requests[3]?.resolve(response("/srv/context", [], "workspace-2"));
      await flush();
      if (settlement === "resolve") {
        queued.requests[2]?.resolve(response("/stale/context", [], "stale-workspace"));
      } else {
        queued.requests[2]?.reject(new Error("Stale failure."));
      }
      await flush();
      expect(host.querySelector(".server-directory-browser-path")?.textContent).toBe(
        "/srv/recovered",
      );
      expect(host.querySelector('[role="alert"]')).toBeNull();
      expect(host.querySelector('[aria-busy="true"]')).toBeNull();
      expect(onDirectoryChange).toHaveBeenCalledTimes(3);
      expect(onDirectoryChange).toHaveBeenLastCalledWith({
        directory: "/srv/recovered",
        workspaceID: "workspace-2",
      });
      host.querySelector<HTMLButtonElement>('[aria-label="Go to parent directory"]')?.click();
      expect(queued.list).toHaveBeenLastCalledWith(
        { location: { directory: "/srv/context", workspace: "workspace-2" }, path: "/srv" },
        { signal: expect.any(AbortSignal) },
      );
      queued.requests[4]?.resolve(response("/srv/context", [], "workspace-2"));
      await flush();
      dispose();
    },
  );

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
      '[aria-label="Go to parent directory"]',
    );
    expect(button?.disabled).toBe(true);
    button?.click();
    expect(queued.requests).toHaveLength(1);
    mounted.dispose();
  });

  it("aborts on unmount and retains unfinished I/O until workspace shutdown settles", async () => {
    const queued = queuedApi();
    const mounted = mount(queued.list);
    await flush();
    mounted.dispose();
    expect(queued.list.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    let closed = false;
    const closing = Effect.runPromise(Scope.close(mounted.effects.scope, Exit.void)).then(() => {
      closed = true;
      return undefined;
    });
    await flush();
    expect(closed).toBe(false);
    queued.requests[0]?.resolve(response("/late", []));
    await closing;
    expect(mounted.onDirectoryChange).not.toHaveBeenCalled();
  });
});
