import { IconBrain, IconChevronDown } from "@tabler/icons-solidjs";
import { Show, createSignal, type JSX } from "solid-js";

export type ReasoningBlockProps = {
  readonly summary: string;
  readonly label?: string;
  readonly duration?: string;
  readonly defaultOpen?: boolean;
};

export function ReasoningBlock(props: ReasoningBlockProps): JSX.Element {
  const [open, setOpen] = createSignal(props.defaultOpen ?? false);

  return (
    <section class="transcript-reasoning" data-expanded={open() ? "true" : "false"}>
      <button
        class="transcript-reasoning-toggle"
        type="button"
        aria-expanded={open()}
        onClick={() => setOpen((current) => !current)}
      >
        <IconBrain size={15} aria-hidden="true" />
        <span class="transcript-reasoning-label">{props.label ?? "Reasoning summary"}</span>
        <Show when={props.duration}>
          {(duration) => <span class="transcript-reasoning-duration">· {duration()}</span>}
        </Show>
        <IconChevronDown size={15} aria-hidden="true" />
      </button>
      <Show when={open()}>
        <p class="transcript-reasoning-summary">{props.summary}</p>
      </Show>
    </section>
  );
}
