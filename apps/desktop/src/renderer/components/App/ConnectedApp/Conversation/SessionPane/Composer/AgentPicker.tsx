import { Select } from "@opencode-ai/ui/select";
import { createEffect, createSignal } from "solid-js";

export type AgentPickerOption = {
  readonly id: string;
  readonly label: string;
};

type AgentPickerProps = {
  readonly placeholder: string;
  readonly unavailableLabel: string;
  readonly options: readonly AgentPickerOption[];
  readonly selectedID?: string;
  readonly disabled: boolean;
  readonly onSelect: (id: string) => void;
};

export function AgentPicker(props: AgentPickerProps) {
  let root: HTMLSpanElement | undefined;
  const [restoreFocusWhenEnabled, setRestoreFocusWhenEnabled] = createSignal(false);
  const focusTrigger = () =>
    root?.querySelector<HTMLElement>('[data-component="select-v2"]')?.focus();
  const selected = () => props.options.find((option) => option.id === props.selectedID);
  const currentPlaceholder = () =>
    props.selectedID === undefined || selected() === undefined
      ? props.selectedID === undefined
        ? props.placeholder
        : props.unavailableLabel
      : props.placeholder;

  createEffect(() => {
    if (props.disabled || !restoreFocusWhenEnabled()) return;
    setRestoreFocusWhenEnabled(false);
    queueMicrotask(focusTrigger);
  });

  createEffect(() => {
    const trigger = root?.querySelector<HTMLElement>('[data-component="select-v2"]');
    trigger?.setAttribute("aria-label", `Agent: ${selected()?.label ?? currentPlaceholder()}`);
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
          aria-label={`Agent: ${selected()?.label ?? currentPlaceholder()}`}
          class="composer-picker-control"
          options={[...props.options]}
          current={selected()}
          value={(option) => option.id}
          label={(option) => option.label}
          placeholder={currentPlaceholder()}
          disabled={props.disabled}
          onOpenChange={(open) => {
            if (open) return;
            queueMicrotask(() => {
              if (props.disabled) {
                setRestoreFocusWhenEnabled(true);
                return;
              }
              setRestoreFocusWhenEnabled(false);
              focusTrigger();
            });
          }}
          onSelect={(option) => {
            if (!option) return;
            props.onSelect(option.id);
            setRestoreFocusWhenEnabled(true);
          }}
        />
      )}
    </span>
  );
}
