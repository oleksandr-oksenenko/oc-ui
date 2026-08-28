import { Select } from "@opencode-ai/ui/select";

export type ComposerPickerOption = {
  readonly id: string;
  readonly label: string;
  readonly group?: string;
};

type ComposerPickerProps = {
  readonly label: string;
  readonly placeholder: string;
  readonly unavailableLabel: string;
  readonly options: readonly ComposerPickerOption[];
  readonly selectedID?: string;
  readonly disabled: boolean;
  readonly onSelect: (id: string) => void;
};

export function ComposerPicker(props: ComposerPickerProps) {
  const selected = () => props.options.find((option) => option.id === props.selectedID);

  return (
    <span class="composer-picker">
      {props.options.length === 0 ? (
        <span class="composer-picker--unavailable" aria-disabled="true">
          {props.unavailableLabel}
        </span>
      ) : (
        <Select
          aria-label={props.label}
          class="composer-picker-control"
          options={[...props.options]}
          current={selected()}
          value={(option) => option.id}
          label={(option) => option.label}
          groupBy={(option) => option.group ?? ""}
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
