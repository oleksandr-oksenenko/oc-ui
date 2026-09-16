import type { SessionMessageInfo } from "@opencode/client";

export const storyTranscript: readonly SessionMessageInfo[] = [
  {
    id: "user-1",
    time: { created: 1 },
    type: "user",
    text: "Review the current layout and keep the final UI compact.",
    files: [
      { data: "base64-omitted", mime: "text/plain", source: { type: "inline" }, name: "notes.md" },
    ],
  },
  {
    id: "assistant-1",
    time: { created: 2, completed: 3 },
    type: "assistant",
    agent: "build",
    model: { providerID: "openai", id: "gpt-5" },
    content: [
      {
        type: "text",
        text: "The shell keeps the session, transcript, composer, and context visible together.",
      },
      {
        type: "reasoning",
        text: "Compared the layout with the compact workspace target.",
        time: { created: 2, completed: 3 },
      },
      {
        type: "tool",
        id: "tool-1",
        name: "layout-check",
        time: { created: 2, ran: 2, completed: 3 },
        state: {
          status: "completed",
          input: { path: "src/renderer" },
          content: [{ type: "text", text: "Layout is ready." }],
        },
      },
    ],
    finish: "stop",
  },
];
