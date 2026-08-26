import { Select } from "@opencode-ai/ui/select";

type ComposerPickerOption = {
  readonly value: string;
  readonly label: string;
};

export type ComposerPickerProps = {
  readonly label: string;
  readonly value: string;
  readonly options: readonly ComposerPickerOption[];
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
};

/** A compact selector that stays usable with keyboard and screen readers. */
export function ComposerPicker(props: ComposerPickerProps) {
  return (
    <div class="composer-picker">
      <Select
        class="composer-picker-control"
        aria-label={props.label}
        options={[...props.options]}
        current={props.options.find((option) => option.value === props.value)}
        value={(option) => option.value}
        label={(option) => option.label}
        disabled={props.disabled ?? false}
        onSelect={(option) => {
          if (option) props.onChange(option.value);
        }}
      />
    </div>
  );
}
