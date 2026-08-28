import type { SessionInfo } from "@opencode-ai/client";

export function storySession(id: string, title: string, parentID?: string): SessionInfo {
  return {
    id,
    title,
    parentID,
    projectID: "storybook",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1 },
    location: { directory: "/storybook" },
  };
}
