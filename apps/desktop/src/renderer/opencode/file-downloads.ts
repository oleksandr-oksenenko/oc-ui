import type { LocationRef, OpenCodeClient } from "@opencode/client";
import { Deferred, Effect, FiberMap, Schema, Semaphore, type Cause } from "effect";
import type { DesktopApi } from "../../shared/desktop-api.ts";
import { suggestedDownloadName } from "../../shared/desktop-api.ts";
import { serverPathEntryName, serverPathParent } from "../ui/serverPath.ts";
import { transcriptFilePath } from "../ui/transcriptLinks.ts";
import type { WorkspaceOwner, WorkspaceRequestError } from "../workspace-owner.ts";
import { readServerFile } from "./server-files.ts";

export class ServerFileDownloadError extends Schema.TaggedError<ServerFileDownloadError>()(
  "ServerFileDownloadError",
  {
    message: Schema.String,
  },
) {}

export type ServerFileDownload = (href: string) => void;

type DownloadError = ServerFileDownloadError | WorkspaceRequestError | Cause.TimeoutError;

/** One download owner per connection. Views do not own its reads or save handoffs. */
export function createServerFileDownloads(input: {
  readonly effects: WorkspaceOwner;
  readonly fileRead: OpenCodeClient["file"]["read"];
  readonly fileList: OpenCodeClient["file"]["list"];
  readonly saveFile: DesktopApi["saveFile"];
  readonly connected: () => boolean;
  readonly timeoutMs?: number;
}) {
  const fibers = input.effects.runSync(FiberMap.make<string, void, DownloadError>());
  const run = input.effects.runSync(FiberMap.runtime(fibers)());
  const gate = Semaphore.makeUnsafe(1);
  const download = Effect.fn("ServerFileDownloads.download")(
    function* (
      path: string,
      location: LocationRef,
      outcome: Deferred.Deferred<void, DownloadError>,
    ) {
      if (!input.connected()) {
        return yield* new ServerFileDownloadError({
          message: "Reconnect to the file's server to download it.",
        });
      }
      const bytes = yield* readServerFile(input, path, location).pipe(
        Effect.timeout(input.timeoutMs ?? 30_000),
      );
      const name = suggestedDownloadName(serverPathEntryName(serverPathParent(path), path));
      // Once handed to the host, saving cannot be cancelled. Keep its settlement
      // owned even if the connection closes; main independently awaits its IPC.
      return yield* input.effects
        .request(() => input.saveFile({ name, bytes: new Uint8Array(bytes) }))
        .pipe(
          // Publish the actual save result before a deferred interrupt can
          // replace the worker's exit. Cleanup remains workspace-owned.
          Effect.onExit((exit) => Deferred.done(outcome, exit)),
          Effect.uninterruptible,
        );
    },
    gate.withPermits(1),
    Effect.tapCause((cause) => Effect.logWarning("File download failed", cause)),
  );

  return {
    download: (href: string, source: LocationRef): Promise<void> => {
      const location = { ...source };
      const path = transcriptFilePath(href, location.directory);
      if (path === undefined)
        return Promise.reject(
          new ServerFileDownloadError({ message: "This is not a supported server file link." }),
        );
      const key = JSON.stringify([location.directory, location.workspaceID, path]);
      if (FiberMap.hasUnsafe(fibers, key)) return Promise.resolve();
      const outcome = Deferred.makeUnsafe<void, DownloadError>();
      const fiber = run(key, download(path, location, outcome));
      // Earlier read failures, interruption, or an already closed owner also
      // settle the caller. Deferred keeps an accepted save's result first.
      fiber.addObserver((exit) => Deferred.doneUnsafe(outcome, exit));
      return Effect.runPromise(Deferred.await(outcome));
    },
    cancel: () => input.effects.runFork(FiberMap.clear(fibers)),
  };
}
