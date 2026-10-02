import "../../../../../../ui/SelectionList.css";
import { Popover as Kobalte } from "@kobalte/core/popover";
import { Popover } from "@opencode/ui/popover";
import { List, type ListRef } from "@opencode/ui/list";
import { Icon } from "@opencode/ui/icon";
import { Button } from "@opencode/ui/button";
import { For, Show, createEffect, createSignal } from "solid-js";
import type { ComponentProps } from "solid-js";

type Option = {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  readonly disabled?: boolean;
};

type NewSessionPickerProps = {
  readonly label: string;
  readonly value: string;
  readonly icon: ComponentProps<typeof Icon>["name"];
  readonly options: readonly Option[];
  readonly selectedID?: string;
  readonly disabled?: boolean;
  readonly onSelect: (id: string) => void;
  readonly actions?: readonly {
    readonly label: string;
    readonly icon?: ComponentProps<typeof Icon>["name"];
    readonly onClick: () => void;
  }[];
};

export function NewSessionPicker(props: NewSessionPickerProps) {
  const [open, setOpen] = createSignal(false);
  const rows = new WeakMap<Option, HTMLButtonElement>();
  let list: ListRef | undefined;
  let direction = "ArrowDown";
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
        ref={(ref) => (list = ref)}
        class="selection-list"
        items={[...props.options]}
        key={(option) => option.id}
        current={props.options.find((option) => option.id === props.selectedID)}
        search={{ placeholder: `Search ${props.label.toLowerCase()}`, autofocus: true }}
        filterKeys={["label", "detail"]}
        emptyMessage="No matches."
        onKeyEvent={(event) => {
          if (event.key === "ArrowUp" || (event.ctrlKey && event.key === "p"))
            direction = "ArrowUp";
          if (event.key === "ArrowDown" || (event.ctrlKey && event.key === "n"))
            direction = "ArrowDown";
        }}
        onMove={(option) => {
          if (!option?.disabled) return;
          // Keep upstream filtering/navigation, but only advance if this filtered list has a usable row.
          const container = rows.get(option)?.closest('[data-component="list"]');
          if (!container?.querySelector('[data-slot="list-item"]:not(:disabled)')) return;
          list?.onKeyDown(new KeyboardEvent("keydown", { key: direction }));
        }}
        itemWrapper={(option, node) => {
          if (node instanceof HTMLButtonElement) {
            rows.set(option, node);
            createEffect(() => {
              node.disabled = option.disabled === true;
              node.title = option.disabled
                ? `Unavailable ${props.label.toLowerCase()}: ${option.detail ?? option.label}`
                : "";
            });
          }
          return node;
        }}
        onSelect={(option) => {
          if (!option || option.disabled) return;
          props.onSelect(option.id);
          setOpen(false);
        }}
      >
        {(option) => (
          <span class="selection-option">
            <span class="selection-option-label">
              <span class="selection-option-name">{option.label}</span>
              <Show when={option.disabled}>
                <Icon name="warning" size="small" />
                <span class="sr-only">Unavailable</span>
              </Show>
            </span>
            <Show when={option.detail}>
              <span class="selection-option-detail">{option.detail}</span>
            </Show>
          </span>
        )}
      </List>
      <For each={props.actions}>
        {(action) => (
          <Button
            class="selection-action"
            size="small"
            variant="ghost-muted"
            onClick={() => {
              setOpen(false);
              action.onClick();
            }}
          >
            <Icon name={action.icon ?? "plus-small"} />
            {action.label}
          </Button>
        )}
      </For>
    </Popover>
  );
}
