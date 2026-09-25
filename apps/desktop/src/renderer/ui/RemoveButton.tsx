import { Icon } from "@opencode/ui/icon";
import { IconButton } from "@opencode/ui/icon-button";
import type { ComponentProps } from "solid-js";
import "./RemoveButton.css";

type RemoveButtonProps = Pick<
  ComponentProps<"button">,
  "class" | "disabled" | "onMouseDown" | "title"
> & {
  readonly label: string;
  readonly onClick: NonNullable<ComponentProps<"button">["onClick"]>;
};

export function RemoveButton(props: RemoveButtonProps) {
  return (
    <IconButton
      class={props.class}
      type="button"
      size="small"
      variant="ghost-muted"
      data-remove-button
      aria-label={props.label}
      title={props.title}
      disabled={props.disabled}
      icon={<Icon name="close" aria-hidden="true" />}
      onMouseDown={props.onMouseDown}
      onClick={props.onClick}
    />
  );
}
