import { useAtomValue } from "@effect/atom-solid";
import { Effect } from "effect";
import { Atom } from "effect/unstable/reactivity";
import type { WorkspaceOwner } from "../workspace-owner.ts";
import type { Data } from "@opencode-ai/client/solid";
import type {
  LocationRef,
  ModelInfo,
  ModelRef,
  OpenCodeClient,
  SessionInfo,
} from "@opencode-ai/client";
import { createMemo } from "solid-js";

type ModelSelectionChoice = {
  readonly id: string;
  readonly label: string;
  readonly group?: string;
};

type ModelSelectionState = "loading" | "ready" | "failed";

export type ModelSelection = {
  readonly state: () => ModelSelectionState;
  readonly error: () => string | undefined;
  readonly switching: () => boolean;
  readonly models: () => readonly ModelSelectionChoice[];
  readonly selectedModelID: () => string | undefined;
  /** Context window of the selected model, in tokens. */
  readonly contextLimit: () => number | undefined;
  readonly variants: () => readonly ModelSelectionChoice[];
  readonly selectedVariantID: () => string | undefined;
  readonly sync: () => Promise<void>;
  readonly selectModel: (choiceID: string) => Promise<void>;
  readonly selectVariant: (variantID: string) => Promise<void>;
};

type ModelSelectionInput = {
  readonly effects: WorkspaceOwner;
  readonly api: {
    readonly model: Pick<OpenCodeClient["model"], "default">;
    readonly session: Pick<OpenCodeClient["session"], "switchModel">;
  };
  readonly data: {
    readonly location: {
      readonly model: Pick<Data["location"]["model"], "list" | "sync" | "invalidate">;
    };
    readonly session: Pick<Data["session"], "sync">;
  };
  readonly defaultLocation: LocationRef;
  readonly selectedSession: () => SessionInfo | undefined;
};

/** Owns the server-backed model and variant selection policy for the selected session. */
export function createModelSelection(input: ModelSelectionInput): ModelSelection {
  const { effects } = input;
  const status = Atom.make<{
    state: ModelSelectionState;
    serverDefault?: ModelInfo;
    loadError?: string;
    switchError?: { sessionID: string; message: string };
    switchingIDs: ReadonlySet<string>;
  }>({ state: "loading", switchingIDs: new Set<string>() });
  effects.mount(status);
  const current = useAtomValue(() => status);
  const update = (patch: Partial<Atom.Type<typeof status>>) => {
    effects.registry.set(status, { ...effects.registry.get(status), ...patch });
  };

  const models = createMemo(() =>
    (input.data.location.model.list(input.defaultLocation) ?? []).filter((model) => model.enabled),
  );
  const choices = createMemo<readonly ModelSelectionChoice[]>(() =>
    models().map((model) => ({
      id: modelChoiceID(model),
      label: model.name,
      group: model.providerID,
    })),
  );
  const selectedModel = createMemo(() => {
    const sessionModel = input.selectedSession()?.model;
    if (sessionModel) return models().find((model) => sameModel(model, sessionModel));
    const fallback = current().serverDefault;
    return fallback?.enabled ? models().find((model) => sameModel(model, fallback)) : undefined;
  });
  const selectedModelID = createMemo(() => {
    const model = selectedModel();
    return model ? modelChoiceID(model) : undefined;
  });
  const contextLimit = () => selectedModel()?.limit.context;
  const variants = createMemo<readonly ModelSelectionChoice[]>(() =>
    (selectedModel()?.variants ?? []).map((variant) => ({ id: variant.id, label: variant.id })),
  );
  const selectedVariantID = createMemo(() => {
    const variantID = input.selectedSession()?.model?.variant;
    return variantID && variants().some((variant) => variant.id === variantID)
      ? variantID
      : undefined;
  });
  const switching = createMemo(() => {
    const sessionID = input.selectedSession()?.id;
    return sessionID !== undefined && current().switchingIDs.has(sessionID);
  });
  const error = createMemo(() => {
    const value = current();
    if (value.state === "failed") return value.loadError;
    return value.switchError?.sessionID === input.selectedSession()?.id
      ? value.switchError?.message
      : undefined;
  });

  const refresh = Effect.fn("modelSelection.refresh")(function* () {
    update({ state: "loading", loadError: undefined });
    const location = input.defaultLocation;
    input.data.location.model.invalidate(location);
    const [, fallback] = yield* Effect.all(
      [
        effects.request(() => input.data.location.model.sync(location)),
        effects.request((signal) => input.api.model.default({ location }, { signal })),
      ],
      { concurrency: "unbounded" },
    ).pipe(
      Effect.tapError(() =>
        Effect.sync(() =>
          update({
            serverDefault: undefined,
            state: "failed",
            loadError: "Models could not be loaded. Check the connection and try again.",
          }),
        ),
      ),
    );
    update({ serverDefault: fallback.data ?? undefined, state: "ready" });
  });
  const sharedRefresh = effects.runSync(Effect.cachedWithTTL(refresh(), 0));
  const sync = (): Promise<void> => effects.runPromise(sharedRefresh);

  const switchSelection = Effect.fn("modelSelection.switch")(function* (
    model: ModelRef,
    failureMessage: string,
  ) {
    const session = input.selectedSession();
    if (!session || effects.registry.get(status).switchingIDs.has(session.id)) return;
    update({
      switchError: undefined,
      switchingIDs: new Set(effects.registry.get(status).switchingIDs).add(session.id),
    });
    const report = (message: string) => update({ switchError: { sessionID: session.id, message } });
    yield* Effect.gen(function* () {
      const switched = yield* effects
        .request((signal) =>
          input.api.session.switchModel({ sessionID: session.id, model }, { signal }),
        )
        .pipe(
          Effect.match({
            onSuccess: () => true,
            onFailure: () => {
              report(failureMessage);
              return false;
            },
          }),
        );
      if (!switched) return;
      yield* effects
        .request(() => input.data.session.sync(session.id))
        .pipe(
          Effect.catch(() =>
            Effect.sync(() =>
              report("The selection changed, but its current value could not be refreshed."),
            ),
          ),
        );
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          const next = new Set(effects.registry.get(status).switchingIDs);
          next.delete(session.id);
          update({ switchingIDs: next });
        }),
      ),
    );
  });

  return {
    state: () => current().state,
    error,
    switching,
    models: choices,
    selectedModelID,
    contextLimit,
    variants,
    selectedVariantID,
    sync,
    selectModel: (choiceID) => {
      const model = models().find((candidate) => modelChoiceID(candidate) === choiceID);
      if (!model) return Promise.resolve();
      return effects.runPromise(
        switchSelection(
          { id: model.id, providerID: model.providerID },
          "The model could not be changed. Try again.",
        ),
      );
    },
    selectVariant: (variantID) => {
      const model = selectedModel();
      if (!model || !variants().some((variant) => variant.id === variantID))
        return Promise.resolve();
      return effects.runPromise(
        switchSelection(
          { id: model.id, providerID: model.providerID, variant: variantID },
          "The variant could not be changed. Try again.",
        ),
      );
    },
  };
}

function modelChoiceID(model: Pick<ModelInfo, "id" | "providerID">): string {
  return JSON.stringify([model.providerID, model.id]);
}

function sameModel(
  model: Pick<ModelInfo, "id" | "providerID">,
  reference: Pick<ModelRef, "id" | "providerID">,
): boolean {
  return model.id === reference.id && model.providerID === reference.providerID;
}
