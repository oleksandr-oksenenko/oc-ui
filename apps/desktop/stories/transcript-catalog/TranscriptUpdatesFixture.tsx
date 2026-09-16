import type { SessionMessageAssistant } from "@opencode/client";
import { Button } from "@opencode/ui/button";
import { batch, createSignal } from "solid-js";
import { createStore } from "solid-js/store";

import { TranscriptView } from "../../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/TranscriptView.tsx";

export function TranscriptUpdatesFixture() {
  const [messages, setMessages] = createStore<SessionMessageAssistant[]>(
    Array.from({ length: 40 }, (_, index) => ({
      id: `history-${index}`,
      type: "assistant",
      agent: "build",
      model: { providerID: "test", id: "test" },
      time: { created: index },
      content:
        index === 20
          ? [
              {
                type: "tool",
                id: "scroll-tool",
                name: "read",
                time: { created: index },
                state: { status: "running", input: { path: "README.md" }, metadata: {} },
              },
            ]
          : [
              {
                type: "text",
                text: `## Message ${index}\n\n${"Earlier transcript content. ".repeat(20)}`,
              },
            ],
    })),
  );
  const [status, setStatus] = createSignal<"running" | "idle">("running");
  const advance = () =>
    batch(() => {
      setStatus("running");
      setMessages(20, "content", 0, {
        type: "tool",
        id: "scroll-tool",
        name: "read",
        time: { created: 20, completed: 40 },
        state: {
          status: "completed",
          input: { path: "README.md" },
          content: [{ type: "text", text: "Read finished.\n".repeat(5) }],
        },
      });
      setMessages(messages.length, {
        id: `response-${messages.length}`,
        agent: "build",
        model: { providerID: "test", id: "test" },
        type: "assistant",
        time: { created: messages.length },
        content: [{ type: "text", text: "## Next response\n\n" + "New content. ".repeat(100) }],
      });
    });

  return (
    <div style={{ height: "100vh", display: "grid", "grid-template-rows": "auto minmax(0, 1fr)" }}>
      <div>
        <Button onClick={advance}>Advance response</Button>
        <Button onClick={() => setStatus("idle")}>Finish turn</Button>
      </div>
      <TranscriptView sessionID="updates" messages={messages} sessionStatus={status()} />
    </div>
  );
}
