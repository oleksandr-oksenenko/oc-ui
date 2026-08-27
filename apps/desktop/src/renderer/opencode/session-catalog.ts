import type { Data } from "@opencode-ai/client/solid";
import type { LocationRef, OpenCodeClient, SessionInfo } from "@opencode-ai/client";
import { createSignal } from "solid-js";
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
  readonly api: { readonly session: Pick<OpenCodeClient["session"], "list"> };
  readonly data: { readonly session: Pick<Data["session"], "remember" | "sync"> };
  readonly defaultLocation: LocationRef;
  readonly events: Pick<OpenCodeEventSource, "on">;
};

export function createSessionCatalog(input: SessionCatalogInput): SessionCatalog {
  const [ids, setIds] = createSignal<readonly string[]>([]);
  const [state, setState] = createSignal<SessionCatalogState>("loading");
  const [error, setError] = createSignal<string>();
  let inFlight: Promise<void> | undefined;
  let activeSync: { readonly mutations: CatalogMutation[] } | undefined;

  const apply = (mutation: CatalogMutation): void => {
    setIds((current) => {
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

  input.events.on("session.created", (event) => {
    const { data } = event;
    if (data.parentID !== undefined || !sameLocation(data.location, input.defaultLocation)) return;
    mutate({ kind: "admit", sessionID: data.sessionID });
    // The event contains only the creation payload. Let createData fetch the
    // complete SessionInfo rather than fabricating an application record.
    void input.data.session.sync(data.sessionID).catch(() => undefined);
  });

  input.events.on("session.deleted", (event) => {
    mutate({ kind: "remove", sessionID: event.data.sessionID });
  });

  async function sync(): Promise<void> {
    if (inFlight) return inFlight;

    const run = (async () => {
      setState("loading");
      setError(undefined);
      const mutations: CatalogMutation[] = [];
      activeSync = { mutations };
      try {
        const snapshot: SessionInfo[] = [];
        let cursor: string | undefined;
        do {
          const page = await input.api.session.list({
            directory: input.defaultLocation.directory,
            parentID: null,
            order: "desc",
            limit: 100,
            cursor,
          });
          for (const info of page.data) {
            if (
              info.parentID === undefined &&
              sameLocation(info.location, input.defaultLocation) &&
              !mutations.some(
                (mutation) => mutation.kind === "remove" && mutation.sessionID === info.id,
              )
            ) {
              snapshot.push(info);
              input.data.session.remember(info);
            }
          }
          cursor = page.cursor.next ?? undefined;
        } while (cursor !== undefined);

        activeSync = undefined;
        setIds(snapshot.map((info) => info.id));
        for (const mutation of mutations) apply(mutation);
        setState("ready");
      } catch (cause) {
        activeSync = undefined;
        setState("failed");
        setError(errorMessage(cause));
        throw cause;
      } finally {
        inFlight = undefined;
      }
    })();

    inFlight = run;
    return run;
  }

  return {
    ids,
    state,
    error,
    sync,
    admit: (sessionID) => mutate({ kind: "admit", sessionID }),
    remove: (sessionID) => mutate({ kind: "remove", sessionID }),
  };
}

function sameLocation(left: LocationRef, right: LocationRef): boolean {
  return (
    left.directory === right.directory &&
    (right.workspaceID === undefined || left.workspaceID === right.workspaceID)
  );
}

export async function syncActiveStatuses(input: {
  readonly api: OpenCodeClient;
  readonly data: Data;
  readonly sessionIDs: readonly string[];
}): Promise<void> {
  for (const sessionID of input.sessionIDs) input.data.session.setStatus(sessionID, "idle");
  const active = await input.api.session.active();
  for (const sessionID of Object.keys(active)) input.data.session.setStatus(sessionID, "running");
}

function errorMessage(cause: unknown): string {
  void cause;
  return "The session list could not be loaded.";
}
