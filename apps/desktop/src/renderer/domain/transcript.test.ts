import type { SessionMessageInfo } from "@opencode-ai/client";
import { describe, expect, it } from "vite-plus/test";

import { projectTranscript } from "./transcript.ts";

const messages: SessionMessageInfo[] = [
  {
    id: "system-1",
    time: { created: 1 },
    type: "system",
    text: "internal context",
  },
  {
    id: "user-1",
    time: { created: 2 },
    type: "user",
    text: "Explain this project",
  },
  {
    id: "assistant-1",
    time: { created: 3 },
    type: "assistant",
    agent: "build",
    model: { id: "model", providerID: "provider" },
    content: [
      { type: "reasoning", text: "hidden reasoning" },
      { type: "text", text: "First block" },
      { type: "text", text: "" },
      { type: "text", text: "Second block" },
    ],
  },
];

describe("projectTranscript", () => {
  it("keeps visible user and assistant text in source order", () => {
    expect(projectTranscript(messages, "running")).toEqual([
      { kind: "user", id: "user-1", text: "Explain this project" },
      {
        kind: "assistant",
        id: "assistant-1",
        textBlocks: ["First block", "Second block"],
        state: "streaming",
      },
    ]);
  });

  it("uses the message completion and failure fields", () => {
    const completed = {
      ...messages[2],
      time: { created: 3, completed: 4 },
    } as SessionMessageInfo;
    const failed = {
      ...messages[2],
      finish: "error",
    } as SessionMessageInfo;

    expect(projectTranscript([completed], "running")[0]).toMatchObject({ state: "complete" });
    expect(projectTranscript([failed], "idle")[0]).toMatchObject({ state: "failed" });
  });
});
