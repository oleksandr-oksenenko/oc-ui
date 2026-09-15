/**
 * Context-window usage for the selected session.
 *
 * This is a last-reported-usage snapshot, not a live estimate. The server
 * reports token usage per assistant step; the most recent assistant step's
 * total is the best available measure of how full the model's context window
 * was for that request. Messages sent since the last report are not counted.
 */

type ContextUsageTokens = {
  readonly input: number;
  readonly output: number;
  readonly reasoning: number;
  readonly cache: { readonly read: number; readonly write: number };
};

export type ContextUsageMessage = {
  readonly type: string;
  readonly tokens?: ContextUsageTokens;
};

export type ContextUsage = {
  readonly used: number;
  readonly limit: number;
};

function tokenTotal(tokens: ContextUsageTokens): number {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write;
}

/** Total tokens reported by the most recent assistant step, if any. */
function latestContextTokens(messages: readonly ContextUsageMessage[]): number | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.type === "assistant" && message.tokens) return tokenTotal(message.tokens);
  }
  return undefined;
}

/**
 * Usage over a positive model context limit. Returns undefined when the limit
 * is unknown, which is the signal to hide the meter. A session with no reported
 * assistant usage yet reads as empty rather than unknown.
 */
export function contextUsage(
  messages: readonly ContextUsageMessage[],
  limit: number | undefined,
): ContextUsage | undefined {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) return undefined;
  const reported = latestContextTokens(messages);
  return { used: reported === undefined ? 0 : Math.max(reported, 0), limit };
}

/** Compact token counts for the meter tooltip, for example `12.3k` or `1.2M`. */
export function formatTokens(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude < 1_000) return String(Math.round(value));
  if (magnitude < 999_500) {
    const thousands = value / 1_000;
    return `${thousands.toFixed(magnitude < 10_000 ? 1 : 0)}k`;
  }
  return `${(value / 1_000_000).toFixed(1)}M`;
}
