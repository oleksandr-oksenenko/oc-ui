import { Show } from "solid-js";
import { Button } from "@opencode/ui/button";
import type { WorkspaceModel } from "../createWorkspace.ts";
import { Composer } from "./SessionPane/Composer.tsx";
import { NewSessionScreen } from "./NewSessionScreen.tsx";

export type NewSessionDraftRegionProps = { readonly controller: WorkspaceModel["drafts"] };
export function NewSessionDraftRegion(props: NewSessionDraftRegionProps) {
  return (
    <Show when={props.controller.selectedID()} keyed>
      {(id) => (
        <NewSessionScreen
          setup={props.controller.setup()}
          status={props.controller.operationStatus()}
          composer={
            <Composer
              {...props.controller.composer(id)}
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
                  <Show
                    when={
                      props.controller.composer(id).error && !props.controller.selected()?.conflict
                    }
                  >
                    <Button size="small" variant="ghost-muted" onClick={props.controller.retry}>
                      Retry
                    </Button>
                  </Show>
                </div>
              }
            />
          }
        />
      )}
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
