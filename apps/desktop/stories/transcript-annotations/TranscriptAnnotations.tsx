import type { SessionInboxUser, SessionMessageInfo, SessionPromptInput } from "@opencode-ai/client";
import { Button } from "@opencode-ai/ui/button";
import { createSignal, onCleanup } from "solid-js";
import { RegistryContext } from "@effect/atom-solid";
import { AtomRegistry } from "effect/unstable/reactivity";
import { makeWorkspaceOwner, type WorkspaceOwner } from "../../src/renderer/workspace-owner.ts";
import { Effect, Exit, Scope } from "effect";

import { createAnnotationDraftStore } from "../../src/renderer/domain/annotation-drafts.ts";
import { createReviewDraftStore } from "../../src/renderer/domain/review-drafts.ts";
import { createSessionPrompt } from "../../src/renderer/opencode/session-prompt.ts";
import { createSessionComposer } from "../../src/renderer/components/App/ConnectedApp/Conversation/createSessionComposer.ts";
import { createTranscriptAnnotations } from "../../src/renderer/components/App/ConnectedApp/Conversation/createTranscriptAnnotations.ts";
import { annotationBlock } from "../../src/renderer/components/App/ConnectedApp/Conversation/annotation-source.ts";
import { AnnotationPopover } from "../../src/renderer/components/App/ConnectedApp/Conversation/AnnotationPopover.tsx";
import { Composer } from "../../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/Composer.tsx";
import { TranscriptView } from "../../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/TranscriptView.tsx";
import { composerAgentSelection, composerModelSelection } from "../composer-fixtures.ts";
import "./transcript-annotations.css";

const sourceText =
  "We can keep this review focused: the transcript stays readable when annotation drafts remain above the composer, and source jumps return to the original assistant message.";
const sessionID = "annotations-story";
const sourceID = "assistant-annotations";
const transcript: readonly SessionMessageInfo[] = [
  {
    id: sourceID,
    type: "assistant",
    time: { created: 1, completed: 2 },
    agent: "build",
    model: { providerID: "openai", id: "gpt-5" },
    finish: "stop",
    content: [
      { type: "text", text: sourceText },
      {
        type: "text",
        text: "You can also select **formatted text**, `inline code`, and repeated words: ready, ready.\n\n| Check | Result |\n| --- | --- |\n| Types | Passed |\n| Tests | Passed |",
      },
      {
        type: "reasoning",
        text: "Keep the source unchanged while attaching useful context.",
        time: { created: 1, completed: 2 },
      },
      {
        type: "tool",
        id: "annotation-tool",
        name: "check",
        time: { created: 1, ran: 1, completed: 2 },
        state: {
          status: "completed",
          input: { command: "pnpm check" },
          content: [{ type: "text", text: "Type checks passed.\nTests passed." }],
        },
      },
    ],
  },
];

export type TranscriptAnnotationsProps = {
  readonly initialSent?: boolean;
  readonly initialRunning?: boolean;
  readonly narrow?: boolean;
};

/** Real annotation components and submission controller, with a simulated SDK transport. */
export function TranscriptAnnotations(props: TranscriptAnnotationsProps) {
  const registry = AtomRegistry.make();
  const scope = Scope.makeUnsafe();
  const effects = Effect.runSync(
    makeWorkspaceOwner(registry).pipe(Effect.provideService(Scope.Scope, scope)),
  );
  onCleanup(() => {
    void Effect.runPromise(Scope.close(scope, Exit.void)).then(() => registry.dispose());
  });
  return (
    <RegistryContext.Provider value={registry}>
      <TranscriptAnnotationsContent {...props} effects={effects} />
    </RegistryContext.Provider>
  );
}

function TranscriptAnnotationsContent(
  props: TranscriptAnnotationsProps & { readonly effects: WorkspaceOwner },
) {
  const drafts = createAnnotationDraftStore(props.effects);
  for (const [quote, body] of [
    [
      "annotation drafts remain above the composer",
      "Show just one count in the composer, like code review comments.",
    ],
    [
      "source jumps return to the original assistant message.",
      "Keep this comment available on the highlighted text after sending.",
    ],
  ] as const) {
    const start = sourceText.indexOf(quote);
    drafts.add(sessionID, {
      source: {
        messageID: sourceID,
        block: annotationBlock("content", 0, "text"),
        textDigest: "afbe01b2f6bb64a0275446de362022298436f7ba2ceb896da6b836549aabdb61",
        start,
        end: start + quote.length,
      },
      quote,
      body,
    });
  }
  const initialMessages = [...transcript];
  if (props.initialSent) {
    const snapshot = drafts.take(sessionID);
    const prompt = createSessionPrompt({
      instruction: "Please address these comments.",
      reviewComments: [],
      annotations: snapshot.comments,
    });
    initialMessages.push({
      id: "msg_annotation_story_sent",
      type: "user",
      time: { created: 3 },
      ...prompt,
    });
  }
  const [selectedID, setSelectedID] = createSignal(sessionID);
  const [running, setRunning] = createSignal(props.initialRunning ?? false);
  const [failNext, setFailNext] = createSignal(false);
  const [messages, setMessages] = createSignal<Record<string, readonly SessionMessageInfo[]>>({
    [sessionID]: initialMessages,
    other: [],
  });
  const currentMessages = () => messages()[selectedID()] ?? [];
  const [modelID, setModelID] = createSignal("openai/gpt-5");
  const [variantID, setVariantID] = createSignal("deep");
  const [agentID, setAgentID] = createSignal("build");
  const composer = createSessionComposer({
    effects: props.effects,
    runtime: {
      api: {
        session: {
          command: () => Promise.resolve(),
        },
      },
      data: {
        session: {
          message: {
            get: (id, messageID) => messages()[id]?.find((message) => message.id === messageID),
          },
          prompt: (input: SessionPromptInput): Promise<SessionInboxUser> => {
            const id = input.id!;
            const row: SessionMessageInfo = {
              id,
              type: "user",
              text: input.text,
              metadata: input.metadata,
              time: { created: 3 },
            };
            setMessages((all) => ({
              ...all,
              [input.sessionID]: [
                ...(all[input.sessionID] ?? []).filter((message) => message.id !== id),
                row,
              ],
            }));
            const fails = failNext();
            setFailNext(false);
            return Effect.sleep("400 millis").pipe(
              Effect.map((): SessionInboxUser => {
                if (fails) {
                  setMessages((all) => ({
                    ...all,
                    [input.sessionID]: (all[input.sessionID] ?? []).filter(
                      (message) => message.id !== id,
                    ),
                  }));
                  throw new Error("Simulated send failure");
                } else {
                  return {
                    id,
                    sessionID: input.sessionID,
                    timeCreated: row.time.created,
                    type: "user",
                    delivery: "steer",
                    payload: { text: input.text, metadata: input.metadata },
                  };
                }
              }),
              Effect.runPromise,
            );
          },
        },
      },
    },
    commands: () => ({ state: "ready", items: [] }),
    selectedID,
    transcriptLoading: () => false,
    transcriptError: () => undefined,
    connected: () => true,
    selectionSwitching: () => false,
    annotations: drafts,
    review: {
      drafts: createReviewDraftStore(props.effects),
      key: () => undefined,
      requestDiscard: () => undefined,
    },
  });
  if (!props.initialSent) composer.input("Please address these comments.");
  const ui = createTranscriptAnnotations({
    sessionID: selectedID,
    messages: currentMessages,
    drafts,
    enabled: () => !composer.disabled(),
  });
  const count = () => drafts.get(selectedID()).length;

  return (
    <main
      class="transcript-annotation-stage"
      classList={{ "transcript-annotation-stage--narrow": props.narrow }}
    >
      <div class="transcript-annotation-shell">
        <header class="annotation-exploration-header">
          <h1>Transcript annotations</h1>
          <p>Production components with simulated sending. Select text or click a highlight.</p>
          <div class="annotation-story-controls">
            <Button
              variant="ghost-muted"
              onClick={() => {
                ui.close();
                setRunning(!running());
              }}
            >
              {running() ? "Finish turn" : "Simulate running"}
            </Button>
            <Button
              variant="ghost-muted"
              onClick={() => {
                ui.close();
                setSelectedID(selectedID() === sessionID ? "other" : sessionID);
              }}
            >
              Switch conversation
            </Button>
            <Button
              variant="ghost-muted"
              aria-pressed={failNext()}
              onClick={() => setFailNext(!failNext())}
            >
              Fail next send
            </Button>
          </div>
        </header>
        <div class="annotation-story-transcript">
          <TranscriptView
            sessionID={selectedID()}
            messages={currentMessages()}
            sessionStatus={running() ? "running" : "idle"}
            annotationRootRef={ui.attach}
            onOpenAnnotation={ui.openSent}
          />
        </div>
        <div class="annotation-story-composer">
          <Composer
            value={composer.value()}
            action={running() ? "running" : composer.submitting() ? "sending" : "send"}
            disabled={running() ? false : composer.disabled()}
            error={composer.error()}
            annotations={
              count()
                ? {
                    count: count(),
                    onOpen: ui.openDrafts,
                    onDiscard: ui.discard,
                  }
                : undefined
            }
            modelSelection={composerModelSelection({
              selectedModelID: modelID(),
              selectedVariantID: variantID(),
              onSelectModel: setModelID,
              onSelectVariant: setVariantID,
            })}
            agentSelection={composerAgentSelection({
              selectedAgentID: agentID(),
              onSelectAgent: setAgentID,
            })}
            onInput={composer.input}
            onSubmit={() => {
              ui.close();
              void composer.submit();
            }}
            onStop={() => setRunning(false)}
          />
        </div>
        <AnnotationPopover controller={ui} />
      </div>
    </main>
  );
}
