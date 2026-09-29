import { Effect, Schema } from "effect";
import type { PromptSkillAttachment, SessionInboxDelivery } from "@opencode/client";
import type { ConnectedRuntime } from "./runtime.ts";
import type { WorkspaceOwner } from "../workspace-owner.ts";
import { readPromptFile } from "./read-prompt-file.ts";
import type { createSessionPrompt } from "./session-prompt.ts";

export class SessionAttachmentError extends Schema.TaggedError<SessionAttachmentError>()(
  "SessionAttachmentError",
  { name: Schema.String },
) {}
export type SessionInput = {
  readonly sessionID: string;
  readonly files: readonly File[];
  readonly delivery: SessionInboxDelivery;
} & (
  | {
      readonly kind: "prompt";
      readonly id: string;
      readonly prompt: ReturnType<typeof createSessionPrompt>;
    }
  | {
      readonly kind: "command";
      readonly name: string;
      readonly arguments: string;
      readonly skills: readonly PromptSkillAttachment[];
    }
);
type SubmissionRuntime = {
  readonly data: { readonly session: Pick<ConnectedRuntime["data"]["session"], "prompt"> };
  readonly api: { readonly session: Pick<ConnectedRuntime["api"]["session"], "command"> };
};

/** Captured input and an explicit destination; SDK owns admission and ordering. */
export const submitSessionInput = Effect.fn("submitSessionInput")(function* <E = never>(
  effects: WorkspaceOwner,
  runtime: SubmissionRuntime,
  input: SessionInput,
  beforeDispatch: Effect.Effect<unknown, E> = Effect.void,
) {
  const encoded = yield* Effect.forEach(input.files, readPromptFile).pipe(
    Effect.mapError((error) => new SessionAttachmentError({ name: error.name })),
  );
  yield* beforeDispatch;
  const files = encoded.length ? encoded : undefined;
  if (input.kind === "prompt") {
    yield* effects.request(() =>
      runtime.data.session.prompt({
        sessionID: input.sessionID,
        id: input.id,
        delivery: input.delivery,
        ...input.prompt,
        files,
      }),
    );
  } else {
    yield* effects.request((signal) =>
      runtime.api.session.command(
        {
          sessionID: input.sessionID,
          command: input.name,
          text: input.arguments,
          skills: input.skills.length ? input.skills.map(({ id }) => ({ id })) : undefined,
          delivery: input.delivery,
          files,
        },
        { signal },
      ),
    );
  }
});
