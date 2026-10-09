import { Plugin } from "@opencode/plugin/effect";
import { Effect } from "effect";

// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- The plugin entry is the composition root for this scoped tool.
import { makeSessionTool } from "./session-create.js";

export default Plugin.define({
  id: "oc-ui.tools",
  effect: Effect.fn("OpenCodeTools.setup")(function* (ctx) {
    const tool = yield* makeSessionTool(ctx);
    yield* ctx.tool.transform((editor) => {
      editor.add(tool);
      for (const registered of editor.list()) {
        if (["read", "shell", "patch", "edit", "write", "execute"].includes(registered.id))
          continue;
        editor.update(registered.id, (draft) => {
          draft.options = { ...draft.options, codemode: true };
        });
      }
    });
  }),
});
