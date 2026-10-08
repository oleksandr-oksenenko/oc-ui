import { onCleanup, onMount, type JSX } from "solid-js";

/** The query's Show owns presence; the browser owns top-layer placement. */
export function SuggestionPopover(props: { readonly children: JSX.Element }) {
  let menu: HTMLElement | undefined;
  onMount(() => menu?.showPopover());
  onCleanup(() => menu?.hidePopover());
  return (
    <section
      ref={(element) => {
        menu = element;
      }}
      class="prompt-suggestion-menu"
      aria-label="Suggestions"
      popover="manual"
    >
      {props.children}
    </section>
  );
}
