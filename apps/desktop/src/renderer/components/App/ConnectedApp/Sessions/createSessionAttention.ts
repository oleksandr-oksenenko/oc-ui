import { useAtomValue } from "@effect/atom-solid";
import { locationKey, type Data } from "@opencode/client/solid";
import type { OpenCodeClient } from "@opencode/client";
import { Effect } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { createEffect, on, onCleanup, type Accessor } from "solid-js";

import type { WorkspaceOwner } from "../../../../workspace-owner.ts";

export type SessionAttention = "completed" | "permission" | "question";

/** Workspace-owned unread markers; pending requests remain owned by the SDK. */
export function createSessionAttention(input: {
  readonly effects: WorkspaceOwner;
  readonly listLocations: OpenCodeClient["debug"]["location"]["list"];
  readonly data: Pick<Data, "on"> & {
    readonly session: {
      readonly get: Data["session"]["get"];
      readonly permission: Pick<Data["session"]["permission"], "sync" | "invalidate"> & {
        // The SDK returns undefined until this session cache is hydrated.
        readonly list: (
          sessionID: string,
        ) => ReturnType<Data["session"]["permission"]["list"]> | undefined;
      };
      readonly form: Pick<Data["session"]["form"], "list" | "sync" | "invalidate">;
    };
  };
  readonly sessionIDs: Accessor<readonly string[]>;
  readonly connected: Accessor<boolean>;
  readonly selectedID: Accessor<string | undefined>;
}) {
  const unreadAtom = Atom.make(new Set<string>());
  input.effects.mount(unreadAtom);
  const unread = useAtomValue(() => unreadAtom);
  const clear = (id: string) => {
    const current = input.effects.registry.get(unreadAtom);
    if (!current.has(id)) return;
    const next = new Set(current);
    next.delete(id);
    input.effects.registry.set(unreadAtom, next);
  };
  const complete = (id: string) => {
    if (id === input.selectedID()) return;
    input.effects.registry.set(
      unreadAtom,
      new Set([...input.effects.registry.get(unreadAtom), id]),
    );
  };
  onCleanup(
    input.data.on("session.execution.succeeded", (event) => complete(event.data.sessionID)),
  );
  onCleanup(input.data.on("session.execution.failed", (event) => complete(event.data.sessionID)));
  onCleanup(input.data.on("session.execution.started", (event) => clear(event.data.sessionID)));
  onCleanup(input.data.on("session.deleted", (event) => clear(event.data.sessionID)));
  createEffect(() => {
    const id = input.selectedID();
    if (id !== undefined) clear(id);
  });

  // Hydrate unopened sessions too; the SDK owns the cache and in-flight reads.
  // Workspace requests await settlement on cancellation or shutdown.
  const refresh = input.effects.latest();
  onCleanup(refresh.cancel);
  createEffect(
    on(
      () => [input.connected(), input.sessionIDs().join("\0")] as const,
      ([connected, ids], previous) => {
        if (!connected) {
          refresh.cancel();
          return;
        }
        const reconnecting = previous?.[0] === false;
        const missing = (ids ? ids.split("\0") : []).filter(
          (id) =>
            reconnecting ||
            input.data.session.form.list(id) === undefined ||
            input.data.session.permission.list(id) === undefined,
        );
        refresh.run(
          Effect.gen(function* () {
            if (missing.length === 0) return;
            const loaded = yield* input.effects.request((signal) =>
              input.listLocations({ signal }),
            );
            const keys = new Set(loaded.map(locationKey));
            const active = missing.filter((id) => {
              const session = input.data.session.get(id);
              return session && keys.has(locationKey(session.location));
            });
            yield* Effect.forEach(
              active,
              (id) =>
                Effect.forEach(
                  ["form", "permission"] as const,
                  (kind) => {
                    const cache = input.data.session[kind];
                    if (!reconnecting && cache.list(id) !== undefined) return Effect.void;
                    if (reconnecting) cache.invalidate(id);
                    return input.effects
                      .request(() => cache.sync(id))
                      .pipe(
                        Effect.catch(() =>
                          Effect.logWarning("Pending session requests could not be refreshed", {
                            sessionID: id,
                            kind,
                          }),
                        ),
                      );
                  },
                  { discard: true },
                ),
              { concurrency: 4, discard: true },
            );
          }).pipe(
            Effect.catch(() =>
              Effect.logWarning("Active locations could not be read for pending session requests"),
            ),
          ),
        );
      },
    ),
  );

  return (id: string): SessionAttention | undefined => {
    if (input.data.session.permission.list(id)?.length) return "permission";
    if (input.data.session.form.list(id)?.length) return "question";
    return unread().has(id) ? "completed" : undefined;
  };
}
