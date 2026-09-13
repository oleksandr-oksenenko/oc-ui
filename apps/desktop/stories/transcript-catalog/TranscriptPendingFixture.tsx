import { Show, createSignal } from "solid-js";
import { PermissionRequestCard } from "../../src/renderer/ui/PermissionRequestCard.tsx";
import { QuestionForm } from "../../src/renderer/ui/QuestionForm.tsx";
import { workspaceQuestionForm } from "../question-form-fixtures.ts";

export function TranscriptPendingFixture(props: {
  readonly submitting?: boolean;
  readonly error?: string;
}) {
  const [permission, setPermission] = createSignal(true);
  const [question, setQuestion] = createSignal(true);
  return (
    <article
      class="transcript-message transcript-assistant-message transcript-pending-interaction"
      data-message-id="catalog-pending"
    >
      <Show when={permission()}>
        <PermissionRequestCard
          request={{
            id: "catalog-permission",
            sessionID: "transcript-story",
            action: "run command",
            resources: ["pnpm check"],
            save: ["pnpm check"],
          }}
          submitting={props.submitting}
          error={props.error}
          onReply={() => setPermission(false)}
        />
      </Show>
      <Show when={question()}>
        <QuestionForm
          form={workspaceQuestionForm}
          submitting={props.submitting}
          error={props.error}
          onSubmit={() => setQuestion(false)}
          onCancel={() => setQuestion(false)}
        />
      </Show>
    </article>
  );
}
