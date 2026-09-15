/** The leading slash token of a draft, with or without a known command behind it. */
export function leadingCommandName(text: string): string | undefined {
  return /^\/(\S+)/.exec(text)?.[1];
}

export type SessionCommandInvocation = {
  readonly name: string;
  readonly arguments: string;
};

/**
 * Recognizes a command invocation only at the start of the draft. Command
 * names may contain slashes (nested command directories) or colons (MCP
 * prompts), so the whole first whitespace-delimited token is the name.
 */
export function parseSessionCommand(
  text: string,
  names: readonly string[],
): SessionCommandInvocation | undefined {
  const name = leadingCommandName(text);
  if (name === undefined || !names.includes(name)) return undefined;
  return { name, arguments: text.slice(name.length + 1).trim() };
}
