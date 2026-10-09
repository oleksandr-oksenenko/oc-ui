import { Plugin } from "@opencode/plugin/effect";
import { Message } from "@opencode/ai";
import { Effect, Schema } from "effect";

// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- The plugin entry registers the invocation-owned image tool.
import { makeImageTool } from "./image-generate.js";

const Options = Schema.Struct({
  model: Schema.optionalKey(Schema.String.check(Schema.isPattern(/\S/))),
});

/** Original attachments belong to the transcript; models receive the preview. */
export function modelMessages(messages: readonly Message[]): Message[] {
  return messages.map((message) =>
    Message.make({
      // oxlint-disable-next-line typescript/no-misused-spread -- Message.make restores the upstream class after replacing its immutable content.
      ...message,
      content: message.content.map((part) =>
        part.type === "tool-result" && part.result.type === "content"
          ? {
              ...part,
              result: {
                ...part.result,
                value: part.result.value.filter(
                  (item) =>
                    !(
                      item.type === "file" &&
                      item.mime === "application/octet-stream" &&
                      item.name?.endsWith(".original.png") &&
                      item.uri.startsWith("data:application/octet-stream;base64,iVBORw0KGgo")
                    ),
                ),
              },
            }
          : part,
      ),
    }),
  );
}

export default Plugin.define({
  id: "oc-ui.image-tools",
  effect: Effect.fn("ImageTools.setup")(function* (ctx) {
    const options = yield* Schema.decodeEffect(Options)(ctx.options).pipe(Effect.orDie);
    yield* ctx.tool.transform((editor) => editor.add(makeImageTool(ctx, options.model)));
    for (const kind of ["context", "compaction", "generate", "title"] as const)
      yield* ctx.session.hook(kind, (event) =>
        Effect.sync(() => {
          event.messages = modelMessages(event.messages);
        }),
      );
  }),
});
