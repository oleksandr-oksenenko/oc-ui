import { Icon } from "@opencode-ai/ui/icon";
import { List } from "@opencode-ai/ui/list";
import { Popover } from "@opencode-ai/ui/popover";
import { createEffect, createSignal } from "solid-js";

export type ModelPickerOption = {
  readonly id: string;
  readonly label: string;
  readonly group?: string;
};

type ModelPickerProps = {
  readonly options: readonly ModelPickerOption[];
  readonly selectedID?: string;
  readonly disabled: boolean;
  readonly onSelect: (id: string) => void;
};

export function ModelPicker(props: ModelPickerProps) {
  let root: HTMLSpanElement | undefined;
  const [open, setOpen] = createSignal(false);
  const selected = () => props.options.find((option) => option.id === props.selectedID);

  const select = (option: ModelPickerOption | undefined) => {
    if (!option) return;
    props.onSelect(option.id);
    setOpen(false);
  };

  createEffect(() => {
    if (props.disabled || props.options.length === 0) {
      setOpen(false);
      return;
    }
    if (!open()) return;
    queueMicrotask(() => {
      if (props.disabled || !open()) return;
      const contentID = root
        ?.querySelector<HTMLElement>("[aria-controls]")
        ?.getAttribute("aria-controls");
      if (contentID) document.getElementById(contentID)?.setAttribute("aria-label", "Models");
    });
  });

  return (
    <span
      ref={(element) => {
        root = element;
      }}
      class="composer-picker"
    >
      {props.options.length === 0 ? (
        <span class="composer-picker--unavailable" aria-disabled="true">
          No models
        </span>
      ) : (
        <Popover
          open={open()}
          onOpenChange={(next) => {
            if (props.disabled) {
              setOpen(false);
              return;
            }
            setOpen(next);
          }}
          placement="top-start"
          fitViewport
          class="composer-model-popover"
          triggerAs="button"
          triggerProps={{
            type: "button",
            disabled: props.disabled,
            class: "composer-model-trigger oc-dropdown-trigger",
            "aria-label": `Model: ${selected()?.label ?? "Select model"}`,
          }}
          trigger={
            <>
              <span>{selected()?.label ?? "Select model"}</span>
              <Icon name="chevron-down" size="small" />
            </>
          }
        >
          <List
            class="composer-model-list"
            search={{ placeholder: "Search models", autofocus: true }}
            emptyMessage="No matching models."
            items={[...props.options]}
            key={(option) => option.id}
            current={selected()}
            filterKeys={["label", "group"]}
            groupBy={(option) => option.group ?? ""}
            sortBy={(left, right) => left.label.localeCompare(right.label)}
            onSelect={select}
          >
            {(option) => <span class="composer-model-option">{option.label}</span>}
          </List>
        </Popover>
      )}
    </span>
  );
}
