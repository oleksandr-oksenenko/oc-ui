import { Plugin } from "@opencode-ai/plugin/effect";
import { Effect } from "effect";

// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- The plugin entry is the composition root for this scoped tool.
import { makeSessionTool } from "./session-create.js";

export default Plugin.define({
  id: "oc-ui.session-tools",
  effect: Effect.fn("SessionTools.setup")(function* (ctx) {
    const tool = yield* makeSessionTool(ctx);
    yield* ctx.tool.transform((editor) => editor.add(tool));
  }),
});
