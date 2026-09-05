import type { Data } from "@opencode-ai/client/solid";
import type { OpenCodeClient } from "@opencode-ai/client";
import { useAtomValue } from "@effect/atom-solid";
import { Effect } from "effect";
import { Atom } from "effect/unstable/reactivity";
import type { WorkspaceOwner } from "../workspace-owner.ts";
import type { OpenCodeEventSource } from "./event-source";

type SessionCatalogState = "loading" | "ready" | "failed";

export type SessionCatalog = {
  readonly ids: () => readonly string[];
  readonly state: () => SessionCatalogState;
  readonly error: () => string | undefined;
  readonly sync: () => Promise<void>;
  readonly admit: (sessionID: string) => void;
  readonly remove: (sessionID: string) => void;
};

type CatalogMutation =
  | { readonly kind: "admit"; readonly sessionID: string }
  | { readonly kind: "remove"; readonly sessionID: string };

type SessionCatalogInput = {
  readonly effects: WorkspaceOwner;
  readonly api: { readonly session: Pick<OpenCodeClient["session"], "list"> };
  readonly data: { readonly session: Pick<Data["session"], "remember" | "sync"> };
  readonly events: Pick<OpenCodeEventSource, "on">;
};

export function createSessionCatalog(input: SessionCatalogInput): SessionCatalog {
  const { effects } = input;
  const idsAtom = Atom.make<readonly string[]>([]);
  const stateAtom = Atom.make<SessionCatalogState>("loading");
  const errorAtom = Atom.make<string | undefined>(undefined);
  effects.mount(idsAtom);
  effects.mount(stateAtom);
  effects.mount(errorAtom);
  const ids = useAtomValue(() => idsAtom);
  const state = useAtomValue(() => stateAtom);
  const error = useAtomValue(() => errorAtom);
  let activeSync: { readonly mutations: CatalogMutation[] } | undefined;

  const apply = (mutation: CatalogMutation): void => {
    effects.registry.update(idsAtom, (current) => {
      if (mutation.kind === "admit") {
        return current.includes(mutation.sessionID) ? current : [...current, mutation.sessionID];
      }
      return current.filter((id) => id !== mutation.sessionID);
    });
  };

  const mutate = (mutation: CatalogMutation): void => {
    apply(mutation);
    activeSync?.mutations.push(mutation);
  };

  effects.runSync(
    Effect.acquireRelease(
      Effect.sync(() => [
        input.events.on("session.created", (event) => {
          const { data } = event;
          mutate({ kind: "admit", sessionID: data.sessionID });
          // Creation events contain a payload, so ask the SDK for the complete record.
          effects.runFork(
            effects.request(() => input.data.session.sync(data.sessionID)).pipe(Effect.ignore),
          );
        }),
        input.events.on("session.deleted", (event) => {
          mutate({ kind: "remove", sessionID: event.data.sessionID });
        }),
      ]),
      (stops) => Effect.sync(() => stops.forEach((stop) => stop())),
    ),
  );

  const refresh = Effect.gen(function* () {
    effects.registry.set(stateAtom, "loading");
    effects.registry.set(errorAtom, undefined);
    const mutations: CatalogMutation[] = [];
    activeSync = { mutations };
    const snapshotIDs = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = yield* effects.request((signal) =>
        input.api.session.list(
          {
            order: "desc",
            limit: 100,
            cursor,
          },
          { signal },
        ),
      );
      for (const info of page.data) {
        if (
          !snapshotIDs.has(info.id) &&
          !mutations.some(
            (mutation) => mutation.kind === "remove" && mutation.sessionID === info.id,
          )
        ) {
          snapshotIDs.add(info.id);
          input.data.session.remember(info);
        }
      }
      cursor = page.cursor.next ?? undefined;
    } while (cursor !== undefined);
    effects.registry.set(idsAtom, [...snapshotIDs]);
    for (const mutation of mutations) apply(mutation);
    effects.registry.set(stateAtom, "ready");
  }).pipe(
    Effect.tapError(() =>
      Effect.sync(() => {
        effects.registry.set(stateAtom, "failed");
        effects.registry.set(errorAtom, "The session list could not be loaded.");
      }),
    ),
    Effect.ensuring(
      Effect.sync(() => {
        activeSync = undefined;
      }),
    ),
  );

  const sharedRefresh = effects.runSync(Effect.cachedWithTTL(refresh, 0));
  const sync = (): Promise<void> => effects.runPromise(sharedRefresh);

  return {
    ids,
    state,
    error,
    sync,
    admit: (sessionID) => mutate({ kind: "admit", sessionID }),
    remove: (sessionID) => mutate({ kind: "remove", sessionID }),
  };
}

export const syncActiveStatuses = Effect.fn("syncActiveStatuses")(function* (input: {
  readonly effects: WorkspaceOwner;
  readonly api: { readonly session: Pick<OpenCodeClient["session"], "active"> };
  readonly data: { readonly session: Pick<Data["session"], "setStatus"> };
  readonly sessionIDs: readonly string[];
}) {
  for (const sessionID of input.sessionIDs) input.data.session.setStatus(sessionID, "idle");
  const active = yield* input.effects.request((signal) => input.api.session.active({ signal }));
  for (const sessionID of Object.keys(active)) input.data.session.setStatus(sessionID, "running");
});
