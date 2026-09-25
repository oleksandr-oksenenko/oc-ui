import type {
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageInfo,
} from "@opencode/client";
import { Button } from "@opencode/ui/button";
import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";

import { TranscriptView } from "../../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/TranscriptView.tsx";
import { TranscriptPendingFixture } from "./TranscriptPendingFixture.tsx";

const prompt: SessionMessageInfo = {
  id: "activity-prompt",
  type: "user",
  time: { created: 1 },
  text: "Check the workspace and summarize what changed.",
};

function tool(index: number): SessionMessageAssistantTool {
  return {
    id: `activity-tool-${index}`,
    type: "tool",
    name: index % 3 === 0 ? "search" : "read",
    time: { created: index + 2, ran: index + 2, completed: index + 3 },
    state: {
      status: "completed",
      input: { path: `src/module-${index}.ts` },
      content: [{ type: "text", text: `Inspected module ${index}.` }],
    },
  };
}

export function TranscriptActivityFixture(props: {
  readonly pending?: boolean;
  readonly width?: string;
}) {
  const [responses, setResponses] = createStore<SessionMessageAssistant[]>([
    {
      id: "activity-first-cycle",
      type: "assistant",
      agent: "build",
      model: { providerID: "test", id: "test" },
      time: { created: 2 },
      content: [
        { type: "text", text: "I’m checking the relevant files." },
        { type: "reasoning", text: "Reviewing the workspace changes.", time: { created: 2 } },
        ...Array.from({ length: 14 }, (_, index) => tool(index)),
      ],
    },
  ]);
  const [ended, setEnded] = createSignal(false);
  let nextTool = 14;

  const addStep = () => {
    if (ended()) return;
    const index = responses.length - 1;
    setResponses(index, "content", responses[index]!.content.length, tool(nextTool++));
  };
  const nextCycle = () => {
    if (ended() || responses.length > 1) return;
    setResponses(0, "time", "completed", 20);
    setResponses(0, "finish", "tool-calls");
    setResponses(1, {
      id: "activity-second-cycle",
      type: "assistant",
      agent: "build",
      model: { providerID: "test", id: "test" },
      time: { created: 21 },
      content: [tool(nextTool++)],
    });
  };
  const finish = () => {
    if (ended()) return;
    const index = responses.length - 1;
    setResponses(index, "content", responses[index]!.content.length, {
      type: "text",
      text: "I checked the changed modules and found no blocking issue.",
    });
    setEnded(true);
  };

  return (
    <div
      style={{
        width: props.width ?? "100%",
        height: "100vh",
        display: "grid",
        "grid-template-rows": "auto minmax(0, 1fr)",
        background: "var(--oc-surface-canvas)",
      }}
    >
      <div style={{ display: "flex", "flex-wrap": "wrap", gap: "8px", padding: "8px 16px" }}>
        <Button onClick={addStep} disabled={ended()}>
          Add activity step
        </Button>
        <Button onClick={nextCycle} disabled={ended() || responses.length > 1}>
          Complete model cycle
        </Button>
        <Button onClick={finish} disabled={ended()}>
          Finish turn
        </Button>
      </div>
      <TranscriptView
        sessionID="activity-stream"
        messages={[
          prompt,
          ...responses,
          ...(ended()
            ? ([
                {
                  id: "activity-turn-idle",
                  type: "idle",
                  time: { created: 30 },
                  outcome: "succeeded",
                },
              ] as const)
            : []),
        ]}
        sessionStatus={ended() ? "idle" : "running"}
        pendingInteraction={props.pending ? <TranscriptPendingFixture /> : undefined}
      />
    </div>
  );
}
