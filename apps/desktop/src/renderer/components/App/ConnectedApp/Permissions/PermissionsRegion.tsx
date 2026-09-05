import { Badge } from "@opencode-ai/ui/badge";
import { Button } from "@opencode-ai/ui/button";
import { useDialog } from "@opencode-ai/ui/context/dialog";
import { Icon } from "@opencode-ai/ui/icon";
import { Loader } from "@opencode-ai/ui/loader";
import { Show, createMemo, onCleanup, type Accessor, type JSX } from "solid-js";

import { restoreDialogFocusAfterClose } from "../../../../ui/restoreDialogFocusAfterClose.ts";
import type { PermissionsController } from "./createPermissions.ts";
import { PermissionsDialog } from "./PermissionsDialog.tsx";

import "./PermissionsRegion.css";

export type PermissionsRegionProps = {
  readonly controller: PermissionsController;
  readonly connected: Accessor<boolean>;
  readonly onOpenSession: (sessionID: string) => void;
};

/** Owns the workspace permission launcher and management dialog. */
export function PermissionsRegion(props: PermissionsRegionProps): JSX.Element {
  const dialog = useDialog();
  let launcher: HTMLButtonElement | undefined;
  let ownedDialogID: string | undefined;
  let opening = false;
  let disposed = false;
  const count = createMemo(() =>
    props.controller.inbox.entries().reduce((total, entry) => total + entry.requests.length, 0),
  );
  const countLabel = () => `${count()} pending permission request${count() === 1 ? "" : "s"}`;
  const stateLabel = () => {
    if (!props.connected()) return `${countLabel()}, cached, disconnected`;
    if (props.controller.inbox.state() === "loading") return `${countLabel()}, loading`;
    if (props.controller.inbox.state() === "failed") return `${countLabel()}, unavailable`;
    return countLabel();
  };

  onCleanup(() => {
    disposed = true;
    if (ownedDialogID && dialog.active?.id === ownedDialogID) dialog.close();
  });

  const open = (): void => {
    if (opening || (ownedDialogID && dialog.active?.id === ownedDialogID)) return;
    opening = true;
    void props.controller.inbox.sync();
    void props.controller.saved.sync();
    void dialog
      .push(
        () => (
          <PermissionsDialog
            controller={props.controller}
            connected={props.connected}
            onOpenSession={(sessionID) => {
              dialog.close();
              props.onOpenSession(sessionID);
            }}
          />
        ),
        () => {
          ownedDialogID = undefined;
          restoreDialogFocusAfterClose(() => launcher);
        },
      )
      .then(() => {
        opening = false;
        ownedDialogID = dialog.active?.id;
        if (disposed && ownedDialogID) dialog.close();
        return undefined;
      });
  };

  return (
    <div class="permissions-region">
      <Button
        ref={(element: HTMLButtonElement) => {
          launcher = element;
        }}
        class="permissions-region-launcher"
        type="button"
        size="normal"
        variant="ghost-muted"
        icon="shield"
        aria-label={`Permissions, ${stateLabel()}`}
        title={`Permissions · ${stateLabel()}`}
        onClick={open}
      >
        <Badge appearance="compact" variant={count() > 0 ? "accent" : "neutral"}>
          {props.connected() && count() === 0
            ? props.controller.inbox.state() === "loading"
              ? "…"
              : props.controller.inbox.state() === "failed"
                ? "?"
                : count()
            : count()}
        </Badge>
        <Show when={!props.connected()}>
          <span class="permissions-region-status disconnected" aria-hidden="true" />
        </Show>
        <Show when={props.connected() && props.controller.inbox.state() === "loading"}>
          <Loader class="permissions-region-status" width={10} height={10} aria-hidden="true" />
        </Show>
        <Show when={props.connected() && props.controller.inbox.state() === "failed"}>
          <Icon
            class="permissions-region-status failed"
            name="warning"
            size="small"
            aria-hidden="true"
          />
        </Show>
      </Button>
      <span class="sr-only" aria-live="polite">
        {`Permissions, ${stateLabel()}`}
      </span>
    </div>
  );
}
