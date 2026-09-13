import { useAtomValue } from "@effect/atom-solid";
import type { LocationRef } from "@opencode-ai/client";
import type { Data } from "@opencode-ai/client/solid";
import { Effect } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { createEffect, createMemo, on, onCleanup, type Accessor } from "solid-js";
import type { WorkspaceOwner } from "../../../../workspace-owner.ts";
import type { ComposerProps } from "./SessionPane/Composer.tsx";

/** SDK owns inventory and refresh events; the workspace owns read lifetime and UI status. */
export function createSkillCatalog(input: {
  effects: WorkspaceOwner;
  source: Data["location"]["skill"];
  location: Accessor<LocationRef | undefined>;
  connected: Accessor<boolean>;
}): NonNullable<ComposerProps["skillCatalog"]> {
  const state = Atom.make<"loading" | "ready" | "failed">("loading");
  input.effects.mount(state);
  const status = useAtomValue(() => state);
  const read = input.effects.latest();
  const context = createMemo(() => JSON.stringify([input.location(), input.connected()]));
  const refresh = () => {
    const location = input.location();
    input.effects.registry.set(state, location && input.connected() ? "loading" : "failed");
    read.run(
      !location || !input.connected()
        ? Effect.void
        : input.effects
            .request(() => input.source.sync(location))
            .pipe(
              Effect.match({
                onSuccess: () => input.effects.registry.set(state, "ready"),
                onFailure: () => input.effects.registry.set(state, "failed"),
              }),
            ),
    );
  };
  createEffect(on(context, refresh));
  onCleanup(() => read.cancel());
  return {
    get state() {
      return status();
    },
    get items() {
      const location = input.location();
      return location
        ? (input.source.list(location) ?? []).filter((skill) => skill.slash !== false)
        : [];
    },
    onRetry: refresh,
  };
}
