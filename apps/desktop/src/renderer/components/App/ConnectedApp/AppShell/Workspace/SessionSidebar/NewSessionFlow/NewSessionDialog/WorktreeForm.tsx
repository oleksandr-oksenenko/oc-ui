import { Field } from "@opencode-ai/ui/field";
import { TextInput } from "@opencode-ai/ui/text-input";
import { Show } from "solid-js";

import type { LocationRef, OpenCodeClient } from "@opencode-ai/client";

import { ServerDirectoryBrowser } from "../../../../../../../../ui/ServerDirectoryBrowser.tsx";
import type { NewSessionDialogState } from "../NewSessionDialog.tsx";

type WorktreeState = Extract<NewSessionDialogState, { view: "worktree" }>;

export type WorktreeFormProps = {
  readonly listDirectory: OpenCodeClient["file"]["list"];
  readonly state: WorktreeState;
  readonly disabled: boolean;
  readonly parentValidationError?: string;
  readonly nameValidationError?: string;
  readonly onBrowserReady: (element: HTMLElement) => void;
  readonly onBrowserLoadingChange: (loading: boolean) => void;
  readonly onNameReady: (element: HTMLInputElement) => void;
  readonly onParentChange: (location: LocationRef) => void;
  readonly onNameChange: (name: string) => void;
};

export function WorktreeForm(props: WorktreeFormProps) {
  return (
    <section class="new-session-worktree-form">
      <div class="new-session-source">
        <span>Project</span>
        <strong>{props.state.project.name}</strong>
        <code>{props.state.project.location.directory}</code>
      </div>
      <ServerDirectoryBrowser
        listDirectory={props.listDirectory}
        label="Worktree parent directory"
        initialLocation={props.state.project.location}
        initialPath=".."
        disabled={props.disabled}
        validationError={props.parentValidationError}
        onBrowserReady={props.onBrowserReady}
        onLoadingChange={props.onBrowserLoadingChange}
        onDirectoryChange={props.onParentChange}
      />
      <Field invalid={props.nameValidationError !== undefined}>
        <Field.Label>Folder name</Field.Label>
        <Field.Control>
          <TextInput
            ref={(element) => props.onNameReady(element)}
            appearance="large"
            autocomplete="off"
            disabled={props.disabled}
            invalid={props.nameValidationError !== undefined}
            required
            spellcheck={false}
            value={props.state.folderName}
            onInput={(event) => props.onNameChange(event.currentTarget.value)}
          />
        </Field.Control>
        <Show when={props.nameValidationError}>
          {(message) => (
            <Field.Suffix class="new-session-field-error" role="alert">
              {message()}
            </Field.Suffix>
          )}
        </Show>
      </Field>
      <div class="new-session-path-preview" aria-live="polite">
        <span>Final worktree path</span>
        <strong>{props.state.finalDirectory}</strong>
      </div>
    </section>
  );
}
