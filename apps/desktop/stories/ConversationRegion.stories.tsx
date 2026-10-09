/* oxlint-disable effecttsgo/async-function -- Storybook owns interaction tests. */
import { RegistryContext } from "@effect/atom-solid";
import { Effect, Exit, Scope } from "effect";
import { AtomRegistry } from "effect/unstable/reactivity";
import { createSignal, onCleanup } from "solid-js";
import { expect, within } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import {
  ConversationRegion,
  type ConversationRegionProps,
} from "../src/renderer/components/App/ConnectedApp/Conversation/ConversationRegion.tsx";
import { createAnnotationDraftStore } from "../src/renderer/domain/annotation-drafts.ts";
import { makeWorkspaceOwner } from "../src/renderer/workspace-owner.ts";
import { storySession } from "./session-fixtures.ts";
import { workspaceQuestionForm } from "./question-form-fixtures.ts";

const session = storySession("transcript-story", "Pending requests");
const child = storySession("transcript-story-child", "Explore auth", session.id);
const settled = () => Promise.resolve();

const renderConversation =
  (state: "ready" | "loading" | "failed" = "ready", subagent = false) =>
  () => {
    const registry = AtomRegistry.make();
    const scope = Scope.makeUnsafe();
    const effects = Effect.runSync(
      makeWorkspaceOwner(registry).pipe(Effect.provideService(Scope.Scope, scope)),
    );
    onCleanup(() => {
      void Effect.runPromise(Scope.close(scope, Exit.void)).then(() => registry.dispose());
    });
    const [forms, setForms] = createSignal(
      state === "ready"
        ? [{ ...workspaceQuestionForm, sessionID: subagent ? child.id : session.id }]
        : [],
    );
    const [requests, setRequests] = createSignal(
      state === "ready"
        ? [
            {
              id: "catalog-permission",
              sessionID: subagent ? child.id : session.id,
              action: "run command",
              resources: ["pnpm check"],
              save: ["pnpm check"],
            },
          ]
        : [],
    );
    const props = (): ConversationRegionProps => ({
      annotationDrafts: createAnnotationDraftStore(effects),
      connected: () => true,
      workspace: {
        selectedDraftID: () => undefined,
        selectDraft: () => undefined,
        sessions: () => [session, child],
        selectedSession: () => session,
        selectedID: () => session.id,
        subagentIDs: () => (subagent ? [child.id] : []),
        running: () => false,
        stopError: () => undefined,
        transcript: () => [],
        transcriptSnapshot: () => ({ sessionID: session.id, messages: [] }),
        transcriptStatus: () => "idle",
        transcriptLoading: () => false,
        transcriptError: () => undefined,
        select: () => undefined,
        stop: settled,
        hydrate: settled,
        syncCatalog: settled,
        retryCatalog: settled,
        beginRecovery: () => undefined,
        refreshAfterReconnect: settled,
        failRecovery: () => undefined,
        remove: () => undefined,
      },
      composer: {
        files: () => [],
        browserBatches: () => [],
        removeBrowserBatch: () => undefined,
        skills: () => [],
        value: () => "",
        disabled: () => false,
        submitting: () => false,
        transcriptPromptIDs: () => [],
        error: () => undefined,
        review: () => undefined,
        command: () => undefined,
        input: () => undefined,
        attachFiles: () => undefined,
        attachText: () => undefined,
        removeFile: () => undefined,
        appendBatch: () => undefined,
        submit: settled,
        clear: () => undefined,
      },
      inbox: {
        messages: () => [],
        busy: () => false,
        error: () => undefined,
        cancel: settled,
        steer: settled,
        refresh: settled,
      },
      modelSelection: {
        state: () => "ready",
        error: () => undefined,
        switching: () => false,
        models: () => [],
        selectedModelID: () => undefined,
        contextLimit: () => undefined,
        variants: () => [],
        selectedVariantID: () => undefined,
        sync: settled,
        selectModel: settled,
        selectVariant: settled,
      },
      agentSelection: {
        state: () => "ready",
        error: () => undefined,
        switching: () => false,
        agents: () => [],
        selectedAgentID: () => undefined,
        sync: settled,
        selectAgent: settled,
      },
      forms: {
        sessionForms: forms,
        state: () => state,
        error: () => "Questions could not be loaded.",
        subagentError: () => undefined,
        submitting: () => false,
        errorFor: () => undefined,
        answerFor: () => undefined,
        saveAnswer: () => undefined,
        sync: settled,
        retrySubagents: settled,
        reply: () => {
          setForms([]);
          return settled();
        },
        cancel: () => {
          setForms([]);
          return settled();
        },
      },
      permissions: {
        autoAccept: () => false,
        setAutoAccept: () => undefined,
        requests,
        state: () => state,
        error: () => "Permissions could not be loaded.",
        recoveryError: () => undefined,
        subagentError: () => undefined,
        pending: () => false,
        submitting: () => false,
        errorFor: () => undefined,
        sync: settled,
        retrySubagents: settled,
        reply: () => {
          setRequests([]);
          return settled();
        },
      },
    });
    return (
      <RegistryContext.Provider value={registry}>
        <div style={{ height: "100vh", width: subagent ? "min(320px, 100%)" : "100%" }}>
          <ConversationRegion {...props()} />
        </div>
      </RegistryContext.Provider>
    );
  };

const meta = {
  title: "Conversation/ConversationRegion",
  component: ConversationRegion,
  parameters: { layout: "fullscreen" },
  render: renderConversation(),
} satisfies Meta<typeof ConversationRegion>;
export default meta;
// The render harness supplies required controller props inside the registry provider.
type Story = StoryObj;

export const PendingRequests: Story = {};
export const LoadingRequests: Story = { render: renderConversation("loading") };
export const RequestFailure: Story = { render: renderConversation("failed") };
export const PendingSubagentRequests: Story = {
  render: renderConversation("ready", true),
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("heading", { name: "Subagent: Explore auth" }),
    ).toBeVisible();
    const group = canvasElement.querySelector<HTMLElement>(".transcript-pending-subagent")!;
    const article = canvasElement.querySelector<HTMLElement>(".transcript-pending-interaction")!;
    await expect(group.querySelectorAll("[data-permission-request-id]")).toHaveLength(1);
    await expect(group.querySelectorAll(".question-form-card")).toHaveLength(1);
    for (const node of [
      article,
      group,
      ...group.querySelectorAll<HTMLElement>(".permission-request-card, .question-form-card"),
    ]) {
      await expect(node.scrollWidth).toBeLessThanOrEqual(node.clientWidth + 1);
    }
    await expect(group.getBoundingClientRect().width).toBeLessThanOrEqual(
      article.getBoundingClientRect().width + 1,
    );
  },
};
