import type { PromptSkillAttachment } from "@opencode/client";
import { createSignal, Show } from "solid-js";

import { Composer } from "../../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/Composer.tsx";
import { fromDraft, toDraft } from "@oc-ui/prompt-editor";
import {
  composerAgentSelection,
  composerModelSelection,
  composerPasteProps,
} from "../composer-fixtures.ts";
import "./markdown-behavior.css";

/**
 * Shows the editor next to the exact draft text and skill attachments the
 * model would receive, so each Markdown behavior has a visible example. The
 * seed is canonicalized the same way the editor would emit it, because a
 * freshly mounted editor reports no change.
 */
export function MarkdownBehavior(props: {
  readonly note: string;
  readonly initialValue?: string;
  readonly initialSkills?: readonly PromptSkillAttachment[];
}) {
  const initial = toDraft(fromDraft(props.initialValue ?? "", props.initialSkills ?? []));
  const [value, setValue] = createSignal(initial.text);
  const [skills, setSkills] = createSignal<readonly PromptSkillAttachment[]>(initial.skills);
  return (
    <div class="markdown-story-frame">
      <p class="markdown-story-note">{props.note}</p>
      <Composer
        {...composerPasteProps}
        value={value()}
        skills={skills()}
        action="send"
        disabled={false}
        modelSelection={composerModelSelection()}
        agentSelection={composerAgentSelection()}
        onInput={(text, attachments = []) => {
          setValue(text);
          setSkills(attachments);
        }}
        onSubmit={() => undefined}
      />
      <section class="markdown-story-draft" aria-label="Draft preview">
        <h3>Draft the model receives</h3>
        <pre data-testid="markdown-draft" data-draft={value()}>
          {value()}
        </pre>
      </section>
      <Show when={skills().length > 0}>
        <p class="markdown-story-attachments" data-testid="markdown-attachments">
          Skills:{" "}
          {skills()
            .map((skill) => `${skill.name}@${skill.mention?.start ?? "?"}`)
            .join(", ")}
        </p>
      </Show>
    </div>
  );
}
