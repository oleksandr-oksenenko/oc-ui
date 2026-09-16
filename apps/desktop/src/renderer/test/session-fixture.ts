import type { SessionInfo } from "@opencode/client";

export function sessionFixture(
  input: Pick<SessionInfo, "id" | "location"> & Partial<SessionInfo>,
): SessionInfo {
  return {
    projectID: "project",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1 },
    ...input,
  };
}
