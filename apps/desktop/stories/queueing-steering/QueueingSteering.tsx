import type { SessionInboxUser, SessionMessageInfo } from "@opencode-ai/client";
import { createSignal } from "solid-js";

import { PendingMessages } from "../../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/PendingMessages.tsx";
import { Composer } from "../../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/Composer.tsx";
import { SessionPane } from "../../src/renderer/components/App/ConnectedApp/Conversation/SessionPane.tsx";
import { TranscriptView } from "../../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/TranscriptView.tsx";
import { composerAgentSelection, composerModelSelection } from "../composer-fixtures.ts";
import "./queueing-steering.css";

export const queuedMessage = (
  id: string,
  text: string,
  delivery: SessionInboxUser["delivery"] = "queue",
): SessionInboxUser => ({
  id,
  sessionID: "prototype",
  timeCreated: 1,
  type: "user",
  delivery,
  payload: { text },
});

export function QueueingSteering(props: {
  readonly initialDraft?: string;
  readonly initialPending?: readonly SessionInboxUser[];
  readonly initiallyRunning?: boolean;
  readonly attached?: boolean;
}) {
  const [draft, setDraft] = createSignal(props.initialDraft ?? "");
  const [pending, setPending] = createSignal(props.initialPending ?? []);
  const [running, setRunning] = createSignal(props.initiallyRunning ?? true);
  const [files, setFiles] = createSignal<readonly File[]>(
    props.attached ? [new File(["layout notes"], "notes.txt", { type: "text/plain" })] : [],
  );
  const [delivered, setDelivered] = createSignal<readonly SessionMessageInfo[]>([]);
  let nextID = 0;
  const send = (delivery: SessionInboxUser["delivery"]) => {
    const text =
      draft().trim() ||
      files()
        .map((file) => file.name)
        .join(", ");
    if (running()) {
      setPending((messages) => [...messages, queuedMessage(`draft-${++nextID}`, text, delivery)]);
    } else {
      setDelivered((messages) => [
        ...messages,
        { id: `sent-${++nextID}`, type: "user", text, time: { created: nextID } },
      ]);
      setRunning(true);
    }
    setDraft("");
    setFiles([]);
  };
  const transcript = (): readonly SessionMessageInfo[] => [
    {
      id: "request",
      type: "user",
      text: "Review the composer layout and check how it behaves on smaller screens.",
      time: { created: 1 },
    },
    {
      id: "response",
      type: "assistant",
      agent: "build",
      model: { providerID: "openai", id: "gpt-5" },
      time: running() ? { created: 2 } : { created: 2, completed: 3 },
      content: [
        {
          type: "text",
          text: "I’m checking the composer controls and spacing at desktop and mobile widths.",
        },
      ],
    },
    ...delivered(),
  ];

  return (
    <div class="queue-prototype">
      <SessionPane
        selected
        title="Composer layout"
        transcript={
          <TranscriptView
            sessionID="prototype"
            messages={transcript()}
            sessionStatus={running() ? "running" : "idle"}
            loading={false}
          />
        }
        composer={
          <>
            <PendingMessages
              messages={pending()}
              onCancel={(id) =>
                setPending((messages) => messages.filter((message) => message.id !== id))
              }
              onSteer={(id) =>
                setPending((messages) =>
                  messages.map((message) =>
                    message.id === id ? { ...message, delivery: "steer" } : message,
                  ),
                )
              }
            />
            <Composer
              value={draft()}
              files={files()}
              onPasteFiles={(incoming) => setFiles((current) => [...current, ...incoming])}
              onRemoveFile={(file) =>
                setFiles((current) => current.filter((item) => item !== file))
              }
              disabled={false}
              action={running() ? "running" : "send"}
              modelSelection={composerModelSelection()}
              agentSelection={composerAgentSelection()}
              onInput={setDraft}
              onSubmit={() => send("steer")}
              onQueue={() => send("queue")}
              onStop={() => setRunning(false)}
            />
          </>
        }
      />
    </div>
  );
}
