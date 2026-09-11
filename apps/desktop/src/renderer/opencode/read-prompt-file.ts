import { Effect, Predicate, Schema } from "effect";
import type { PromptInput } from "@opencode-ai/schema";

class PromptFileReadError extends Schema.TaggedError<PromptFileReadError>()("PromptFileReadError", {
  name: Schema.String,
}) {}

/** FileReader is abortable; its lifetime belongs to the submitting workspace. */
export const readPromptFile = (file: File) =>
  Effect.callback<PromptInput.FileAttachment, PromptFileReadError>((resume) => {
    const reader = new FileReader();
    const loaded = () => {
      if (!Predicate.isString(reader.result)) {
        resume(Effect.fail(new PromptFileReadError({ name: file.name })));
        return;
      }
      resume(Effect.succeed({ uri: reader.result, name: file.name || "Pasted file" }));
    };
    const failed = () => resume(Effect.fail(new PromptFileReadError({ name: file.name })));
    reader.addEventListener("load", loaded);
    reader.addEventListener("error", failed);
    reader.readAsDataURL(file);
    return Effect.sync(() => {
      reader.removeEventListener("load", loaded);
      reader.removeEventListener("error", failed);
      if (reader.readyState === FileReader.LOADING) reader.abort();
    });
  });
