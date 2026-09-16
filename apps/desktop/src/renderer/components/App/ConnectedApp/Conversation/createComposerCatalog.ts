import { useAtomValue } from "@effect/atom-solid";
import type { LocationRef } from "@opencode/client";
import type { Data } from "@opencode/client/solid";
import { Effect } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { createEffect, on, onCleanup, type Accessor } from "solid-js";
import type { WorkspaceOwner } from "../../../../workspace-owner.ts";
import type { ComposerProps } from "./SessionPane/Composer.tsx";

type ReadState = "loading" | "ready" | "failed";

const sections = ["commands", "skills"] as const;

/**
 * One read lifetime for both composer inventories. The SDK owns each list and
 * its refresh events; this coordinator owns sync attempts and menu status.
 * Sections settle independently so one failed read does not hide the other.
 */
export function createComposerCatalog(input: {
  effects: WorkspaceOwner;
  sources: {
    readonly commands: Data["location"]["command"];
    readonly skills: Data["location"]["skill"];
  };
  location: Accessor<LocationRef | undefined>;
  connected: Accessor<boolean>;
}): NonNullable<ComposerProps["catalog"]> {
  const state = Atom.make<Record<(typeof sections)[number], ReadState>>({
    commands: "loading",
    skills: "loading",
  });
  input.effects.mount(state);
  const status = useAtomValue(() => state);
  const read = input.effects.latest();

  const setSection = (section: (typeof sections)[number], value: ReadState): void => {
    input.effects.registry.set(state, { ...input.effects.registry.get(state), [section]: value });
  };
  const refresh = (target: readonly (typeof sections)[number][] = sections): void => {
    const location = input.location();
    const connected = input.connected();
    if (location === undefined || !connected) {
      input.effects.registry.set(state, { commands: "failed", skills: "failed" });
      read.run(Effect.void);
      return;
    }
    const next = { ...input.effects.registry.get(state) };
    for (const section of target) next[section] = "loading";
    input.effects.registry.set(state, next);
    read.run(
      Effect.forEach(
        target,
        (section) =>
          input.effects
            .request(() => input.sources[section].sync(location))
            .pipe(
              Effect.match({
                onSuccess: () => setSection(section, "ready"),
                onFailure: () => setSection(section, "failed"),
              }),
            ),
        { concurrency: "unbounded", discard: true },
      ),
    );
  };
  createEffect(
    on(
      () => [input.location(), input.connected()],
      () => refresh(),
    ),
  );
  onCleanup(() => read.cancel());

  const items = <T>(
    section: (typeof sections)[number],
    source: { readonly list: (ref: LocationRef) => T[] | undefined },
  ): readonly T[] => {
    const location = input.location();
    if (status()[section] !== "ready" || location === undefined) return [];
    return source.list(location) ?? [];
  };

  return {
    get commands() {
      return {
        state: status().commands,
        items: items("commands", input.sources.commands),
      };
    },
    get skills() {
      return {
        state: status().skills,
        items: items("skills", input.sources.skills).filter((skill) => skill.slash !== false),
      };
    },
    onRetry: () => refresh(sections.filter((section) => status()[section] !== "ready")),
  };
}
