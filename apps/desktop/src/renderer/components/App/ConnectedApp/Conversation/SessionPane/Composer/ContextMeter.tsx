import { Tooltip } from "@opencode-ai/ui/tooltip";
import { Show } from "solid-js";

import { formatTokens, type ContextUsage } from "./context-usage.ts";

type ContextMeterProps = {
  readonly usage: ContextUsage;
};

const SIZE = 14;
const STROKE = 2;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const CENTER = SIZE / 2;
const WARNING_RATIO = 0.8;
const DANGER_RATIO = 0.95;

function contextLevel(ratio: number): "normal" | "warning" | "danger" {
  if (ratio >= DANGER_RATIO) return "danger";
  if (ratio >= WARNING_RATIO) return "warning";
  return "normal";
}

/**
 * A small ring that fills clockwise as the model's context window is used.
 * The ratio is derived here from `used`/`limit`, and exposed on the DOM so
 * hosts and tests can read the fill without inspecting the SVG.
 */
export function ContextMeter(props: ContextMeterProps) {
  const ratio = () => {
    if (props.usage.limit <= 0) return 0;
    return Math.min(Math.max(props.usage.used / props.usage.limit, 0), 1);
  };
  const percentage = () => Math.round(ratio() * 100);
  const dashOffset = () => CIRCUMFERENCE * (1 - ratio());
  const summary = () =>
    `Context ${percentage()}% used · ${formatTokens(props.usage.used)} of ${formatTokens(
      props.usage.limit,
    )} tokens`;

  return (
    <Tooltip class="composer-context" value={summary()} triggerTabIndex={0}>
      <span
        class="composer-context-meter"
        role="img"
        data-level={contextLevel(ratio())}
        data-context-percentage={percentage()}
        aria-label={summary()}
      >
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} aria-hidden="true">
          <circle
            class="composer-context-track"
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill="none"
            stroke-width={STROKE}
          />
          <Show when={ratio() > 0}>
            <circle
              class="composer-context-fill"
              cx={CENTER}
              cy={CENTER}
              r={RADIUS}
              fill="none"
              stroke-width={STROKE}
              stroke-linecap="round"
              stroke-dasharray={`${CIRCUMFERENCE} ${CIRCUMFERENCE}`}
              stroke-dashoffset={dashOffset()}
              transform={`rotate(-90 ${CENTER} ${CENTER})`}
            />
          </Show>
        </svg>
      </span>
    </Tooltip>
  );
}
