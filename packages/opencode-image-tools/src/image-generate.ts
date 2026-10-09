/* oxlint-disable effecttsgo/any-unknown-in-error-context -- The public session client erases errors. The tool boundary produces a safe typed error without retaining credential-bearing HTTP diagnostics. */
import type { Plugin } from "@opencode/plugin/effect";
import type { ImageInput } from "@opencode/ai/image";
import { Mime } from "@opencode/core/mime";
import { FileAccess } from "@opencode/core/file-access";
import { Permission } from "@opencode/core/permission";
import { Tool } from "@opencode/schema/tool";
import * as Identifier from "@opencode/schema/identifier";
import { PhotonImage } from "@silvia-odwyer/photon-node";
import {
  Effect,
  Encoding,
  FileSystem,
  Layer,
  Option,
  Path,
  Predicate,
  Schema,
  type Types,
} from "effect";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { FetchHttpClient } from "effect/unstable/http";

// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- This tool composes its invocation-owned services and protocol workflow.
import { generateImage } from "./codex-images.js";

const Text = Schema.String.check(Schema.isPattern(/\S/));
export const Input = Schema.Struct({
  prompt: Text,
  model: Schema.optionalKey(
    Schema.Literals(["gpt-image-2.5-sunburst", "gpt-image-2.5-flare"]).annotate({
      description:
        "Sunburst prioritizes quality and precise editing; Flare prioritizes speed. Omit to use the configured default (Flare unless overridden).",
    }),
  ),
  outputPath: Schema.optionalKey(Text),
  referencePaths: Schema.optionalKey(Schema.Array(Text).check(Schema.isMaxLength(5))),
  background: Schema.optionalKey(Schema.Literals(["auto", "opaque", "transparent"])),
});
const Output = Schema.Struct({
  saved: Schema.Boolean,
  model: Schema.String,
  mime: Schema.String,
  attachment: Schema.String,
  path: Schema.optionalKey(Schema.String),
  requestedPath: Schema.optionalKey(Schema.String),
  warning: Schema.optionalKey(Schema.String),
  partialPath: Schema.optionalKey(Schema.String),
});
const maxBytes = 20 * 1024 * 1024;
const supported = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
// Match OpenCode's Photon decoding boundary, freeing the decoded pixels while
// retaining the original bytes (normalization may resize or re-encode them).
const validateImage = Effect.fn("ImageTools.validateImage")(function* (
  bytes: Uint8Array,
  error: Tool.Error,
) {
  yield* Effect.try({
    try: () => {
      const image = PhotonImage.new_from_byteslice(bytes);
      image.free();
    },
    catch: () => error,
  });
});
type Client = {
  session: Pick<Plugin.Context["session"], "get">;
  integration: Pick<Plugin.Context["integration"], "connection">;
};

const readReference = Effect.fn("ImageTools.readReference")(function* (
  filename: string,
  remaining: number,
) {
  const fs = yield* FileSystem.FileSystem;
  // Follow reference symlinks, but reject known special files before opening.
  const info = yield* fs.stat(filename);
  if (
    info.type !== "File" ||
    info.size === 0n ||
    info.size > BigInt(Math.min(maxBytes, remaining))
  ) {
    return yield* new Tool.Error({
      message: `Reference must be a regular image file within the 20 MiB individual / 40 MiB total limit: ${filename}`,
    });
  }
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const file = yield* fs.open(filename, { flag: "r" });
      const opened = yield* file.stat;
      if (opened.type !== "File")
        return yield* new Tool.Error({ message: `Reference is not a regular file: ${filename}` });
      // Read from the same handle and cap actual bytes even if the file grows.
      const buffer = new Uint8Array(Math.min(maxBytes, remaining) + 1);
      let length = 0;
      while (length < buffer.length) {
        const count = Number(yield* file.read(buffer.subarray(length)));
        if (count === 0) break;
        length += count;
      }
      if (length === 0 || length > Math.min(maxBytes, remaining)) {
        return yield* new Tool.Error({
          message: `Reference exceeds the image byte limit: ${filename}`,
        });
      }
      const bytes = buffer.slice(0, length);
      const mime = Mime.detect(bytes);
      if (!supported.has(mime))
        return yield* new Tool.Error({ message: `Unsupported reference image: ${filename}` });
      yield* validateImage(
        bytes,
        new Tool.Error({ message: `Invalid reference image: ${filename}` }),
      );
      return { type: "bytes" as const, data: bytes, mediaType: mime };
    }),
  );
});

export const run = Effect.fn("ImageTools.run")(
  function* (ctx: Client, defaultModel: string, input: typeof Input.Type, tool: Tool.Context) {
    const model = input.model ?? defaultModel;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const caller = yield* ctx.session.get({ sessionID: tool.sessionID });
    if (caller.location.workspaceID)
      return yield* new Tool.Error({
        message: "Image files require a native server location, not a remote workspace.",
      });
    const directory = caller.location.directory;
    const destination = path.resolve(
      directory,
      input.outputPath ??
        path.join(
          "generated_images",
          `${encodeURIComponent(tool.id)}-${Identifier.ascending()}.png`,
        ),
    );
    if (path.extname(destination).toLowerCase() !== ".png")
      return yield* new Tool.Error({ message: "Use a .png output path." });
    // The pinned server supplies these invocation-owned authorization services.
    // Consume its owner; never construct a second permission runtime or queue.
    const permission = yield* Effect.serviceOption(Permission.Service);
    const access = yield* Effect.serviceOption(FileAccess.Service);
    if (Option.isNone(permission) || Option.isNone(access))
      return yield* new Tool.Error({
        message: "This server lacks image-tool authorization services.",
      });
    const invocation = {
      sessionID: tool.sessionID,
      agent: tool.agent,
      source: { type: "tool" as const, messageID: tool.messageID, id: tool.id },
    };
    yield* permission.value.assert({ action: "image_generate", resources: ["*"], ...invocation });
    const target = yield* access.value.resolve({ path: destination, kind: "file" });
    yield* access.value.authorizeExternal([target], tool);
    yield* permission.value.assert({ action: "edit", resources: [target.resource], ...invocation });
    const references: Array<Extract<ImageInput, { type: "bytes" }>> = [];
    let remaining = 40 * 1024 * 1024;
    for (const reference of input.referencePaths ?? []) {
      const source = yield* access.value.authorizeRead(path.resolve(directory, reference), tool);
      const image = yield* readReference(source.absolute, remaining);
      remaining -= image.data.length;
      references.push(image);
    }
    yield* fs.makeDirectory(path.dirname(destination), { recursive: true });
    if (yield* fs.exists(destination))
      return yield* new Tool.Error({
        message: "Output already exists. Use a new .png output path.",
      });
    let partialPath: string | undefined;
    let synced = false;
    let published = false;
    const result = yield* Effect.scoped(
      Effect.gen(function* () {
        const staging = yield* Effect.acquireRelease(
          fs.makeTempDirectory({ directory: path.dirname(destination), prefix: ".ocui-image-" }),
          (stagingDirectory) => {
            // No caller acknowledgement exists at this boundary. Retain a
            // complete unpublished PNG even if cancellation discards recovery.
            if (synced && !published) {
              partialPath = path.join(stagingDirectory, "image.png");
              return Effect.logWarning("image_generate retained an unpublished PNG", {
                path: partialPath,
              });
            }
            return fs.remove(stagingDirectory, { recursive: true }).pipe(
              Effect.catch(() =>
                Effect.gen(function* () {
                  partialPath = path.join(stagingDirectory, "image.png");
                  yield* Effect.logWarning("image_generate retained a staging file", {
                    path: partialPath,
                  });
                }),
              ),
            );
          },
        );
        const stagedPath = path.join(staging, "image.png");
        // The file handle closes before its private staging directory is removed.
        const file = yield* fs.open(stagedPath, { flag: "wx", mode: 0o600 });
        yield* tool.progress({ stage: "generation", model });
        const response = yield* generateImage(ctx.integration, model, input, references, tool);
        const image = response.image;
        if (Predicate.isString(image.data)) {
          return yield* new Tool.Error({
            message: `The provider returned a URL instead of PNG bytes. Recover the image from ${image.data}; do not regenerate.`,
            metadata: { stage: "response", uncertain: true },
          });
        }
        if (image.data.length > maxBytes || Mime.detect(image.data) !== "image/png") {
          return yield* new Tool.Error({
            message:
              "The provider returned an unsupported or oversized image. Do not automatically regenerate.",
            metadata: { stage: "response", uncertain: true },
          });
        }
        yield* validateImage(
          image.data,
          new Tool.Error({
            message: "The provider returned an invalid image. Do not automatically regenerate.",
            metadata: { stage: "response", uncertain: true },
          }),
        );
        const imageUri = `data:image/png;base64,${Encoding.encodeBase64(image.data)}`;
        // Native writes/publication are not cancellable. Settle before cleanup.
        // A hard link publishes complete bytes atomically and never replaces a
        // concurrent destination; cleanup never touches the public pathname.
        const saved = yield* file.writeAll(image.data).pipe(
          Effect.andThen(file.sync),
          Effect.tap(() =>
            Effect.sync(() => {
              synced = true;
            }),
          ),
          Effect.andThen(fs.link(stagedPath, destination)),
          Effect.tap(() =>
            Effect.sync(() => {
              published = true;
            }),
          ),
          Effect.as(true),
          Effect.catch((error) =>
            Effect.logWarning("image_generate could not publish its PNG", {
              path: destination,
              reason: error.reason._tag,
              method: error.reason.method,
            }).pipe(Effect.as(false)),
          ),
          Effect.uninterruptible,
        );
        return { imageUri, saved };
      }),
    );
    const saved = result.saved;
    const attachmentName = `ocui-image-${Identifier.ascending()}`;
    const attachment = `attachment:${attachmentName}`;
    const output: Types.Mutable<typeof Output.Type> = {
      saved,
      model,
      mime: "image/png",
      attachment,
      ...(saved
        ? { path: destination }
        : {
            requestedPath: destination,
            warning:
              "Image generated, but saving failed. Recover the original PNG attachment; do not regenerate.",
          }),
    };
    if (partialPath) output.partialPath = partialPath;
    const content: Tool.Content[] = [
      {
        type: "text",
        text: `${saved ? `Saved image to ${destination}` : (output.warning ?? "Image was not saved.")}\nDisplay inline with ![Descriptive alternative text](${attachment}).`,
      },
    ];
    content.push(
      {
        type: "file",
        uri: result.imageUri,
        mime: "image/png",
        name: `${attachmentName}.png`,
      },
      {
        type: "file",
        // Code Mode collects file attachments even if later JavaScript throws.
        // A binary PNG bypasses preview normalization and retains exact bytes.
        uri: result.imageUri.replace("data:image/png;", "data:application/octet-stream;"),
        mime: "application/octet-stream",
        name: `${attachmentName}.original.png`,
      },
    );
    return {
      output,
      content,
    };
  },
  Effect.mapError((error) =>
    Schema.is(Tool.Error)(error)
      ? error
      : Schema.is(Permission.BlockedError)(error)
        ? new Tool.Error({ message: error.message })
        : Schema.is(Permission.CorrectedError)(error)
          ? new Tool.Error({ message: `Image authorization declined: ${error.feedback}` })
          : new Tool.Error({
              message:
                "Image file or session operation failed. Check the server paths and permissions before retrying.",
            }),
  ),
);

export function makeImageTool(ctx: Client, defaultModel = "gpt-image-2.5-flare") {
  return {
    name: "image_generate",
    description:
      "Generate one PNG image, or edit it using up to five referencePaths. Paths are on the server and relative to the calling session. Existing output files are never overwritten. Returns the saved path, image, and attachment reference. Display the image inline in your response with ![Descriptive alternative text](<attachment value>); use the returned attachment value, not the filesystem path. On an uncertain failure or save failure, recover the result before requesting another generation.",
    input: Input,
    output: Output,
    options: { codemode: true },
    execute: (input, tool) =>
      run(ctx, defaultModel, input, tool).pipe(
        // oxlint-disable-next-line effecttsgo/strict-effect-provide -- Each tool invocation is an entry point with its own HTTP and filesystem scope.
        Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, FetchHttpClient.layer)),
      ),
  } satisfies Tool.Info<typeof Input, typeof Output>;
}
