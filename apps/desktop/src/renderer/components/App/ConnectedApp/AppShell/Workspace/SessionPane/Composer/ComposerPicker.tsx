import { IconChevronDown } from "@tabler/icons-solidjs";
import { For } from "solid-js";

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

/** A compact native selector that stays usable with keyboard and screen readers. */
export function ComposerPicker(props: ComposerPickerProps) {
  return (
    <label class="composer-picker">
      <span class="composer-picker-control">
        <select
          aria-label={props.label}
          value={props.value}
          disabled={props.disabled ?? false}
          onChange={(event) => props.onChange(event.currentTarget.value)}
        >
          <For each={props.options}>
            {(option) => <option value={option.value}>{option.label}</option>}
          </For>
        </select>
        <IconChevronDown
          class="composer-picker-chevron"
          aria-hidden="true"
          size={14}
          strokeWidth={1.8}
        />
      </span>
    </label>
  );
}
