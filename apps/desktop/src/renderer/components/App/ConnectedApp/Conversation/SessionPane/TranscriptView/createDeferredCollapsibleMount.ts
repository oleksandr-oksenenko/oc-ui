import { createSignal } from "solid-js";

type DeferredCollapsibleMount = {
  /** Whether the disclosure content should be mounted. */
  readonly mount: () => boolean;
  /** Pass to `Collapsible`; latches after the first expansion. */
  readonly onOpenChange: (open: boolean) => void;
};

/**
 * Keeps a disclosure's content unmounted until it first expands. Kobalte
 * registers an animation frame on `Collapsible.Content` mount even while
 * closed, so a long transcript with hundreds of collapsed tool calls and
 * reasoning blocks schedules hundreds of frames for content the user never
 * opened.
 *
 * Call this in the same component that renders `Collapsible`, pass
 * `onOpenChange` to the root, and gate the upstream `Collapsible.Content` with
 * `<Show when={mount()}>`. The upstream component mounts on first expansion and
 * stays mounted afterwards, so close/reopen, `aria-controls` registration and
 * the `collapsible-content` selector keep their normal lifecycle.
 */
export function createDeferredCollapsibleMount(defaultOpen = false): DeferredCollapsibleMount {
  const [mount, setMount] = createSignal(defaultOpen);

  return {
    mount,
    onOpenChange: (open) => {
      if (open) setMount(true);
    },
  };
}
