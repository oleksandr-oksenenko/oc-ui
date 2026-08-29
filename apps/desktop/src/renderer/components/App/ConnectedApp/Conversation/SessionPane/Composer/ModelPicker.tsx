import { Icon } from "@opencode-ai/ui/icon";
import { List } from "@opencode-ai/ui/list";
import { Popover } from "@opencode-ai/ui/popover";
import { createSignal } from "solid-js";

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
  const [open, setOpen] = createSignal(false);
  const selected = () => props.options.find((option) => option.id === props.selectedID);

  const select = (option: ModelPickerOption | undefined) => {
    if (!option) return;
    props.onSelect(option.id);
    setOpen(false);
  };

  return (
    <span class="composer-picker">
      {props.options.length === 0 ? (
        <span class="composer-picker--unavailable" aria-disabled="true">
          No models
        </span>
      ) : (
        <Popover
          open={open()}
          onOpenChange={setOpen}
          placement="top-start"
          fitViewport
          class="composer-model-popover"
          triggerAs="button"
          triggerProps={{
            type: "button",
            disabled: props.disabled,
            class: "composer-model-trigger",
            "aria-label": "Model",
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
