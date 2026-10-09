/* oxlint-disable effecttsgo/any-unknown-in-error-context -- OpenCode's credential resolver erases its errors; they are narrowed to a safe tool error at this boundary. */
import type { Plugin } from "@opencode/plugin/effect";
import { Image, ImageInput } from "@opencode/ai/image";
import { OpenAIImages } from "@opencode/ai/protocols/openai-images";
import { Auth } from "@opencode/ai/route/auth";
import { RequestExecutor } from "@opencode/ai/route/executor";
import { Tool } from "@opencode/schema/tool";
import { Context, Effect, Encoding, Layer, Predicate, Schema, Stream } from "effect";
import {
  Headers,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";

import type { Input } from "./image-generate.js";

const baseURL = "https://chatgpt.com/backend-api/codex";
// Enough for one 20 MiB image in base64 plus bounded JSON metadata.
const maxResponseBytes = 28 * 1024 * 1024;

export const generateImage = Effect.fn("ImageTools.generateImage")(function* (
  integration: Pick<Plugin.Context["integration"], "connection">,
  modelID: string,
  input: typeof Input.Type,
  references: ReadonlyArray<Extract<ImageInput, { type: "bytes" }>>,
  tool: Tool.Context,
) {
  const connection = yield* integration.connection.active("openai");
  const credential = connection
    ? yield* integration.connection.resolve(connection).pipe(
        Effect.mapError(
          () =>
            new Tool.Error({
              message: "Could not resolve the ChatGPT connection. Reconnect OpenAI and try again.",
            }),
        ),
      )
    : undefined;
  if (
    credential?.type !== "oauth" ||
    !["chatgpt-browser", "chatgpt-headless"].includes(credential.methodID)
  ) {
    return yield* new Tool.Error({
      message: "Connect OpenAI using ChatGPT sign-in to generate images.",
    });
  }
  const accountID = credential.metadata?.accountID;
  let headers = Headers.fromInput({ originator: "opencode", "session-id": tool.sessionID });
  if (Predicate.isString(accountID))
    headers = Headers.set(headers, "chatgpt-account-id", accountID);
  const model = OpenAIImages.model({
    id: modelID,
    baseURL,
    auth: Auth.bearer(credential.access),
    headers,
  });
  const scopedHttp = HttpClient.withScope(yield* HttpClient.HttpClient);
  const http = HttpClient.makeWith(
    (request: Effect.Effect<HttpClientRequest.HttpClientRequest>) =>
      request.pipe(
        Effect.flatMap((value) =>
          Effect.scoped(
            Effect.gen(function* () {
              const response = yield* scopedHttp.execute(value);
              const bytes = new Uint8Array(maxResponseBytes);
              let length = 0;
              // Bound actual streamed bytes, including chunked/decompressed bodies,
              // before either the executor or Images adapter buffers/parses JSON.
              yield* response.stream.pipe(
                Stream.runForEach((chunk) => {
                  if (chunk.length > maxResponseBytes - length)
                    return Effect.fail(
                      new HttpClientError.HttpClientError({
                        reason: new HttpClientError.DecodeError({
                          request: value,
                          response,
                          description: "Image response exceeds the 28 MiB limit",
                        }),
                      }),
                    );
                  // One capped buffer also bounds memory with tiny/empty chunks.
                  bytes.set(chunk, length);
                  length += chunk.length;
                  return Effect.void;
                }),
              );
              return HttpClientResponse.fromWeb(
                value,
                new Response(
                  [204, 205, 304].includes(response.status) ? null : bytes.subarray(0, length),
                  {
                    status: response.status,
                    headers: response.headers,
                  },
                ),
              );
            }),
          ),
        ),
      ),
    Effect.succeed,
  );
  const services = yield* Layer.build(
    RequestExecutor.layer.pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, http))),
  );
  const executor = Context.get(services, RequestExecutor.Service);
  const options = { n: 1, quality: "auto", size: "auto", background: input.background ?? "auto" };
  const request = Image.request({ model, prompt: input.prompt, images: references, options });
  return yield* model.route
    .generate(request, (outgoing) => {
      if (references.length === 0) return executor.execute(outgoing);
      // Only bridge the pinned adapter's known multipart edit request. The adapter
      // still owns authentication, response validation, and base64 decoding.
      if (
        outgoing.method !== "POST" ||
        outgoing.url !== `${baseURL}/images/edits` ||
        outgoing.body._tag !== "FormData"
      ) {
        return Effect.die("OpenAI Images edit request changed; update the Codex JSON bridge.");
      }
      const images = references.map((image) => {
        return { image_url: `data:${image.mediaType};base64,${Encoding.encodeBase64(image.data)}` };
      });
      return executor.execute(
        outgoing.pipe(
          HttpClientRequest.removeHeader("content-length"),
          HttpClientRequest.bodyJsonUnsafe({
            model: modelID,
            prompt: input.prompt,
            images,
            ...options,
          }),
        ),
      );
    })
    .pipe(
      Effect.timeout("5 minutes"),
      Effect.catchTag(
        "TimeoutError",
        () =>
          new Tool.Error({
            message:
              "Image request timed out. It may have been processed; do not automatically regenerate.",
            metadata: { stage: "generation", uncertain: true },
          }),
      ),
      Effect.mapError((error) => {
        if (Schema.is(Tool.Error)(error)) return error;
        const status = error.reason.http?.status;
        return new Tool.Error({
          message: `Image request failed (${error.reason._tag}${status === undefined ? "" : `, HTTP ${status}`}). The request may have been processed; do not automatically regenerate.`,
          metadata: { stage: "generation", uncertain: true },
        });
      }),
    );
});
