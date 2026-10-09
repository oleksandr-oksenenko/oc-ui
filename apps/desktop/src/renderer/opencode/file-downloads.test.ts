import type { LocationRef, OpenCodeClient } from "@opencode/client";
import { Effect, Exit, Scope } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";
import type { DesktopApi } from "../../shared/desktop-api.ts";
import { deferred } from "../test/deferred.ts";
import { withTestWorkspace } from "../test/workspace.ts";
import { createServerFileDownloads } from "./file-downloads.ts";

const location = { directory: "/srv/project", workspaceID: "ws_1" };
const bytes = Uint8Array.from([0, 1, 255]);
const setup = (timeoutMs?: number) =>
  withTestWorkspace((effects, disposeView) => {
    let connected = true;
    const fileRead = vi.fn<OpenCodeClient["file"]["read"]>(async () => bytes);
    const fileList = vi.fn<OpenCodeClient["file"]["list"]>(async () => ({
      location: {
        ...location,
        project: { id: "p", directory: location.directory, canonical: location.directory },
      },
      data: [],
    }));
    const saveFile = vi.fn<DesktopApi["saveFile"]>(async () => {});
    const downloads = createServerFileDownloads({
      effects,
      fileRead,
      fileList,
      saveFile,
      connected: () => connected,
      timeoutMs,
    });
    return {
      effects,
      disposeView,
      fileRead,
      fileList,
      saveFile,
      downloads,
      disconnect: () => {
        connected = false;
        downloads.cancel();
      },
    };
  });

describe("server file download ownership", () => {
  it("lists an external parent before reading, pins location, and saves only bytes and basename", async () => {
    const { fileRead, fileList, saveFile, downloads, disposeView } = setup();
    const listing = deferred<Awaited<ReturnType<OpenCodeClient["file"]["list"]>>>();
    fileList.mockReturnValueOnce(listing.promise);
    const source: LocationRef = { ...location };
    const pending = downloads.download("/private/tmp/capture%20%231.png", source);
    await vi.waitFor(() => expect(fileList).toHaveBeenCalledOnce());
    source.directory = "/other/session";
    source.workspaceID = "ws_other";
    disposeView();
    listing.resolve({
      location: {
        ...location,
        project: { id: "p", directory: "/srv/project", canonical: "/srv/project" },
      },
      data: [],
    });
    await expect(pending).resolves.toBeUndefined();
    expect(fileList).toHaveBeenCalledWith(
      { path: "/private/tmp", location: { directory: "/srv/project", workspace: "ws_1" } },
      { signal: expect.any(AbortSignal) },
    );
    expect(fileRead).toHaveBeenCalledWith(
      { path: "capture #1.png", location: { directory: "/private/tmp", workspace: "ws_1" } },
      { signal: expect.any(AbortSignal) },
    );
    expect(saveFile).toHaveBeenCalledWith({ name: "capture #1.png", bytes });
    expect(fileList.mock.invocationCallOrder[0]).toBeLessThan(
      fileRead.mock.invocationCallOrder[0]!,
    );
  });

  it("resolves relative paths from the session and suppresses repeated pending activations", async () => {
    const { downloads, fileRead, fileList, saveFile } = setup();
    const read = deferred<Uint8Array>();
    fileRead.mockReturnValueOnce(read.promise);
    const pending = downloads.download("./report.txt", location);
    await expect(downloads.download("report.txt", location)).resolves.toBeUndefined();
    read.resolve(bytes);
    await expect(pending).resolves.toBeUndefined();
    expect(fileRead).toHaveBeenCalledOnce();
    expect(fileRead.mock.calls[0]?.[0]).toEqual({
      path: "/srv/project/report.txt",
      location: { directory: "/srv/project", workspace: "ws_1" },
    });
    expect(fileList).not.toHaveBeenCalled();
    expect(saveFile).toHaveBeenCalledOnce();
    await downloads.download("report.txt", location);
    expect(saveFile).toHaveBeenCalledTimes(2);
  });

  it("does not read while disconnected or for unsupported targets", async () => {
    const { downloads, disconnect, fileRead, saveFile } = setup();
    await expect(downloads.download("https://example.test/a", location)).rejects.toThrow(
      "supported server file link",
    );
    disconnect();
    await expect(downloads.download("a.txt", location)).rejects.toThrow("Reconnect");
    expect(fileRead).not.toHaveBeenCalled();
    expect(saveFile).not.toHaveBeenCalled();
  });

  it("settles canceled I/O before closing its workspace and never saves late bytes", async () => {
    const { downloads, fileRead, saveFile, effects } = setup();
    const read = deferred<Uint8Array>();
    let signal: AbortSignal | undefined;
    fileRead.mockImplementationOnce((_input, options) => {
      signal = options?.signal;
      return read.promise;
    });
    const result = downloads.download("a.txt", location).catch((error: Error) => error);
    await vi.waitFor(() => expect(fileRead).toHaveBeenCalledOnce());
    let closed = false;
    const closing = Effect.runPromise(Scope.close(effects.scope, Exit.void)).then(() => {
      closed = true;
      return undefined;
    });
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
    expect(closed).toBe(false);
    read.resolve(bytes);
    await closing;
    expect(await result).toBeInstanceOf(Error);
    expect(saveFile).not.toHaveBeenCalled();
  });

  it.each([
    { outcome: "success", expected: { status: "fulfilled" } },
    {
      outcome: "failure",
      expected: {
        status: "rejected",
        reason: { _tag: "WorkspaceRequestError", cause: { message: "disk full" } },
      },
    },
  ])(
    "preserves accepted save $outcome during disconnect and workspace shutdown",
    async ({ outcome, expected }) => {
      const { downloads, saveFile, disconnect, effects } = setup();
      const save = deferred();
      saveFile.mockReturnValueOnce(save.promise);
      const result = downloads.download("a.txt", location).then(
        () => ({ status: "fulfilled" }),
        (reason) => ({ status: "rejected", reason }),
      );
      await vi.waitFor(() => expect(saveFile).toHaveBeenCalledOnce());
      disconnect();
      let closed = false;
      const closing = Effect.runPromise(Scope.close(effects.scope, Exit.void)).then(() => {
        closed = true;
        return undefined;
      });
      await Promise.resolve();
      expect(closed).toBe(false);
      if (outcome === "success") save.resolve();
      else save.reject(new Error("disk full"));
      await closing;
      expect(await result).toMatchObject(expected);
      expect(saveFile).toHaveBeenCalledOnce();
    },
  );

  it("settles a retained callback invoked after the workspace has closed", async () => {
    const { downloads, effects, fileRead, saveFile } = setup();
    await Effect.runPromise(Scope.close(effects.scope, Exit.void));
    await expect(downloads.download("a.txt", location)).rejects.toBeInstanceOf(Error);
    expect(fileRead).not.toHaveBeenCalled();
    expect(saveFile).not.toHaveBeenCalled();
  });

  it("aborts a timed-out listing without reading and permits an explicit retry", async () => {
    const { downloads, fileList, fileRead, saveFile } = setup(20);
    let signal: AbortSignal | undefined;
    fileList.mockImplementationOnce(
      (_input, options) =>
        new Promise((_resolve, reject) => {
          signal = options?.signal;
          signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    await expect(downloads.download("/tmp/a.txt", location)).rejects.toMatchObject({
      _tag: "TimeoutError",
    });
    expect(signal?.aborted).toBe(true);
    expect(fileRead).not.toHaveBeenCalled();
    expect(saveFile).not.toHaveBeenCalled();
    await expect(downloads.download("/tmp/a.txt", location)).resolves.toBeUndefined();
  });

  it("does not save failed reads and permits an explicit retry", async () => {
    const { downloads, fileRead, saveFile } = setup();
    fileRead.mockRejectedValueOnce(new Error("missing"));
    await expect(downloads.download("a.txt", location)).rejects.toMatchObject({
      _tag: "WorkspaceRequestError",
      cause: expect.objectContaining({ message: "missing" }),
    });
    expect(saveFile).not.toHaveBeenCalled();
    await expect(downloads.download("a.txt", location)).resolves.toBeUndefined();
  });

  it("serializes downloads through host-save settlement", async () => {
    const { downloads, fileRead, saveFile } = setup();
    const save = deferred();
    saveFile.mockReturnValueOnce(save.promise);
    const first = downloads.download("a.txt", location);
    await vi.waitFor(() => expect(saveFile).toHaveBeenCalledOnce());
    const second = downloads.download("b.txt", location);
    expect(fileRead).toHaveBeenCalledOnce();
    save.resolve();
    await Promise.all([first, second]);
    expect(fileRead).toHaveBeenCalledTimes(2);
    expect(saveFile).toHaveBeenCalledTimes(2);
  });

  it("cancels queued reads on disconnect, retaining an active aborted read until settlement", async () => {
    const { downloads, fileRead, saveFile, disconnect, effects } = setup();
    const read = deferred<Uint8Array>();
    fileRead.mockReturnValueOnce(read.promise);
    const results = Promise.allSettled([
      downloads.download("a.txt", location),
      downloads.download("b.txt", location),
    ]);
    await vi.waitFor(() => expect(fileRead).toHaveBeenCalledOnce());
    disconnect();
    read.resolve(bytes);
    await results;
    await effects.runPromise(Effect.void);
    expect(fileRead).toHaveBeenCalledOnce();
    expect(saveFile).not.toHaveBeenCalled();
  });
});
