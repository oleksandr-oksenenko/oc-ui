export function renderFence(content: string): string {
  const longestRun =
    content.match(/`+/g)?.reduce((longest, run) => Math.max(longest, run.length), 0) ?? 0;
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}\n${content}${content.endsWith("\n") ? "" : "\n"}${fence}`;
}
