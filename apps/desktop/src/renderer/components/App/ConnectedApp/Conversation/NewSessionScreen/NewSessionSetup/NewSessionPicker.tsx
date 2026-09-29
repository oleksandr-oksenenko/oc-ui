import "../../../../../../ui/SelectionList.css";
import { Popover as Kobalte } from "@kobalte/core/popover";
import { Popover } from "@opencode/ui/popover";
import { List } from "@opencode/ui/list";
import { Icon } from "@opencode/ui/icon";
import { Button } from "@opencode/ui/button";
import { Show, createEffect, createSignal } from "solid-js";
import type { ComponentProps } from "solid-js";

type Option = { readonly id: string; readonly label: string; readonly detail?: string };

type NewSessionPickerProps = {
  readonly label: string;
  readonly value: string;
  readonly icon: ComponentProps<typeof Icon>["name"];
  readonly options: readonly Option[];
  readonly selectedID?: string;
  readonly disabled?: boolean;
  readonly onSelect: (id: string) => void;
  readonly action?: { readonly label: string; readonly onClick: () => void };
};

export function NewSessionPicker(props: NewSessionPickerProps) {
  const [open, setOpen] = createSignal(false);
  createEffect(() => {
    if (props.disabled) setOpen(false);
  });
  return (
    <Popover
      open={open() && !props.disabled}
      onOpenChange={setOpen}
      placement="bottom-start"
      class="selection-popover"
      fitViewport
      triggerAs={Button}
      triggerProps={{
        type: "button",
        size: "small",
        variant: "ghost-muted",
        class: "new-session-setup-trigger oc-dropdown-trigger",
        disabled: props.disabled,
        "aria-label": `${props.label}: ${props.value}`,
      }}
      trigger={
        <>
          <Icon name={props.icon} size="small" />
          <span>{props.value}</span>
          <Icon name="chevron-down" size="small" />
        </>
      }
    >
      <Kobalte.Title class="sr-only">{props.label}</Kobalte.Title>
      <List
        class="selection-list"
        items={[...props.options]}
        key={(option) => option.id}
        current={props.options.find((option) => option.id === props.selectedID)}
        search={{ placeholder: `Search ${props.label.toLowerCase()}`, autofocus: true }}
        filterKeys={["label", "detail"]}
        emptyMessage="No matches."
        onSelect={(option) => {
          if (!option) return;
          props.onSelect(option.id);
          setOpen(false);
        }}
      >
        {(option) => (
          <span class="selection-option">
            <span>{option.label}</span>
            <Show when={option.detail}>
              <span class="selection-option-detail">{option.detail}</span>
            </Show>
          </span>
        )}
      </List>
      <Show when={props.action}>
        {(action) => (
          <Button
            class="selection-action"
            size="small"
            variant="ghost-muted"
            onClick={() => {
              setOpen(false);
              action().onClick();
            }}
          >
            <Icon name="plus-small" />
            {action().label}
          </Button>
        )}
      </Show>
    </Popover>
  );
}
