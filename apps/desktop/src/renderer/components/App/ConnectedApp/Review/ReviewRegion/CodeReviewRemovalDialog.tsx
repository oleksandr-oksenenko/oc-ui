import { Button } from "@opencode/ui/button";
import { useDialog } from "@opencode/ui/context/dialog";
import {
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitleGroup,
} from "@opencode/ui/dialog";

import "./CodeReviewRemovalDialog.css";

export type CodeReviewRemovalDialogProps = {
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly onConfirm: () => void;
};

export function CodeReviewRemovalDialog(props: CodeReviewRemovalDialogProps) {
  const dialog = useDialog();

  const confirm = (event: SubmitEvent): void => {
    event.preventDefault();
    props.onConfirm();
    dialog.close();
  };

  return (
    <Dialog fit containerClass="code-review-removal-dialog">
      <form onSubmit={confirm}>
        <DialogHeader closeLabel="Close confirmation dialog">
          <DialogTitleGroup title={props.title} description={props.description} />
        </DialogHeader>
        <DialogBody class="code-review-removal-dialog-body">
          <p>This cannot be undone.</p>
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            size="normal"
            variant="ghost"
            autofocus
            onClick={() => dialog.close()}
          >
            Keep
          </Button>
          <Button type="submit" size="normal" variant="danger">
            {props.confirmLabel}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
