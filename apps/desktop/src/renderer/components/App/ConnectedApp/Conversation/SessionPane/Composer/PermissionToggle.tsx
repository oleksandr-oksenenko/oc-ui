import { Icon } from "@opencode/ui/icon";
import { IconButton } from "@opencode/ui/icon-button";
import { Tooltip } from "@opencode/ui/tooltip";

export type PermissionToggleProps = {
  readonly enabled: boolean;
  readonly disabled?: boolean;
  readonly onChange: (enabled: boolean) => void;
};

export function PermissionToggle(props: { readonly control?: PermissionToggleProps }) {
  const enabled = () => props.control?.enabled ?? false;
  const label = () =>
    enabled()
      ? "Auto-approve is on · Click to ask for approval"
      : "Ask for approval · Click to auto-approve this session";
  return (
    <Tooltip value={label()}>
      <IconButton
        class="composer-permissions"
        type="button"
        size="small"
        variant="ghost-muted"
        aria-label="Auto-approve permissions"
        aria-pressed={enabled()}
        disabled={props.control === undefined || props.control.disabled}
        onClick={() => props.control?.onChange(!enabled())}
        icon={
          enabled() ? (
            <Icon name="shield" size="small" />
          ) : (
            // Match the pinned OpenCode shield outline, without its approval checkmark.
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                d="M9.99935 2.08203L17.0827 4.3737V9.92565C17.0827 14.0694 13.3327 16.2487 9.99935 18.047C6.66602 16.2487 2.91602 14.0694 2.91602 9.92565V4.3737L9.99935 2.08203Z"
                stroke="currentColor"
                stroke-linecap="square"
              />
            </svg>
          )
        }
      />
    </Tooltip>
  );
}
