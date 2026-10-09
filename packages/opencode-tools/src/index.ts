import { Plugin } from "@opencode/plugin/effect";
import { Effect, Scope } from "effect";

// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- The plugin entry is the composition root for this scoped tool.
import { makeSessionTool } from "./session-create.js";
import { sessionTools } from "./session-tools.js";

export default Plugin.define({
  id: "oc-ui.tools",
  effect: Effect.fn("OpenCodeTools.setup")(function* (ctx) {
    const tool = yield* makeSessionTool(ctx);
    const management = sessionTools(ctx, yield* Scope.Scope);
    yield* ctx.tool.transform((editor) => {
      editor.namespace({
        name: "session",
        description: "Create, inspect, message, and manage OpenCode sessions.",
      });
      editor.add(tool);
      for (const definition of management) editor.add(definition);
      for (const name of ["rename", "move"]) {
        const existing = editor.get(`opencode_session_${name}`);
        if (!existing) continue;
        editor.add({
          ...existing,
          name,
          options: {
            ...existing.options,
            permission: existing.options?.permission ?? existing.id,
            namespace: "session",
            codemode: true,
          },
        });
        editor.remove(existing.id);
      }
      for (const registered of editor.list()) {
        if (["read", "shell", "patch", "edit", "write", "execute"].includes(registered.id))
          continue;
        editor.update(registered.id, (draft) => {
          draft.options = { ...draft.options, codemode: true };
        });
      }
    });
    yield* ctx.session.hook("context", (event) =>
      Effect.sync(() => {
        event.system = event.system.map((part) => ({
          ...part,
          text: part.text.replaceAll("tools.opencode.session_move", "tools.session.move"),
        }));
      }),
    );
  }),
});
