import type { Data } from "@opencode-ai/client/solid";
import type {
  LocationRef,
  ModelInfo,
  ModelRef,
  OpenCodeClient,
  SessionInfo,
} from "@opencode-ai/client";
import { createMemo, createSignal } from "solid-js";

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
  readonly variants: () => readonly ModelSelectionChoice[];
  readonly selectedVariantID: () => string | undefined;
  readonly sync: () => Promise<void>;
  readonly selectModel: (choiceID: string) => Promise<void>;
  readonly selectVariant: (variantID: string) => Promise<void>;
};

type ModelSelectionInput = {
  readonly api: {
    readonly model: Pick<OpenCodeClient["model"], "list" | "default">;
    readonly session: Pick<OpenCodeClient["session"], "switchModel">;
  };
  readonly data: {
    readonly session: Pick<Data["session"], "sync">;
  };
  readonly defaultLocation: LocationRef;
  readonly selectedSession: () => SessionInfo | undefined;
};

/** Owns the server-backed model and variant selection policy for the selected session. */
export function createModelSelection(input: ModelSelectionInput): ModelSelection {
  const [catalog, setCatalog] = createSignal<readonly ModelInfo[]>([]);
  const [serverDefault, setServerDefault] = createSignal<ModelInfo>();
  const [state, setState] = createSignal<ModelSelectionState>("loading");
  const [loadError, setLoadError] = createSignal<string>();
  const [switchError, setSwitchError] = createSignal<{
    readonly sessionID: string;
    readonly message: string;
  }>();
  const [switchingIDs, setSwitchingIDs] = createSignal<ReadonlySet<string>>(new Set());
  let inFlight: Promise<void> | undefined;

  const models = createMemo(() => catalog().filter((model) => model.enabled));
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
    const fallback = serverDefault();
    return fallback?.enabled ? models().find((model) => sameModel(model, fallback)) : undefined;
  });
  const selectedModelID = createMemo(() => {
    const model = selectedModel();
    return model ? modelChoiceID(model) : undefined;
  });
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
    return sessionID !== undefined && switchingIDs().has(sessionID);
  });
  const error = createMemo(() => {
    if (state() === "failed") return loadError();
    const sessionID = input.selectedSession()?.id;
    const failure = switchError();
    return sessionID !== undefined && failure?.sessionID === sessionID
      ? failure.message
      : undefined;
  });

  async function sync(): Promise<void> {
    if (inFlight) return inFlight;
    const run = (async () => {
      setState("loading");
      setLoadError(undefined);
      try {
        const location = input.defaultLocation;
        const [listed, fallback] = await Promise.all([
          input.api.model.list({ location }),
          input.api.model.default({ location }),
        ]);
        setCatalog(listed.data);
        setServerDefault(fallback.data ?? undefined);
        setState("ready");
      } catch (cause) {
        setCatalog([]);
        setServerDefault(undefined);
        setState("failed");
        setLoadError("Models could not be loaded. Check the connection and try again.");
        throw cause;
      } finally {
        inFlight = undefined;
      }
    })();
    inFlight = run;
    return run;
  }

  async function switchSelection(model: ModelRef, failureMessage: string): Promise<void> {
    const session = input.selectedSession();
    if (!session || switchingIDs().has(session.id)) return;

    setSwitchError(undefined);
    setSwitchingIDs((current) => new Set([...current, session.id]));
    try {
      try {
        await input.api.session.switchModel({ sessionID: session.id, model });
      } catch {
        setSwitchError({ sessionID: session.id, message: failureMessage });
        return;
      }

      try {
        await input.data.session.sync(session.id);
      } catch {
        setSwitchError({
          sessionID: session.id,
          message: "The selection changed, but its current value could not be refreshed.",
        });
      }
    } finally {
      setSwitchingIDs((current) => {
        const next = new Set(current);
        next.delete(session.id);
        return next;
      });
    }
  }

  return {
    state,
    error,
    switching,
    models: choices,
    selectedModelID,
    variants,
    selectedVariantID,
    sync,
    selectModel: async (choiceID) => {
      const model = models().find((candidate) => modelChoiceID(candidate) === choiceID);
      if (!model) return;
      await switchSelection(
        { id: model.id, providerID: model.providerID },
        "The model could not be changed. Try again.",
      );
    },
    selectVariant: async (variantID) => {
      const model = selectedModel();
      if (!model || !variants().some((variant) => variant.id === variantID)) return;
      await switchSelection(
        { id: model.id, providerID: model.providerID, variant: variantID },
        "The variant could not be changed. Try again.",
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
