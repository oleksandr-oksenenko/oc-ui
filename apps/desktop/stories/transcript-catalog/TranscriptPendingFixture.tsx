import { Show, createSignal } from "solid-js";
import { PermissionRequestCard } from "../../src/renderer/ui/PermissionRequestCard.tsx";
import { QuestionForm } from "../../src/renderer/ui/QuestionForm.tsx";
import { workspaceQuestionForm } from "../question-form-fixtures.ts";

export function TranscriptPendingFixture(props: {
  readonly submitting?: boolean;
  readonly error?: string;
  /** Renders a descendant session group for the subagent bubbling layout. */
  readonly subagent?: boolean;
}) {
  const [permission, setPermission] = createSignal(true);
  const [question, setQuestion] = createSignal(true);
  const [subagentPermission, setSubagentPermission] = createSignal(true);
  const [subagentQuestion, setSubagentQuestion] = createSignal(true);
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
      <Show when={props.subagent && (subagentPermission() || subagentQuestion())}>
        <section
          class="transcript-pending-subagent"
          data-subagent-session-id="transcript-story-child"
        >
          <h3 class="transcript-pending-subagent-title">Subagent: Explore auth</h3>
          <Show when={subagentPermission()}>
            <PermissionRequestCard
              request={{
                id: "catalog-subagent-permission",
                sessionID: "transcript-story-child",
                action: "external_directory",
                resources: ["/reference/auth/*"],
              }}
              submitting={props.submitting}
              error={props.error}
              onReply={() => setSubagentPermission(false)}
            />
          </Show>
          <Show when={subagentQuestion()}>
            <QuestionForm
              form={{
                ...workspaceQuestionForm,
                id: "frm_subagent_scope",
                sessionID: "transcript-story-child",
                title: "Which auth flow should the subagent audit?",
              }}
              submitting={props.submitting}
              error={props.error}
              onSubmit={() => setSubagentQuestion(false)}
              onCancel={() => setSubagentQuestion(false)}
            />
          </Show>
        </section>
      </Show>
    </article>
  );
}
