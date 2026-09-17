import type { LocationRef, OpenCodeClient } from "@opencode/client";
import { Effect, Schema, Semaphore } from "effect";

import { serverFilePathFromFileUrl } from "../ui/serverPath.ts";
import type { WorkspaceOwner } from "../workspace-owner.ts";

/**
 * Cap on encoded bytes admitted to one displayed Blob. The connected server
 * reads and sends the whole file before this check can run, so this does not
 * bound acquisition, decoded pixel memory, or total transcript memory.
 * Bounded acquisition needs a server-side size or range contract; until then,
 * unsupported extensions are never requested and concurrent reads are limited
 * below.
 */
export const MAX_SERVER_FILE_IMAGE_BYTES = 20 * 1024 * 1024;

/** Simultaneous server reads; each response buffers its whole file. */
export const MAX_CONCURRENT_SERVER_FILE_IMAGE_READS = 4;

/**
 * Deadline for one server read, measured after its permit is acquired. A
 * stalled server must not occupy a read permit indefinitely. Image loads are
 * best-effort: on timeout the alt text remains until the image is remounted.
 */
const SERVER_FILE_IMAGE_TIMEOUT_MS = 30_000;

const IMAGE_MIME_TYPES = new Map<string, string>([
  ["apng", "image/apng"],
  ["avif", "image/avif"],
  ["bmp", "image/bmp"],
  ["gif", "image/gif"],
  ["ico", "image/x-icon"],
  ["jfif", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["jpg", "image/jpeg"],
  ["png", "image/png"],
  ["svg", "image/svg+xml"],
  ["webp", "image/webp"],
]);

/**
 * The MIME type for a server path whose extension is a displayable image.
 * Undefined means the path is not requested at all: the client discards the
 * server's content type, and reading arbitrary files would risk large,
 * unrenderable transfers. Extensionless images are not supported.
 */
export function serverImageMimeType(path: string): string | undefined {
  const separator = path.lastIndexOf(".");
  if (separator === -1) return undefined;
  return IMAGE_MIME_TYPES.get(path.slice(separator + 1).toLowerCase());
}

/**
 * Snapshot the fields a file image read must use. Reading them here, rather
 * than retaining a Solid store object, keeps tracking wired to field updates
 * that `reconcile` can apply in place, and keeps a queued read bound to the
 * location it was requested for.
 */
export function serverFileImageLocation(source: {
  readonly directory: string;
  readonly workspaceID?: string;
}): LocationRef {
  return source.workspaceID === undefined
    ? { directory: source.directory }
    : { directory: source.directory, workspaceID: source.workspaceID };
}

export class ServerFileImageError extends Schema.TaggedError<ServerFileImageError>()(
  "ServerFileImageError",
  { message: Schema.String },
) {}

/** Resolves a `file:` URL to bytes on the owning server, ready for a blob URL. */
export type ServerFileImageReader = (fileUrl: string) => Promise<Blob>;

export type ServerFileImages = {
  readonly read: (fileUrl: string, location: LocationRef) => Promise<Blob>;
};

const fileImageKey = (
  fileUrl: string,
  directory: string,
  workspaceID: string | undefined,
): string => `${directory}\u0000${workspaceID ?? ""}\u0000${fileUrl}`;

/**
 * Read `file:` images through the connected server's filesystem contract.
 *
 * The renderer cannot load `file:` URLs: they name the Electron host, while a
 * session's files belong to the connected server. Requests carry the session's
 * complete location, and the server applies its own path containment.
 *
 * Completed reads are not cached here. A file URL is a mutable path, not a
 * content identity, so a displayed image always reflects a current read; the
 * mounting Markdown component keeps its resolved object URL for the time the
 * image stays in the rendered text. Concurrent requests for one location and
 * URL share a single read, reads have a finite deadline (see `timeoutMs`), and
 * requests are owned by the workspace scope, so closing the workspace aborts
 * them.
 */
export function createServerFileImages(input: {
  readonly fileRead: OpenCodeClient["file"]["read"];
  readonly effects: WorkspaceOwner;
  /** Deadline for one read; defaults to 30 seconds. */
  readonly timeoutMs?: number;
}): ServerFileImages {
  const pending = new Map<string, Promise<Blob>>();
  const readGate = Semaphore.makeUnsafe(MAX_CONCURRENT_SERVER_FILE_IMAGE_READS);
  const timeoutMs = input.timeoutMs ?? SERVER_FILE_IMAGE_TIMEOUT_MS;

  const read = (fileUrl: string, location: LocationRef): Promise<Blob> => {
    // Snapshot before keying or deferring: a queued read must not pick up a
    // later in-place update of the caller's location object.
    const requested = serverFileImageLocation(location);
    const path = serverFilePathFromFileUrl(fileUrl);
    if (path === undefined) {
      return Promise.reject(
        new ServerFileImageError({
          message: "Only absolute file URLs can be read from the server.",
        }),
      );
    }
    const mime = serverImageMimeType(path);
    if (mime === undefined) {
      return Promise.reject(
        new ServerFileImageError({
          message: "The server file is not a supported image type.",
        }),
      );
    }
    const key = fileImageKey(fileUrl, requested.directory, requested.workspaceID);
    const existing = pending.get(key);
    if (existing !== undefined) return existing;

    const request = input.effects
      .runPromise(
        input.effects
          .request((signal) =>
            input.fileRead(
              {
                path,
                location:
                  requested.workspaceID === undefined
                    ? { directory: requested.directory }
                    : { directory: requested.directory, workspace: requested.workspaceID },
              },
              { signal },
            ),
          )
          .pipe(
            // The permit is held only for the timed read; a timeout interrupts
            // the request, forwards the abort, and releases the permit once the
            // underlying read has settled.
            Effect.timeoutOrElse({
              duration: timeoutMs,
              orElse: () =>
                Effect.fail(
                  new ServerFileImageError({
                    message: "The server file took too long to load.",
                  }),
                ),
            }),
            readGate.withPermits(1),
            Effect.flatMap((bytes) =>
              bytes.byteLength > MAX_SERVER_FILE_IMAGE_BYTES
                ? Effect.fail(
                    new ServerFileImageError({
                      message: "The server file is too large to display.",
                    }),
                  )
                : Effect.succeed(bytes),
            ),
            // Copy into a fresh view: Blob parts require an ArrayBuffer-backed view.
            Effect.map((bytes) => new Blob([new Uint8Array(bytes)], { type: mime })),
          ),
      )
      .finally(() => {
        pending.delete(key);
      });
    pending.set(key, request);
    return request;
  };

  return { read };
}
