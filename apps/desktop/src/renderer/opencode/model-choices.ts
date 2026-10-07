import type { ModelInfo, ModelRef } from "@opencode/client";

export function modelChoiceID(model: Pick<ModelInfo, "id" | "providerID">): string {
  return JSON.stringify([model.providerID, model.id]);
}

export function resolveModel(models: readonly ModelInfo[], reference: ModelRef | undefined) {
  return reference
    ? models.find(
        (model) =>
          model.enabled && model.id === reference.id && model.providerID === reference.providerID,
      )
    : undefined;
}

export function modelChoices(models: readonly ModelInfo[]) {
  return models.map((model) => ({
    id: modelChoiceID(model),
    label: model.name,
    group: model.providerID,
  }));
}

export function variantChoices(model: ModelInfo | undefined) {
  return model?.variants.map((variant) => ({ id: variant.id, label: variant.id })) ?? [];
}

export function modelVariantAvailable(model: ModelInfo, variant: string | undefined): boolean {
  return !variant || variant === "default" || model.variants.some((item) => item.id === variant);
}
