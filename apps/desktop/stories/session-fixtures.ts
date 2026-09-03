import type { SessionInfo } from "@opencode-ai/client";

import { sessionFixture } from "../src/renderer/test/session-fixture.ts";
export function storySession(id: string, title: string, parentID?: string): SessionInfo {
  return sessionFixture({
    id,
    title,
    parentID,
    projectID: "storybook",
    location: { directory: "/storybook" },
  });
}
