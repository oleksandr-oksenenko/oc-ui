import type { LocationRef, OpenCodeClient } from "@opencode/client";
import { Effect, Exit, Scope } from "effect";
import { createMemo, createRoot } from "solid-js";
import { createStore } from "solid-js/store";
import { describe, expect, it, vi } from "vite-plus/test";

import { withTestWorkspace } from "../test/workspace.ts";
import {
  createServerFileImages,
  MAX_CONCURRENT_SERVER_FILE_IMAGE_READS,
  MAX_SERVER_FILE_IMAGE_BYTES,
  serverFileImageLocation,
  serverImageMimeType,
  ServerFileImageError,
} from "./file-images.ts";

const bytes = (...values: number[]) => Uint8Array.from(values);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(
  read: OpenCodeClient["file"]["read"],
  options: { readonly timeoutMs?: number } = {},
) {
  const fileRead = vi.fn<OpenCodeClient["file"]["read"]>(read);
  return withTestWorkspace((effects) => ({
    effects,
    fileRead,
    images: createServerFileImages({ fileRead, effects, timeoutMs: options.timeoutMs }),
  }));
}

describe("serverImageMimeType", () => {
  it("maps displayable image extensions and rejects other paths", () => {
    expect(serverImageMimeType("/tmp/a.PNG")).toBe("image/png");
    expect(serverImageMimeType("/tmp/a.jpeg")).toBe("image/jpeg");
    expect(serverImageMimeType("/tmp/a.jfif")).toBe("image/jpeg");
    expect(serverImageMimeType("/tmp/a.apng")).toBe("image/apng");
    expect(serverImageMimeType("/tmp/a.ico")).toBe("image/x-icon");
    expect(serverImageMimeType("/tmp/a.svg")).toBe("image/svg+xml");
    expect(serverImageMimeType("/tmp/a.txt")).toBeUndefined();
    expect(serverImageMimeType("/tmp/a")).toBeUndefined();
  });
});

describe("serverFileImageLocation", () => {
  it("reads location fields so in-place store updates are observed", () => {
    const [state, setState] = createStore({
      session: { location: { directory: "/srv/A", workspaceID: "ws_a" } },
    });
    let snapshots = 0;
    createRoot((dispose) => {
      const snapshot = createMemo<LocationRef>(() => {
        snapshots += 1;
        return serverFileImageLocation(state.session.location);
      });

      expect(snapshot()).toEqual({ directory: "/srv/A", workspaceID: "ws_a" });
      setState("session", "location", "directory", "/srv/B");
      expect(snapshot()).toEqual({ directory: "/srv/B", workspaceID: "ws_a" });
      setState("session", "location", "workspaceID", "ws_b");
      expect(snapshot()).toEqual({ directory: "/srv/B", workspaceID: "ws_b" });
      expect(snapshots).toBe(3);
      dispose();
    });
  });
});

describe("createServerFileImages", () => {
  it("reads a file URL through the server with its complete location", async () => {
    const { images, fileRead } = setup(async () => bytes(1, 2, 3));
    const location = { directory: "/srv/project", workspaceID: "ws_1" };

    const blob = await images.read("file:///srv/project/shot.png", location);

    expect(fileRead).toHaveBeenCalledTimes(1);
    expect(fileRead.mock.calls[0]?.[0]).toMatchObject({
      path: "/srv/project/shot.png",
      location: { directory: "/srv/project", workspace: "ws_1" },
    });
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBe(3);
  });

  it("omits an absent workspace from the server location", async () => {
    const { images, fileRead } = setup(async () => bytes(1));

    await images.read("file:///srv/project/shot.png", { directory: "/srv/project" });

    expect(fileRead.mock.calls[0]?.[0]).toMatchObject({
      path: "/srv/project/shot.png",
      location: { directory: "/srv/project" },
    });
  });

  it("rejects URLs that do not name an absolute server file", async () => {
    const { images, fileRead } = setup(async () => bytes(1));

    await expect(images.read("https://example.test/a.png", { directory: "/srv" })).rejects.toThrow(
      ServerFileImageError,
    );
    await expect(images.read("file:///a%ZZb.png", { directory: "/srv" })).rejects.toThrow(
      "Only absolute file URLs",
    );
    expect(fileRead).not.toHaveBeenCalled();
  });

  it("rejects paths that are not a displayable image type before reading", async () => {
    const { images, fileRead } = setup(async () => bytes(1));

    await expect(
      images.read("file:///srv/project/archive.tar", { directory: "/srv" }),
    ).rejects.toThrow("not a supported image type");
    await expect(images.read("file:///srv/project/README", { directory: "/srv" })).rejects.toThrow(
      "not a supported image type",
    );
    expect(fileRead).not.toHaveBeenCalled();
  });

  it("reads current bytes each time an image is displayed", async () => {
    let content = bytes(1);
    const { images, fileRead } = setup(async () => content);
    const location = { directory: "/srv/project" };

    const first = await images.read("file:///srv/project/shot.png", location);
    content = bytes(2, 3);
    const second = await images.read("file:///srv/project/shot.png", location);

    expect(fileRead).toHaveBeenCalledTimes(2);
    expect(first.size).toBe(1);
    expect(second.size).toBe(2);
  });

  it("shares one request between concurrent readers", async () => {
    let resolveRead: ((value: Uint8Array) => void) | undefined;
    const { images, fileRead } = setup(
      () =>
        new Promise<Uint8Array>((resolve) => {
          resolveRead = resolve;
        }),
    );
    const location = { directory: "/srv/project" };

    const first = images.read("file:///srv/project/shot.png", location);
    const second = images.read("file:///srv/project/shot.png", location);
    expect(fileRead).toHaveBeenCalledTimes(1);
    resolveRead?.(bytes(4));
    await expect(first).resolves.toBe(await second);
  });

  it("limits simultaneous server reads", async () => {
    const resolvers: Array<(value: Uint8Array) => void> = [];
    const { images, fileRead } = setup(
      () =>
        new Promise<Uint8Array>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const location = { directory: "/srv/project" };
    const names = ["a", "b", "c", "d", "e"];
    const reads = names.map((name) => images.read(`file:///srv/project/${name}.png`, location));

    expect(fileRead).toHaveBeenCalledTimes(MAX_CONCURRENT_SERVER_FILE_IMAGE_READS);
    resolvers[0]?.(bytes(1));
    await settle();
    expect(fileRead).toHaveBeenCalledTimes(names.length);
    for (const [index, resolve] of resolvers.slice(1).entries()) resolve(bytes(index + 2));
    await Promise.all(reads);
  });

  it("binds a queued read to the location it was requested for", async () => {
    const resolvers: Array<(value: Uint8Array) => void> = [];
    const { images, fileRead } = setup(
      () =>
        new Promise<Uint8Array>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    for (const name of ["a", "b", "c", "d"]) {
      void images.read(`file:///srv/${name}.png`, { directory: "/srv" });
    }
    const location = { directory: "/srv/A", workspaceID: "ws_a" };
    const queued = images.read("file:///srv/A/e.png", location);
    // An in-place update after enqueueing must not change the request context.
    location.directory = "/srv/B";
    location.workspaceID = "ws_b";
    try {
      resolvers[0]?.(bytes(1));
      await settle();

      expect(fileRead).toHaveBeenCalledTimes(5);
      expect(fileRead.mock.calls[4]?.[0]).toMatchObject({
        path: "/srv/A/e.png",
        location: { directory: "/srv/A", workspace: "ws_a" },
      });
    } finally {
      for (const resolve of resolvers) resolve(bytes(1));
    }
    await queued;
  });

  it("rejects an image over the display cap without publishing it", async () => {
    const oversized = new Uint8Array(MAX_SERVER_FILE_IMAGE_BYTES + 1);
    const { images, fileRead } = setup(async () => oversized);
    const location = { directory: "/srv/project" };

    await expect(images.read("file:///srv/project/huge.png", location)).rejects.toThrow(
      "too large to display",
    );
    await expect(images.read("file:///srv/project/huge.png", location)).rejects.toThrow(
      "too large to display",
    );
    expect(fileRead).toHaveBeenCalledTimes(2);
  });

  it("times out a stalled read and releases its permit", async () => {
    let calls = 0;
    const { images, fileRead } = setup(
      (_input, options) => {
        calls += 1;
        if (calls > 1) return Promise.resolve(bytes(1));
        return new Promise<Uint8Array>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        });
      },
      { timeoutMs: 50 },
    );
    const location = { directory: "/srv/project" };

    await expect(images.read("file:///srv/project/shot.png", location)).rejects.toThrow(
      "took too long to load",
    );

    // The timed-out read released its permit, so a fresh read can start.
    await expect(images.read("file:///srv/project/shot.png", location)).resolves.toBeInstanceOf(
      Blob,
    );
    expect(fileRead).toHaveBeenCalledTimes(2);
  });

  it("aborts an in-flight read when its workspace closes", async () => {
    let observed: AbortSignal | undefined;
    const { effects, images } = setup(
      (_input, options) =>
        new Promise<Uint8Array>((_resolve, reject) => {
          observed = options?.signal;
          observed?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );

    const read = images.read("file:///srv/project/shot.png", { directory: "/srv/project" });
    expect(observed).toBeInstanceOf(AbortSignal);
    await Effect.runPromise(Scope.close(effects.scope, Exit.void).pipe(Effect.uninterruptible));
    const failure = await read.catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(Error);
    expect(observed?.aborted).toBe(true);
  });
});
