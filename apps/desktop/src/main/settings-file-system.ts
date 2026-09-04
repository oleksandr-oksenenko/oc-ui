import * as nodeFiles from "node:fs/promises";

import { NodeFileSystem } from "@effect/platform-node";
import { Effect, FileSystem, Layer, PlatformError } from "effect";

const errorTag = (cause: unknown): PlatformError.SystemErrorTag => {
  const code = cause instanceof Error && "code" in cause ? cause.code : undefined;
  switch (code) {
    case "ENOENT":
      return "NotFound";
    case "EACCES":
    case "EPERM":
      return "PermissionDenied";
    case "EEXIST":
      return "AlreadyExists";
    case "EISDIR":
    case "ENOTDIR":
    case "ELOOP":
      return "BadResource";
    case "EBUSY":
      return "Busy";
    default:
      return "Unknown";
  }
};

// The pinned Node layer aborts reads/writes without awaiting their callbacks.
// Keep each native operation owned until its Promise settles after interruption.
const nativeEffect = <A>(
  method: string,
  path: string,
  operation: (signal: AbortSignal) => Promise<A>,
) =>
  Effect.callback<A, PlatformError.PlatformError>((resume, signal) => {
    const settled = operation(signal).then(
      (value) => resume(Effect.succeed(value)),
      (cause: unknown) =>
        resume(
          Effect.fail(
            PlatformError.systemError({
              _tag: errorTag(cause),
              module: "FileSystem",
              method,
              pathOrDescriptor: path,
              cause,
            }),
          ),
        ),
    );
    return Effect.promise(() => settled);
  });

export const settingsFileSystemLayer = (
  files: Pick<typeof nodeFiles, "mkdir" | "readFile" | "rename" | "rm" | "writeFile"> = nodeFiles,
): Layer.Layer<FileSystem.FileSystem> =>
  Layer.effect(
    FileSystem.FileSystem,
    Effect.gen(function* () {
      const base = yield* FileSystem.FileSystem;
      return FileSystem.make({
        ...base,
        makeDirectory: (path, options) =>
          nativeEffect("makeDirectory", path, () => files.mkdir(path, options)).pipe(Effect.asVoid),
        readFile: (path) =>
          nativeEffect("readFile", path, (signal) => files.readFile(path, { signal })),
        rename: (path, destination) =>
          nativeEffect("rename", path, () => files.rename(path, destination)),
        remove: (path, options) => nativeEffect("remove", path, () => files.rm(path, options)),
        readDirectory: (path, options) =>
          base.readDirectory(path, options).pipe(Effect.uninterruptible),
        writeFile: (path, data, options) =>
          nativeEffect("writeFile", path, (signal) =>
            files.writeFile(path, data, { ...options, signal }),
          ),
      });
    }),
  ).pipe(Layer.provide(NodeFileSystem.layer));
