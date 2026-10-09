import { layer } from "@effect/vitest";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Agent } from "@opencode/schema/agent";
import { Credential } from "@opencode/schema/credential";
import { Session } from "@opencode/schema/session";
import { SessionMessage } from "@opencode/schema/session-message";
import { Tool } from "@opencode/schema/tool";
import { Workspace } from "@opencode/schema/workspace";
import { FileAccess } from "@opencode/core/file-access";
import { Permission } from "@opencode/core/permission";
import { AbsolutePath } from "@opencode/core/schema";
import {
  Context,
  Deferred,
  Effect,
  Encoding,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  PlatformError,
  Schema,
} from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { expect, vi } from "vite-plus/test";

// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- These tests exercise the tool workflow with real filesystem services and an injected HTTP boundary.
import { Input, makeImageTool, run } from "./image-generate.js";

const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
const png = Schema.decodeSync(Schema.Uint8ArrayFromBase64)(pngBase64);
const oauth = Schema.decodeSync(Credential.OAuth)({
  type: "oauth",
  methodID: "chatgpt-browser",
  access: "test-access",
  refresh: "test-refresh",
  expires: 9999999999999,
  metadata: { accountID: "test-account" },
});
type Client = Parameters<typeof makeImageTool>[0];

const fixture = Effect.fn("fixture")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: "ocui-image-" });
  const caller = yield* Schema.decodeEffect(Session.Info)({
    id: Session.ID.create(),
    projectID: "test-project",
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  });
  const resolve = vi.fn<Client["integration"]["connection"]["resolve"]>(() =>
    Effect.succeed(oauth),
  );
  const ctx: Client = {
    session: { get: () => Effect.succeed(caller) },
    integration: {
      connection: {
        active: () =>
          Effect.succeed({
            type: "credential",
            id: Credential.ID.create(),
            label: "ChatGPT",
          }),
        resolve,
      },
    },
  };
  const tool: Tool.Context = {
    sessionID: caller.id,
    messageID: SessionMessage.ID.create(),
    agent: Agent.ID.make("build"),
    id: Tool.CallID.make("call-image"),
    progress: () => Effect.void,
  };
  const fetch = vi.fn<typeof globalThis.fetch>(() =>
    Promise.resolve(Response.json({ created: 1, data: [{ b64_json: pngBase64 }] })),
  );
  return { fs, directory, caller, ctx, tool, fetch, resolve };
});

const resolveTarget = ({ path }: FileAccess.ResolveInput) =>
  Effect.succeed({ absolute: AbsolutePath.make(path), resource: path });
const authorization = Layer.mergeAll(
  Layer.mock(Permission.Service, { assert: () => Effect.void }),
  Layer.mock(FileAccess.Service, {
    resolve: resolveTarget,
    authorizeExternal: () => Effect.void,
    authorizeRead: (path) => resolveTarget({ path }),
  }),
);

layer(authorization)("image_generate", (it) => {
  it.effect.each(["image_generate", "edit", "external_directory", "read"])(
    "honors %s denial before file mutation or provider dispatch",
    (denied) =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const assert = vi.fn((input: Permission.AssertInput) =>
          input.action === denied
            ? Effect.fail(
                new Permission.BlockedError({
                  rules: [],
                  permission: input.action,
                  resources: [...input.resources],
                }),
              )
            : Effect.void,
        );
        const result = yield* makeImageTool(f.ctx, "gpt-image-2")
          .execute(
            { prompt: "Otter", outputPath: "nested/blocked.png", referencePaths: ["secret.png"] },
            f.tool,
          )
          .pipe(
            Effect.provide(
              Layer.mergeAll(
                Layer.mock(Permission.Service, { assert }),
                Layer.mock(FileAccess.Service, {
                  resolve: resolveTarget,
                  authorizeExternal: () =>
                    assert({
                      sessionID: f.caller.id,
                      action: "external_directory",
                      resources: ["outside/*"],
                    }),
                  authorizeRead: (path) =>
                    assert({ sessionID: f.caller.id, action: "read", resources: [path] }).pipe(
                      Effect.andThen(resolveTarget({ path })),
                    ),
                }),
              ),
            ),
            Effect.provideService(FetchHttpClient.Fetch, f.fetch),
            Effect.flip,
          );
        expect(result.message).toContain(denied);
        expect(assert.mock.calls.some(([input]) => input.action === denied)).toBe(true);
        expect(yield* f.fs.readDirectory(f.directory)).toEqual([]);
        expect(f.fetch).not.toHaveBeenCalled();
      }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("fails before dispatch when the host lacks authorization services", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const error = yield* makeImageTool(f.ctx, "gpt-image-2")
        .execute({ prompt: "Otter" }, f.tool)
        .pipe(
          Effect.updateContext((context: Context.Context<never>) =>
            Context.omit(Permission.Service)(context),
          ),
          Effect.provideService(FetchHttpClient.Fetch, f.fetch),
          Effect.flip,
        );
      expect(error.message).toContain("authorization services");
      expect(yield* f.fs.readDirectory(f.directory)).toEqual([]);
      expect(f.fetch).not.toHaveBeenCalled();
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("generates once with ChatGPT credentials and persists a PNG and preview", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const tool = makeImageTool(f.ctx, "gpt-image-2");
      const result = yield* tool
        .execute({ prompt: "An otter" }, f.tool)
        .pipe(Effect.provideService(FetchHttpClient.Fetch, f.fetch));
      expect(result.output.saved).toBe(true);
      expect(result.output.path).toMatch(/\/generated_images\/call-image-[A-Za-z0-9]{26}\.png$/);
      expect(Encoding.encodeBase64(yield* f.fs.readFile(result.output.path!))).toBe(pngBase64);
      expect(result.content).toContainEqual({
        type: "file",
        uri: `data:image/png;base64,${pngBase64}`,
        mime: "image/png",
        name: result.output.path!.split("/").at(-1),
      });
      expect(result.content).toContainEqual({
        type: "file",
        uri: `data:application/octet-stream;base64,${pngBase64}`,
        mime: "application/octet-stream",
        name: result.output
          .path!.split("/")
          .at(-1)!
          .replace(/\.png$/i, ".original.png"),
      });
      expect(f.fetch).toHaveBeenCalledTimes(1);
      const [url, init] = f.fetch.mock.calls[0]!;
      expect(new Request(url, init).url).toBe(
        "https://chatgpt.com/backend-api/codex/images/generations",
      );
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-access");
      expect(new Headers(init?.headers).get("chatgpt-account-id")).toBe("test-account");
      const body = yield* Effect.promise(() => new Request(url, init).text());
      expect(yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(body)).toEqual({
        model: "gpt-image-2",
        prompt: "An otter",
        n: 1,
        quality: "auto",
        size: "auto",
        background: "auto",
      });
      expect(yield* Schema.decodeEffect(tool.output)(result.output)).toEqual(result.output);
    }).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
  );

  it.effect.each([1, 2])(
    "saves distinct defaults with a shared Code Mode call ID at concurrency %i",
    (concurrency) =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const tool = makeImageTool(f.ctx, "gpt-image-2");
        const results = yield* Effect.all(
          [
            tool.execute({ prompt: "First otter" }, f.tool),
            tool.execute({ prompt: "Second otter" }, f.tool),
          ],
          { concurrency },
        ).pipe(Effect.provideService(FetchHttpClient.Fetch, f.fetch));
        const filenames = results.map((result) => result.output.path);
        expect(new Set(filenames).size).toBe(2);
        for (const result of results) {
          expect(result.output.saved).toBe(true);
          expect(Encoding.encodeBase64(yield* f.fs.readFile(result.output.path!))).toBe(pngBase64);
        }
        expect(f.fetch).toHaveBeenCalledTimes(2);
      }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect.each([1, 5])("sends %i local edit references as JSON, preserving options", (count) =>
    Effect.gen(function* () {
      const f = yield* fixture();
      yield* f.fs.writeFile(`${f.directory}/reference.bin`, png);
      const result = yield* makeImageTool(f.ctx, "gpt-image-2.5-flare")
        .execute(
          {
            prompt: "Make it transparent",
            referencePaths: Array.from({ length: count }, () => "reference.bin"),
            outputPath: "edited.png",
            background: "transparent",
          },
          f.tool,
        )
        .pipe(Effect.provideService(FetchHttpClient.Fetch, f.fetch));
      expect(result.output.saved).toBe(true);
      const [url, init] = f.fetch.mock.calls[0]!;
      expect(new Request(url, init).url).toBe("https://chatgpt.com/backend-api/codex/images/edits");
      expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
      const body = yield* Effect.promise(() => new Request(url, init).text());
      expect(yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(body)).toEqual({
        model: "gpt-image-2.5-flare",
        prompt: "Make it transparent",
        n: 1,
        quality: "auto",
        size: "auto",
        background: "transparent",
        images: Array.from({ length: count }, () => ({
          image_url: `data:image/png;base64,${pngBase64}`,
        })),
      });
      expect(f.fetch).toHaveBeenCalledTimes(1);
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("keeps an existing destination untouched without generating", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const filename = `${f.directory}/existing.png`;
      yield* f.fs.writeFileString(filename, "existing");
      const exit = yield* makeImageTool(f.ctx, "gpt-image-2")
        .execute({ prompt: "Otter", outputPath: "existing.png" }, f.tool)
        .pipe(Effect.provideService(FetchHttpClient.Fetch, f.fetch), Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      expect(yield* f.fs.readFileString(filename)).toBe("existing");
      expect(f.fetch).not.toHaveBeenCalled();
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect.each(["missing", "key", "wrong-method"])(
    "rejects %s authentication and cleans its staging files",
    (kind) =>
      Effect.gen(function* () {
        const f = yield* fixture();
        f.resolve.mockImplementation(() =>
          Effect.succeed(
            kind === "missing"
              ? undefined
              : kind === "key"
                ? Credential.Key.make({ type: "key", key: "api-key" })
                : { ...oauth, methodID: Credential.OAuth.fields.methodID.make("other-oauth") },
          ),
        );
        const exit = yield* makeImageTool(f.ctx, "gpt-image-2")
          .execute({ prompt: "Otter", outputPath: "auth.png" }, f.tool)
          .pipe(Effect.provideService(FetchHttpClient.Fetch, f.fetch), Effect.exit);
        expect(Exit.isFailure(exit)).toBe(true);
        expect(yield* f.fs.exists(`${f.directory}/auth.png`)).toBe(false);
        expect(f.fetch).not.toHaveBeenCalled();
      }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("resolves refreshed credentials on each invocation, including account changes", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const tool = makeImageTool(f.ctx, "gpt-image-2");
      yield* tool
        .execute({ prompt: "One", outputPath: "one.png", referencePaths: [] }, f.tool)
        .pipe(Effect.provideService(FetchHttpClient.Fetch, f.fetch));
      f.resolve.mockImplementation(() =>
        Effect.succeed({ ...oauth, access: "refreshed", metadata: undefined }),
      );
      yield* tool
        .execute({ prompt: "Two", outputPath: "two.png" }, f.tool)
        .pipe(Effect.provideService(FetchHttpClient.Fetch, f.fetch));
      const headers = new Headers(f.fetch.mock.calls[1]![1]?.headers);
      expect(headers.get("authorization")).toBe("Bearer refreshed");
      expect(headers.has("chatgpt-account-id")).toBe(false);
      expect(f.resolve).toHaveBeenCalledTimes(2);
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect.each(["directory", "text", "oversized", "truncated", "corrupt"])(
    "rejects %s reference before dispatch",
    (kind) =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const filename = `${f.directory}/bad`;
        if (kind === "directory") yield* f.fs.makeDirectory(filename);
        else
          yield* f.fs.writeFile(
            filename,
            kind === "text"
              ? new TextEncoder().encode("not an image")
              : kind === "truncated"
                ? png.subarray(0, 8)
                : kind === "corrupt"
                  ? new Uint8Array([...png.subarray(0, 45), ...new Uint8Array(png.length - 45)])
                  : new Uint8Array(20 * 1024 * 1024 + 1),
          );
        const exit = yield* makeImageTool(f.ctx, "gpt-image-2")
          .execute({ prompt: "Otter", referencePaths: ["bad"] }, f.tool)
          .pipe(Effect.provideService(FetchHttpClient.Fetch, f.fetch), Effect.exit);
        expect(Exit.isFailure(exit)).toBe(true);
        expect(f.fetch).not.toHaveBeenCalled();
      }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("rejects remote-workspace paths before touching the filesystem", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      f.ctx.session = {
        get: () =>
          Effect.succeed({
            ...f.caller,
            location: { ...f.caller.location, workspaceID: Workspace.ID.create() },
          }),
      };
      const exit = yield* makeImageTool(f.ctx, "gpt-image-2")
        .execute({ prompt: "Otter" }, f.tool)
        .pipe(Effect.provideService(FetchHttpClient.Fetch, f.fetch), Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      expect(f.fetch).not.toHaveBeenCalled();
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect.each([
    "invalid-base64",
    "invalid-image",
    "truncated",
    "corrupt",
    "empty",
    "http-error",
  ])("fails %s without retrying or retaining a partial file", (kind) =>
    Effect.gen(function* () {
      const f = yield* fixture();
      f.fetch.mockImplementation(() =>
        Promise.resolve(
          Response.json(
            kind === "http-error"
              ? { error: { message: "Usage limit reached" } }
              : {
                  data:
                    kind === "empty"
                      ? []
                      : [
                          {
                            b64_json:
                              kind === "invalid-base64"
                                ? "!bad"
                                : kind === "truncated"
                                  ? Encoding.encodeBase64(png.subarray(0, 8))
                                  : kind === "corrupt"
                                    ? Encoding.encodeBase64(
                                        new Uint8Array([
                                          ...png.subarray(0, 45),
                                          ...new Uint8Array(png.length - 45),
                                        ]),
                                      )
                                    : "bm90LWltYWdl",
                          },
                        ],
                },
            { status: kind === "http-error" ? 429 : 200 },
          ),
        ),
      );
      const exit = yield* makeImageTool(f.ctx, "gpt-image-2")
        .execute({ prompt: "Otter", outputPath: "bad.png" }, f.tool)
        .pipe(Effect.provideService(FetchHttpClient.Fetch, f.fetch), Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      expect(yield* f.fs.exists(`${f.directory}/bad.png`)).toBe(false);
      expect(yield* f.fs.readDirectory(f.directory)).toEqual([]);
      expect(f.fetch).toHaveBeenCalledTimes(1);
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("fails a URL-only response with its recovery URL without regenerating", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      f.fetch.mockImplementation(() =>
        Promise.resolve(Response.json({ data: [{ url: "https://example.com/generated.png" }] })),
      );
      const result = yield* makeImageTool(f.ctx, "gpt-image-2")
        .execute({ prompt: "Otter", outputPath: "url.png" }, f.tool)
        .pipe(Effect.provideService(FetchHttpClient.Fetch, f.fetch), Effect.flip);
      expect(result.message).toContain("https://example.com/generated.png");
      expect(result.message).toContain("do not regenerate");
      expect(yield* f.fs.exists(`${f.directory}/url.png`)).toBe(false);
      expect(f.fetch).toHaveBeenCalledTimes(1);
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect(
    "preserves original image data and removes a partial destination after a write failure",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const fs: FileSystem.FileSystem = {
          ...f.fs,
          open: (filename, options) =>
            f.fs.open(filename, options).pipe(
              Effect.map((file) =>
                options?.flag === "wx"
                  ? {
                      ...file,
                      sync: file.sync,
                      writeAll: (bytes) =>
                        file.writeAll(bytes.subarray(0, 8)).pipe(
                          Effect.andThen(
                            Effect.fail(
                              PlatformError.systemError({
                                module: "FileSystem",
                                method: "write",
                                _tag: "PermissionDenied",
                                description: "simulated write failure",
                              }),
                            ),
                          ),
                        ),
                    }
                  : file,
              ),
            ),
        };
        const result = yield* run(
          f.ctx,
          "gpt-image-2",
          { prompt: "Otter", outputPath: "partial.png" },
          f.tool,
        ).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provide(Layer.mergeAll(NodePath.layer, FetchHttpClient.layer)),
          Effect.provideService(FetchHttpClient.Fetch, f.fetch),
        );
        expect(result.output).toMatchObject({
          saved: false,
        });
        expect(result.output.path).toBeUndefined();
        expect(
          yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(result.output),
        ).not.toContain(pngBase64);
        expect(result).not.toHaveProperty("metadata");
        expect(result.content).toContainEqual({
          type: "file",
          uri: `data:application/octet-stream;base64,${pngBase64}`,
          mime: "application/octet-stream",
          name: "partial.original.png",
        });
        expect(yield* f.fs.exists(`${f.directory}/partial.png`)).toBe(false);
        expect(f.fetch).toHaveBeenCalledTimes(1);
      }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("interrupts response body consumption, aborts HTTP, and awaits output cleanup", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const started = yield* Deferred.make<void>();
      let signal: AbortSignal | undefined;
      f.fetch.mockImplementation((_url, init) => {
        signal = init?.signal ?? undefined;
        return Promise.resolve(
          new Response(
            new ReadableStream({
              pull() {
                Deferred.doneUnsafe(started, Effect.void);
              },
              start(controller) {
                signal?.addEventListener("abort", () => controller.error(new Error("aborted")), {
                  once: true,
                });
              },
            }),
          ),
        );
      });
      const fiber = yield* makeImageTool(f.ctx, "gpt-image-2")
        .execute({ prompt: "Otter", outputPath: "cancel.png" }, f.tool)
        .pipe(Effect.provideService(FetchHttpClient.Fetch, f.fetch), Effect.forkChild);
      yield* Deferred.await(started);
      yield* Fiber.interrupt(fiber);
      expect(signal?.aborted).toBe(true);
      expect(yield* f.fs.exists(`${f.directory}/cancel.png`)).toBe(false);
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("aborts a request before response headers and awaits file cleanup", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const started = yield* Deferred.make<void>();
      let signal: AbortSignal | undefined;
      f.fetch.mockImplementation((_url, init) => {
        signal = init?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          Deferred.doneUnsafe(started, Effect.void);
        });
      });
      const fiber = yield* makeImageTool(f.ctx, "gpt-image-2")
        .execute({ prompt: "Otter", outputPath: "headers.png" }, f.tool)
        .pipe(Effect.provideService(FetchHttpClient.Fetch, f.fetch), Effect.forkChild);
      yield* Deferred.await(started);
      yield* Fiber.interrupt(fiber);
      expect(signal?.aborted).toBe(true);
      expect(yield* f.fs.exists(`${f.directory}/headers.png`)).toBe(false);
      expect(f.fetch).toHaveBeenCalledTimes(1);
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect.each(["interrupt", "complete"])(
    "preserves a destination created during generation on %s",
    (outcome) =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const tool = {
          ...f.tool,
          progress: (value: Parameters<Tool.Context["progress"]>[0]) =>
            value.stage === "generation"
              ? Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release)))
              : Effect.void,
        };
        const fiber = yield* makeImageTool(f.ctx, "gpt-image-2")
          .execute({ prompt: "Otter", outputPath: "replacement.png" }, tool)
          .pipe(Effect.provideService(FetchHttpClient.Fetch, f.fetch), Effect.forkChild);
        yield* Deferred.await(started);
        expect(yield* f.fs.exists(`${f.directory}/replacement.png`)).toBe(false);
        yield* f.fs.writeFileString(`${f.directory}/replacement.png`, "unrelated content");
        if (outcome === "interrupt") yield* Fiber.interrupt(fiber);
        else {
          yield* Deferred.succeed(release, undefined);
          const result = yield* Fiber.join(fiber);
          expect(result.output.saved).toBe(false);
          expect(result.output.partialPath).toBeDefined();
          expect(Encoding.encodeBase64(yield* f.fs.readFile(result.output.partialPath!))).toBe(
            pngBase64,
          );
        }
        expect(yield* f.fs.readFileString(`${f.directory}/replacement.png`)).toBe(
          "unrelated content",
        );
        const entries = yield* f.fs.readDirectory(f.directory);
        expect(entries.filter((entry) => !entry.startsWith(".ocui-image-"))).toEqual([
          "replacement.png",
        ]);
        expect(entries.filter((entry) => entry.startsWith(".ocui-image-"))).toHaveLength(
          outcome === "interrupt" ? 0 : 1,
        );
        expect(f.fetch).toHaveBeenCalledTimes(outcome === "interrupt" ? 0 : 1);
      }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect.each(["absent", "understated", "error"])(
    "bounds streamed response bytes with %s content length/status and aborts on overflow",
    (kind) =>
      Effect.gen(function* () {
        const f = yield* fixture();
        let signal: AbortSignal | undefined;
        let chunks = 0;
        const cancel = vi.fn();
        f.fetch.mockImplementation((_url, init) => {
          signal = init?.signal ?? undefined;
          return Promise.resolve(
            new Response(
              new ReadableStream({
                pull(controller) {
                  // Valid image JSON followed by unbounded whitespace. A body reader
                  // that waits for EOF hangs here instead of rejecting the overflow.
                  controller.enqueue(
                    chunks++ === 0
                      ? new TextEncoder().encode(
                          JSON.stringify({ data: [{ b64_json: pngBase64 }] }),
                        )
                      : new Uint8Array(1024 * 1024).fill(32),
                  );
                },
                cancel,
              }),
              {
                status: kind === "error" ? 429 : 200,
                headers: kind === "understated" ? { "content-length": "1" } : {},
              },
            ),
          );
        });
        const exit = yield* makeImageTool(f.ctx, "gpt-image-2")
          .execute({ prompt: "Otter", outputPath: "overflow.png" }, f.tool)
          .pipe(Effect.provideService(FetchHttpClient.Fetch, f.fetch), Effect.exit);
        expect(Exit.isFailure(exit)).toBe(true);
        expect(chunks).toBeLessThanOrEqual(31);
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(signal?.aborted).toBe(true);
        expect(yield* f.fs.readDirectory(f.directory)).toEqual([]);
        expect(f.fetch).toHaveBeenCalledTimes(1);
      }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("settles an interrupted native commit and preserves its completed image", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const fs: FileSystem.FileSystem = {
        ...f.fs,
        open: (filename, options) =>
          f.fs.open(filename, options).pipe(
            Effect.map((file) =>
              options?.flag === "wx"
                ? {
                    ...file,
                    sync: file.sync,
                    writeAll: (bytes) =>
                      Deferred.succeed(started, undefined).pipe(
                        Effect.andThen(Deferred.await(release)),
                        Effect.andThen(file.writeAll(bytes)),
                      ),
                  }
                : file,
            ),
          ),
      };
      const fiber = yield* run(
        f.ctx,
        "gpt-image-2",
        { prompt: "Otter", outputPath: "commit.png" },
        f.tool,
      ).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provide(Layer.mergeAll(NodePath.layer, FetchHttpClient.layer)),
        Effect.provideService(FetchHttpClient.Fetch, f.fetch),
        Effect.forkChild,
      );
      yield* Deferred.await(started);
      const interrupt = yield* Fiber.interrupt(fiber).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      const pending = interrupt.pollUnsafe();
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(interrupt);
      expect(pending).toBeUndefined();
      expect(Encoding.encodeBase64(yield* f.fs.readFile(`${f.directory}/commit.png`))).toBe(
        pngBase64,
      );
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect.each(["complete", "interrupt"])(
    "retains synced bytes when pending publication fails on %s",
    (outcome) =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const fs: FileSystem.FileSystem = {
          ...f.fs,
          link: (source, destination) =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.andThen(f.fs.link(source, destination)),
            ),
        };
        const fiber = yield* run(
          f.ctx,
          "gpt-image-2",
          { prompt: "Otter", outputPath: "collision.png" },
          f.tool,
        ).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provide(Layer.mergeAll(NodePath.layer, FetchHttpClient.layer)),
          Effect.provideService(FetchHttpClient.Fetch, f.fetch),
          Effect.forkChild,
        );
        yield* Deferred.await(started);
        yield* f.fs.writeFileString(`${f.directory}/collision.png`, "unrelated image");
        const interrupt =
          outcome === "interrupt"
            ? yield* Fiber.interrupt(fiber).pipe(Effect.forkChild)
            : undefined;
        yield* Effect.yieldNow;
        yield* Deferred.succeed(release, undefined);
        if (interrupt) {
          yield* Fiber.join(interrupt);
          expect(Exit.isFailure(yield* Fiber.await(fiber))).toBe(true);
        } else {
          const result = yield* Fiber.join(fiber);
          expect(result.output.saved).toBe(false);
          expect(result.output.partialPath).toMatch(/\.ocui-image-.*\/image\.png$/);
        }
        const staging = (yield* f.fs.readDirectory(f.directory)).filter((entry) =>
          entry.startsWith(".ocui-image-"),
        );
        expect(staging).toHaveLength(1);
        expect(
          Encoding.encodeBase64(yield* f.fs.readFile(`${f.directory}/${staging[0]}/image.png`)),
        ).toBe(pngBase64);
        expect(yield* f.fs.readFileString(`${f.directory}/collision.png`)).toBe("unrelated image");
        expect(f.fetch).toHaveBeenCalledTimes(1);
      }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it("validates the model-facing schema", () => {
    expect(() => Schema.decodeSync(Input)({ prompt: " " })).toThrow();
    expect(() =>
      Schema.decodeSync(Input)({ prompt: "Otter", referencePaths: Array(6).fill("image.png") }),
    ).toThrow();
  });
});
