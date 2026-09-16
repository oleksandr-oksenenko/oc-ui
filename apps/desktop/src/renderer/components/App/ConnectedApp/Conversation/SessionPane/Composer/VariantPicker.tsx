import { Select } from "@opencode/ui/select";
import { createEffect } from "solid-js";

export type VariantPickerOption = {
  readonly id: string;
  readonly label: string;
};

type VariantPickerProps = {
  readonly placeholder: string;
  readonly unavailableLabel: string;
  readonly options: readonly VariantPickerOption[];
  readonly selectedID?: string;
  readonly disabled: boolean;
  readonly onSelect: (id: string) => void;
};

export function VariantPicker(props: VariantPickerProps) {
  let root: HTMLSpanElement | undefined;
  const selected = () => props.options.find((option) => option.id === props.selectedID);

  createEffect(() => {
    const trigger = root?.querySelector<HTMLElement>('[data-component="select-v2"]');
    trigger?.setAttribute("aria-label", `Variant: ${selected()?.label ?? props.placeholder}`);
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
          {props.unavailableLabel}
        </span>
      ) : (
        <Select
          aria-label={`Variant: ${selected()?.label ?? props.placeholder}`}
          class="composer-picker-control"
          options={[...props.options]}
          current={selected()}
          value={(option) => option.id}
          label={(option) => option.label}
          placeholder={props.placeholder}
          disabled={props.disabled}
          onSelect={(option) => {
            if (option) props.onSelect(option.id);
          }}
        />
      )}
    </span>
  );
}
