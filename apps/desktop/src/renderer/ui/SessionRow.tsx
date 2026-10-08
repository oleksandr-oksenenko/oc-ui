import { Button } from "@opencode/ui/button";
import { Tooltip } from "@opencode/ui/tooltip";
import { createEffect, createSignal, type JSX } from "solid-js";
import "./SessionRow.css";

export type SessionRowProps = {
  readonly title: string;
  readonly subtitle: string;
  readonly label: string;
  readonly selected: boolean;
  readonly sidebarVisible?: boolean;
  readonly hasChildren?: boolean;
  readonly disclosure?: JSX.Element;
  readonly end?: JSX.Element;
  readonly onSelect: () => void;
};

export function SessionRow(props: SessionRowProps) {
  const [titleFocused, setTitleFocused] = createSignal(false);
  createEffect(() => {
    if (props.sidebarVisible === false) setTitleFocused(false);
  });
  return (
    <div
      class="shell-session-row"
      classList={{ selected: props.selected, "has-children": props.hasChildren }}
    >
      <span class="shell-session-disclosure-slot">{props.disclosure}</span>
      <Tooltip
        inactive={props.sidebarVisible === false}
        class="shell-session-title-tooltip-trigger"
        contentClass="shell-session-title-tooltip"
        appearance="standard"
        forceOpen={titleFocused() ? true : undefined}
        value={props.title}
      >
        <Button
          class="shell-session-main"
          type="button"
          size="small"
          variant="ghost-muted"
          aria-current={props.selected ? "page" : undefined}
          aria-label={props.label}
          aria-description={props.subtitle}
          onFocus={(event: FocusEvent & { currentTarget: HTMLButtonElement }) =>
            setTitleFocused(event.currentTarget.matches(":focus-visible"))
          }
          onBlur={() => setTitleFocused(false)}
          onPointerDown={() => setTitleFocused(false)}
          onKeyDown={(event: KeyboardEvent) => {
            setTitleFocused(event.key !== "Enter" && event.key !== " ");
          }}
          onClick={props.onSelect}
        >
          <span class="shell-session-title">{props.title}</span>
          <span class="shell-session-project">{props.subtitle}</span>
        </Button>
      </Tooltip>
      <span class="shell-session-row-end">{props.end}</span>
    </div>
  );
}
