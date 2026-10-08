import "../../../../../../ui/SelectionList.css";
import { Icon } from "@opencode/ui/icon";
import { List } from "@opencode/ui/list";
import { Popover } from "@opencode/ui/popover";
import { createEffect, createMemo, createSignal } from "solid-js";

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
  const [restoreFocusWhenEnabled, setRestoreFocusWhenEnabled] = createSignal(false);
  // Upstream List identifies the current option by object identity.
  const options = createMemo(() => props.options);
  const selected = () => options().find((option) => option.id === props.selectedID);

  const select = (option: ModelPickerOption | undefined) => {
    if (!option) return;
    props.onSelect(option.id);
    setOpen(false);
    // The popover cannot restore focus while a server-backed switch disables its trigger.
    setRestoreFocusWhenEnabled(props.disabled);
  };

  createEffect(() => {
    if (props.disabled || open() || !restoreFocusWhenEnabled()) return;
    setRestoreFocusWhenEnabled(false);
    queueMicrotask(() =>
      root?.querySelector<HTMLButtonElement>(".composer-model-trigger")?.focus(),
    );
  });

  createEffect(() => {
    if (props.disabled || options().length === 0) {
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
      {options().length === 0 ? (
        <span class="composer-picker--unavailable" aria-disabled="true">
          {props.selectedID === undefined ? "No models" : "Model unavailable"}
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
          class="composer-model-popover selection-popover"
          triggerAs="button"
          triggerProps={{
            type: "button",
            disabled: props.disabled,
            class: "composer-model-trigger oc-dropdown-trigger",
            "aria-label": `Model: ${selected()?.label ?? (props.selectedID === undefined ? "Select model" : "Model unavailable")}`,
          }}
          trigger={
            <>
              <span>
                {selected()?.label ??
                  (props.selectedID === undefined ? "Select model" : "Model unavailable")}
              </span>
              <Icon name="chevron-down" size="small" />
            </>
          }
        >
          <List
            class="composer-model-list selection-list"
            search={{ placeholder: "Search models", autofocus: true }}
            emptyMessage="No matching models."
            items={[...options()]}
            key={(option) => option.id}
            current={selected()}
            filterKeys={["label", "group"]}
            groupBy={(option) => option.group ?? ""}
            sortBy={(left, right) => left.label.localeCompare(right.label)}
            onSelect={select}
          >
            {(option) => <span class="composer-model-option selection-option">{option.label}</span>}
          </List>
        </Popover>
      )}
    </span>
  );
}
