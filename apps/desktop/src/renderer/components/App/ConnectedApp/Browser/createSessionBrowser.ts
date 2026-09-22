import { useAtomValue } from "@effect/atom-solid";
import { Browser } from "@opencode/plugin-browser/rpc";
import { SessionID } from "@opencode/schema/session-id";
import { Effect } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { createEffect, type Accessor } from "solid-js";

import {
  emptyBrowserState,
  type BrowserApi,
  type BrowserEvent,
  type BrowserLayout,
} from "../../../../../shared/browser-api.ts";
import type { ConnectedRuntime } from "../../../../opencode/runtime.ts";
import { WorkspaceRequestError } from "../../../../workspace-owner.ts";
import {
  annotationBatchProblem,
  annotationFiles,
  annotationNumber,
  captureDraft,
  emptyAnnotations,
  formatBrowserAnnotations,
  MAX_ANNOTATIONS,
  type SessionAnnotations,
} from "./browser-annotations.ts";

type BrowserStateEvent = Extract<BrowserEvent, { type: "state" }>;
export type SessionBrowserState = {
  readonly bindingID?: string;
  readonly status: Exclude<BrowserStateEvent["status"], "closed"> | "idle" | "connecting";
  readonly browser: Browser.State;
  readonly error?: string;
};
const idle = (): SessionBrowserState => ({ status: "idle", browser: emptyBrowserState() });
const message = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback;

/** Main owns attachments; a workspace-scoped IPC call retains each until cleanup settles. */
export function createSessionBrowser(
  runtime: Pick<ConnectedRuntime, "effects">,
  api: BrowserApi | undefined,
  endpoint: { readonly serverUrl: string; readonly password: string },
  selectedID: Accessor<string | undefined>,
  onFocus: (sessionID: string) => void,
  onAnnotationBatch: (sessionID: string, text: string, files: readonly File[]) => void,
) {
  const { effects } = runtime;
  const all = Atom.make<ReadonlyMap<string, SessionBrowserState>>(new Map());
  effects.mount(all);
  const values = useAtomValue(() => all);
  const state = (id: string) => effects.registry.get(all).get(id) ?? idle();
  const update = (id: string, value: SessionBrowserState) =>
    effects.registry.update(all, (old) => new Map(old).set(id, value));
  const annotations = Atom.make<ReadonlyMap<string, SessionAnnotations>>(new Map());
  effects.mount(annotations);
  const annotationValues = useAtomValue(() => annotations);
  const annotationState = (id: string) => annotationValues().get(id) ?? emptyAnnotations();
  const writeAnnotations = (id: string, value: SessionAnnotations) =>
    effects.registry.update(annotations, (old) => new Map(old).set(id, value));
  const sessionFor = (event: BrowserEvent) =>
    Array.from(effects.registry.get(all)).find(([, value]) => value.bindingID === event.bindingID);
  const unsubscribe = api?.onEvent((event) => {
    const match = sessionFor(event);
    if (!match) return;
    const [id] = match;
    if (event.type === "annotation") {
      const current = annotationState(id);
      // A capture for a canceled or replaced pick is not part of the draft anymore.
      if (current.request !== event.capture.requestID) return;
      if (current.items.length >= MAX_ANNOTATIONS) {
        writeAnnotations(id, {
          ...current,
          status: "idle",
          request: undefined,
          error: `At most ${MAX_ANNOTATIONS} annotations can be attached at once. Add these to the composer or clear them first.`,
        });
        return;
      }
      const draft = captureDraft(event.capture);
      writeAnnotations(id, {
        ...current,
        status: "idle",
        request: undefined,
        items: [...current.items, draft],
      });
      return;
    }
    // Background tab activity must not replace the session the user is viewing.
    if (event.type === "focus") {
      if (id === selectedID()) onFocus(id);
      return;
    }
    update(id, {
      bindingID: event.status === "connected" ? event.bindingID : undefined,
      status: event.status === "closed" ? "failed" : event.status,
      browser: event.state,
      error:
        event.error ??
        (event.status === "closed"
          ? "Browser connection closed. Reconnect to continue."
          : undefined),
    });
  });
  effects.runSync(Effect.addFinalizer(() => Effect.sync(() => unsubscribe?.())));

  const connect = (id: string | undefined) => {
    if (!api || !id || ["connecting", "connected"].includes(state(id).status)) return;
    // oxlint-disable-next-line effecttsgo/crypto-random-uuid -- The pinned Effect RC has no UUID API; use platform correlation IDs.
    const bindingID = crypto.randomUUID();
    update(id, { bindingID, status: "connecting", browser: emptyBrowserState() });
    effects.runFork(
      Effect.callback<void, WorkspaceRequestError>((resume, signal) => {
        const pending = api
          .attach({
            bindingID,
            sessionID: SessionID.make(id),
            serverUrl: endpoint.serverUrl,
            password: endpoint.password,
          })
          .then(
            () => resume(Effect.void),
            (cause) => resume(Effect.fail(new WorkspaceRequestError({ cause }))),
          );
        // Cancel the native owner before awaiting the lifetime call, including pending setup.
        return Effect.gen(function* () {
          if (signal.aborted)
            yield* effects
              .request(() => api.detach({ bindingID }))
              .pipe(Effect.catch((error) => Effect.logWarning("Browser detach failed", error)));
          yield* Effect.promise(() => pending);
        });
      }).pipe(
        Effect.catch(() =>
          Effect.sync(() => {
            if (state(id).bindingID === bindingID && state(id).status === "connecting")
              update(id, {
                ...state(id),
                status: "failed",
                error: "Browser could not connect. Check the server and reconnect.",
              });
          }),
        ),
      ),
    );
  };
  createEffect(() => {
    const id = selectedID();
    if (id && state(id).status === "idle") connect(id);
  });
  return {
    available: api !== undefined,
    current: () => values().get(selectedID() ?? "") ?? idle(),
    annotations: () => annotationState(selectedID() ?? ""),
    reconnect: () => connect(selectedID()),
    command: (action: Browser.Action) => {
      const id = selectedID();
      const value = id ? state(id) : undefined;
      if (!api || !id || value?.status !== "connected" || !value.bindingID) return;
      const bindingID = value.bindingID;
      update(id, { ...value, error: undefined });
      effects.runFork(
        effects
          .request(() => api.command({ bindingID, action }))
          .pipe(
            Effect.catch((error) =>
              Effect.sync(() => {
                if (state(id).bindingID === bindingID)
                  update(id, {
                    ...state(id),
                    error: message(
                      error.cause,
                      "Browser action failed. Inspect the page before repeating it.",
                    ),
                  });
              }),
            ),
          ),
      );
    },
    layout: (input: BrowserLayout) => {
      if (api)
        effects.runFork(
          effects
            .request(() => api.layout(input))
            .pipe(
              Effect.catch((error) => Effect.logWarning("Browser viewport update failed", error)),
            ),
        );
    },
    annotate: (mode: "element" | "area") => {
      const id = selectedID();
      const value = id ? state(id) : undefined;
      const tabID = value?.browser.focusedTabID;
      if (!api || !id || !value?.bindingID || !tabID || value.status !== "connected") return;
      const current = annotationState(id);
      if (current.status !== "idle") return;
      if (current.items.length >= MAX_ANNOTATIONS) {
        writeAnnotations(id, {
          ...current,
          error: `At most ${MAX_ANNOTATIONS} annotations can be attached at once. Add these to the composer or clear them first.`,
        });
        return;
      }
      const bindingID = value.bindingID;
      // oxlint-disable-next-line effecttsgo/crypto-random-uuid -- The pinned Effect RC has no UUID API; use platform correlation IDs.
      const requestID = crypto.randomUUID();
      const number = annotationNumber(current.items);
      writeAnnotations(id, {
        ...current,
        status: "picking",
        request: requestID,
        error: undefined,
      });
      effects.runFork(
        effects
          .request((signal) => {
            const pending = api.annotationStart({ bindingID, tabID, requestID, number, mode });
            // Owner disposal cancels the native pick before awaiting the request.
            const cancel = () => {
              void api.annotationCancel({ bindingID, tabID }).catch(() => undefined);
            };
            if (signal.aborted) cancel();
            else signal.addEventListener("abort", cancel, { once: true });
            return pending.finally(() => signal.removeEventListener("abort", cancel));
          })
          .pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                const latest = annotationState(id);
                if (latest.request !== requestID) return;
                writeAnnotations(id, { ...latest, status: "idle", request: undefined });
              }),
            ),
            Effect.catch((error) =>
              Effect.sync(() => {
                const latest = annotationState(id);
                if (latest.request !== requestID) return;
                writeAnnotations(id, {
                  ...latest,
                  status: "idle",
                  request: undefined,
                  error: message(error.cause, "Annotation capture failed. Select again."),
                });
              }),
            ),
          ),
      );
    },
    cancelAnnotation: () => {
      const id = selectedID();
      const value = id ? state(id) : undefined;
      const current = id ? annotationState(id) : undefined;
      const tabID = value?.browser.focusedTabID;
      if (!api || !id || !value?.bindingID || !current || !tabID || current.status === "idle")
        return;
      writeAnnotations(id, { ...current, status: "idle", request: undefined, error: undefined });
      const bindingID = value.bindingID;
      effects.runFork(
        effects
          .request(() => api.annotationCancel({ bindingID, tabID }))
          .pipe(
            Effect.catch((error) => Effect.logWarning("Annotation cancellation failed", error)),
          ),
      );
    },
    annotationBody: (annotationID: string, body: string) => {
      const id = selectedID();
      if (!id) return;
      const current = annotationState(id);
      writeAnnotations(id, {
        ...current,
        items: current.items.map((item) => (item.id === annotationID ? { ...item, body } : item)),
      });
    },
    discardAnnotation: (annotationID: string) => {
      const id = selectedID();
      if (!id) return;
      const current = annotationState(id);
      writeAnnotations(id, {
        ...current,
        items: current.items.filter((item) => item.id !== annotationID),
      });
    },
    clearAnnotations: () => {
      const id = selectedID();
      if (!id) return;
      writeAnnotations(id, emptyAnnotations());
    },
    addAnnotations: () => {
      const id = selectedID();
      if (!id) return;
      const current = annotationState(id);
      const problem = annotationBatchProblem(current.items);
      if (problem) {
        writeAnnotations(id, { ...current, error: problem });
        return;
      }
      try {
        onAnnotationBatch(
          id,
          formatBrowserAnnotations(current.items),
          annotationFiles(current.items),
        );
        writeAnnotations(id, emptyAnnotations());
      } catch (cause) {
        writeAnnotations(id, {
          ...current,
          error: message(cause, "Annotations could not be added to the composer."),
        });
      }
    },
  };
}
export type SessionBrowser = ReturnType<typeof createSessionBrowser>;
