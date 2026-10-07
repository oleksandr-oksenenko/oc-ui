import { useAtomValue } from "@effect/atom-solid";
import { Effect } from "effect";
import { Atom } from "effect/unstable/reactivity";
import type { WorkspaceOwner } from "../workspace-owner.ts";
import type { Data } from "@opencode/client/solid";
import type { ModelRef, OpenCodeClient, SessionInfo } from "@opencode/client";
import { createEffect, createMemo, on, onCleanup } from "solid-js";
import { createModelCatalog } from "./model-catalog.ts";
import {
  modelChoiceID,
  modelChoices,
  modelVariantAvailable,
  resolveModel,
  variantChoices,
} from "./model-choices.ts";

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
    readonly plugin: Pick<OpenCodeClient["plugin"], "awaitActivation">;
    readonly session: Pick<OpenCodeClient["session"], "switchModel">;
  };
  readonly data: {
    readonly on: Data["on"];
    readonly location: {
      readonly model: Pick<Data["location"]["model"], "list" | "sync" | "invalidate">;
    };
    readonly session: Pick<Data["session"], "get" | "sync" | "invalidate">;
  };
  readonly connected: () => boolean;
  readonly selectedSession: () => SessionInfo | undefined;
};

/** Owns the server-backed model and variant selection policy for the selected session. */
export function createModelSelection(input: ModelSelectionInput): ModelSelection {
  const { effects } = input;
  const catalog = createModelCatalog({
    ...input,
    location: () => input.selectedSession()?.location,
  });
  const status = Atom.make<{
    switchError?: { sessionID: string; message: string };
    switchingIDs: ReadonlySet<string>;
  }>({ switchingIDs: new Set<string>() });
  effects.mount(status);
  const current = useAtomValue(() => status);
  const update = (patch: Partial<Atom.Type<typeof status>>) => {
    effects.registry.set(status, { ...effects.registry.get(status), ...patch });
  };

  let selection: object | undefined = {};
  createEffect(
    on(
      () => {
        const session = input.selectedSession();
        return session
          ? JSON.stringify([session.id, session.location.directory, session.location.workspaceID])
          : undefined;
      },
      () => {
        selection = {};
        update({ switchError: undefined });
      },
    ),
  );
  onCleanup(() => {
    selection = undefined;
  });
  const models = catalog.models;
  const choices = createMemo<readonly ModelSelectionChoice[]>(() => modelChoices(models()));
  const reference = () => input.selectedSession()?.model ?? catalog.defaultRef();
  const selectedModel = createMemo(() => resolveModel(models(), reference()));
  const selectedModelID = createMemo(() => {
    const model = reference();
    return model ? modelChoiceID(model) : undefined;
  });
  const contextLimit = () => selectedModel()?.limit.context;
  const variants = createMemo<readonly ModelSelectionChoice[]>(() =>
    variantChoices(selectedModel()),
  );
  const selectedVariantID = createMemo(() => {
    const variantID = reference()?.variant;
    return variantID === "default" ? undefined : variantID;
  });
  const switching = createMemo(() => {
    const sessionID = input.selectedSession()?.id;
    return sessionID !== undefined && current().switchingIDs.has(sessionID);
  });
  const error = createMemo(() => {
    const value = current();
    const loadError = catalog.error();
    if (loadError || catalog.state() === "failed") return loadError;
    if (value.switchError?.sessionID === input.selectedSession()?.id)
      return value.switchError?.message;
    if (catalog.state() !== "ready") return undefined;
    if (reference() && !selectedModel())
      return "The selected model is unavailable at this location. Choose a model.";
    const model = selectedModel();
    if (model && !modelVariantAvailable(model, reference()?.variant))
      return "The selected model variant is unavailable at this location. Choose a variant.";
    return undefined;
  });

  const switchSelection = Effect.fn("modelSelection.switch")(function* (
    model: ModelRef,
    failureMessage: string,
  ) {
    const session = input.selectedSession();
    const initiatingSelection = selection;
    if (
      !session ||
      !initiatingSelection ||
      !input.connected() ||
      effects.registry.get(status).switchingIDs.has(session.id)
    )
      return;
    const sessionID = session.id;
    update({
      switchError: undefined,
      switchingIDs: new Set(effects.registry.get(status).switchingIDs).add(sessionID),
    });
    const report = (message: string) => {
      if (selection === initiatingSelection && input.connected())
        update({ switchError: { sessionID, message } });
    };
    yield* Effect.gen(function* () {
      const switched = yield* effects
        .request((signal) => input.api.session.switchModel({ sessionID, model }, { signal }))
        .pipe(
          Effect.match({
            onSuccess: () => true,
            onFailure: () => false,
          }),
        );
      yield* effects
        .request(() => {
          input.data.session.invalidate(sessionID);
          return input.data.session.sync(sessionID);
        })
        .pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              const selected = input.data.session.get(sessionID)?.model;
              if (
                !switched &&
                (selected?.id !== model.id ||
                  selected.providerID !== model.providerID ||
                  (selected.variant ?? "default") !== (model.variant ?? "default"))
              )
                report(failureMessage);
            }),
          ),
          Effect.catch(() =>
            Effect.sync(() =>
              report(
                switched
                  ? "The selection changed, but its current value could not be refreshed."
                  : "The selection could not be confirmed. Refresh before trying again.",
              ),
            ),
          ),
        );
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          const next = new Set(effects.registry.get(status).switchingIDs);
          next.delete(sessionID);
          update({ switchingIDs: next });
        }),
      ),
    );
  });

  return {
    state: catalog.state,
    error,
    switching,
    models: choices,
    selectedModelID,
    contextLimit,
    variants,
    selectedVariantID,
    sync: catalog.sync,
    selectModel: (choiceID) => {
      const model = models().find((candidate) => modelChoiceID(candidate) === choiceID);
      if (!model || catalog.state() !== "ready") return Promise.resolve();
      return effects.runPromise(
        switchSelection(
          { id: model.id, providerID: model.providerID },
          "The model could not be changed. Try again.",
        ),
      );
    },
    selectVariant: (variantID) => {
      const model = selectedModel();
      if (
        !model ||
        catalog.state() !== "ready" ||
        !variants().some((variant) => variant.id === variantID)
      )
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
