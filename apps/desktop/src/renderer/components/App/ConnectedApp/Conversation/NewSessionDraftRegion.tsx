import { Show } from "solid-js";
import { Button } from "@opencode/ui/button";
import type { WorkspaceModel } from "../createWorkspace.ts";
import { Composer } from "./SessionPane/Composer.tsx";
import { NewSessionScreen } from "./NewSessionScreen.tsx";

export type NewSessionDraftRegionProps = { readonly controller: WorkspaceModel["drafts"] };
export function NewSessionDraftRegion(props: NewSessionDraftRegionProps) {
  return (
    <Show when={props.controller.selectedID()} keyed>
      {(id) => {
        const status = () => {
          const operation = props.controller.operationStatus();
          const error = props.controller.composer(id).error;
          return operation ?? (error ? { kind: "error" as const, message: error } : undefined);
        };
        return (
          <NewSessionScreen
            setup={props.controller.setup()}
            status={status()}
            onRetry={
              props.controller.composer(id).error && !props.controller.selected()?.conflict
                ? props.controller.retry
                : undefined
            }
            composer={
              <Composer
                {...props.controller.composer(id)}
                error=""
                actions={
                  <div class="composer-status">
                    {attemptActions(props.controller, id)}
                    <Show when={props.controller.selected()?.conflict}>
                      <div class="composer-status" role="alert">
                        <Button
                          size="small"
                          variant="outline"
                          disabled={props.controller.selected()?.busy}
                          onClick={() => props.controller.keepCopy(id)}
                        >
                          Keep as separate draft
                        </Button>
                        <Button
                          size="small"
                          variant="ghost-muted"
                          disabled={props.controller.selected()?.busy}
                          onClick={() => props.controller.loadSavedVersion(id)}
                        >
                          Use saved version
                        </Button>
                      </div>
                    </Show>
                  </div>
                }
              />
            }
          />
        );
      }}
    </Show>
  );
}

function attemptActions(controller: NewSessionDraftRegionProps["controller"], id: string) {
  const attempt = () => controller.selected()?.value.attempt;
  return (
    <>
      <Show when={attempt()?.result && attempt()?.phase === "creating" && !attempt()?.confirmed}>
        <Button
          size="small"
          variant="ghost-muted"
          disabled={controller.selected()?.busy}
          onClick={() => controller.checkSession(id)}
        >
          Check session
        </Button>
      </Show>
      <Show when={attempt()?.result && attempt()?.confirmed}>
        <Button size="small" variant="ghost-muted" onClick={() => controller.openSession(id)}>
          Open session
        </Button>
      </Show>
      <Show when={attempt()?.phase === "preparing" && attempt()?.result}>
        <Button
          size="small"
          variant="ghost-muted"
          disabled={controller.selected()?.busy}
          onClick={() => controller.editFailedDraft(id)}
        >
          Edit draft
        </Button>
      </Show>
      <Show when={attempt()?.result}>
        <Button
          size="small"
          variant="ghost-muted"
          disabled={controller.selected()?.busy}
          onClick={() => controller.keepCopy(id)}
        >
          Copy to edit
        </Button>
      </Show>
    </>
  );
}
