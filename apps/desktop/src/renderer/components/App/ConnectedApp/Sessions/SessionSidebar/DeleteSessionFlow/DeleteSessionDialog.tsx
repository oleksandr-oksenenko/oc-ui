import { Button } from "@opencode-ai/ui/button";
import {
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitleGroup,
} from "@opencode-ai/ui/dialog";
import { useDialog } from "@opencode-ai/ui/context/dialog";
import { Icon } from "@opencode-ai/ui/icon";
import { Loader } from "@opencode-ai/ui/loader";
import { Show } from "solid-js";

import "./DeleteSessionDialog.css";

export type DeleteSessionDialogProps = {
  readonly title: string;
  readonly descendantCount: number;
  readonly deleting: boolean;
  readonly error?: string;
  readonly onDelete: () => void;
};

export function DeleteSessionDialog(props: DeleteSessionDialogProps) {
  const dialog = useDialog();

  const submit = (event: SubmitEvent): void => {
    event.preventDefault();
    if (!props.deleting) props.onDelete();
  };

  return (
    <Dialog fit containerClass="delete-session-dialog">
      <form aria-busy={props.deleting ? "true" : undefined} onSubmit={submit}>
        <DialogHeader closeLabel="Close delete session dialog" hideClose={props.deleting}>
          <DialogTitleGroup
            title="Delete session?"
            description={
              <>
                <strong>{props.title}</strong> will be permanently deleted.
              </>
            }
          />
        </DialogHeader>

        <DialogBody class="delete-session-dialog-body">
          <p>This cannot be undone.</p>
          <Show when={props.descendantCount > 0}>
            <p>
              This will also delete {props.descendantCount} child{" "}
              {props.descendantCount === 1 ? "session" : "sessions"}.
            </p>
          </Show>
          <p>
            Unused registered Git worktrees may also be permanently removed, including uncommitted
            changes.
          </p>
          <Show when={props.error}>
            {(error) => (
              <div class="delete-session-error" role="alert" tabIndex={-1}>
                <Icon name="warning" />
                <span>{error()}</span>
              </div>
            )}
          </Show>
        </DialogBody>

        <DialogFooter>
          <Show when={!props.deleting}>
            <Button
              type="button"
              size="normal"
              variant="outline"
              autofocus
              onClick={() => dialog.close()}
            >
              Cancel
            </Button>
          </Show>
          <Button
            type="submit"
            size="normal"
            variant={props.deleting ? "loading" : "danger"}
            disabled={props.deleting}
          >
            <Show when={props.deleting}>
              <Loader width={16} height={16} />
            </Show>
            {props.deleting ? "Deleting" : "Delete session"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
