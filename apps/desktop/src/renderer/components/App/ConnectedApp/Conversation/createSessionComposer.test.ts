import { withTestWorkspace } from "../../../../test/workspace.ts";
import type { SessionInboxUser, SessionMessageInfo } from "@opencode-ai/client";
import { createRoot, createSignal, onCleanup } from "solid-js";
import { Effect, Exit, Scope } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  createAnnotationDraftStore,
  createReviewDraftStore,
  type ReviewDraftKey,
} from "../../../../domain/index.ts";
import { SESSION_PROMPT_METADATA_KEY } from "../../../../opencode/session-prompt.ts";
import { createSessionComposer } from "./createSessionComposer.ts";

type ComposerInput = Parameters<typeof createSessionComposer>[0];
type Prompt = ComposerInput["runtime"]["data"]["session"]["prompt"];
type PromptInput = Parameters<Prompt>[0];
type PromptResult = SessionInboxUser;

const promptResult = ({ sessionID, text, metadata }: PromptInput): PromptResult => ({
  id: "prompt",
  sessionID,
  timeCreated: 0,
  type: "user",
  payload: metadata === undefined ? { text } : { text, metadata },
  delivery: "queue",
});

const selection = { start: 2, side: "additions" as const, end: 2, endSide: "additions" as const };
const selectedCode = "const fixed = true;\n";
const annotationInput = {
  source: {
    messageID: "assistant-message",
    block: "content/0/text",
    textDigest: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    start: 0,
    end: 5,
  },
  quote: "hello",
  body: "Please clarify this sentence.",
};

function setup(prompt: Prompt = vi.fn<Prompt>((input) => Promise.resolve(promptResult(input)))) {
  return withTestWorkspace((effects, dispose) => {
    const [selectedID, setSelectedID] = createSignal<string>();
    const [running, setRunning] = createSignal(false);
    const [transcriptLoading, setTranscriptLoading] = createSignal(false);
    const [transcriptError, setTranscriptError] = createSignal<string>();
    const [connected, setConnected] = createSignal(true);
    const [selectionSwitching, setSelectionSwitching] = createSignal(false);
    const [reviewKey, setReviewKey] = createSignal<ReviewDraftKey>();
    const reviewDrafts = createReviewDraftStore(effects);
    const annotationDrafts = createAnnotationDraftStore(effects);
    const messages = new Map<string, SessionMessageInfo>();
    const [messageRevision, setMessageRevision] = createSignal(0);
    const setMessage = (sessionID: string, message: SessionMessageInfo): void => {
      messages.set(`${sessionID}:${message.id}`, message);
      setMessageRevision((revision) => revision + 1);
    };
    const requestDiscard =
      vi.fn<(key: ReviewDraftKey, count: number, opener: HTMLButtonElement) => void>();
    let unmountComposer!: () => void;
    const composer = createRoot((disposeComposer) => {
      unmountComposer = disposeComposer;
      return createSessionComposer({
        effects,
        runtime: {
          data: {
            session: {
              prompt,
              message: {
                get: (sessionID, messageID) => {
                  messageRevision();
                  return messages.get(`${sessionID}:${messageID}`);
                },
              },
            },
          },
        },
        selectedID,
        running,
        transcriptLoading,
        transcriptError,
        annotations: annotationDrafts,
        connected,
        selectionSwitching,
        review: { drafts: reviewDrafts, key: reviewKey, requestDiscard },
      });
    });
    onCleanup(unmountComposer);
    return {
      dispose,
      unmountComposer,
      effects,
      composer,
      setSelectedID,
      setRunning,
      setTranscriptLoading,
      setTranscriptError,
      setConnected,
      setSelectionSwitching,
      setReviewKey,
      reviewDrafts,
      annotationDrafts,
      messages,
      setMessage,
      requestDiscard,
      prompt,
    };
  });
}

function seedReview(
  root: ReturnType<typeof setup>,
  sessionID = "session",
  body = "Use the validated value here.",
) {
  root.setSelectedID("session");
  const key: ReviewDraftKey = { sessionID, comparison: "working" };
  root.setReviewKey(key);
  const id = root.reviewDrafts.begin(key, "src/example.ts", selection, selectedCode);
  root.reviewDrafts.updateBody(key, id, body);
  return { key, id };
}

describe("createSessionComposer", () => {
  it("settles admission and restores annotations after its UI subscriber unmounts", async () => {
    let rejectPrompt!: (error: Error) => void;
    const prompt = vi.fn<Prompt>(
      () =>
        new Promise((_resolve, reject) => {
          rejectPrompt = reject;
        }),
    );
    const root = setup(prompt);
    root.setSelectedID("session");
    root.annotationDrafts.add("session", annotationInput);
    const submitted = root.annotationDrafts.get("session");
    const admission = root.composer.submit();
    root.unmountComposer();
    rejectPrompt(new Error("offline"));
    await admission;

    expect(root.annotationDrafts.get("session")).toEqual(submitted);
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("waits for an uncancellable SDK admission during workspace shutdown", async () => {
    let rejectPrompt!: (error: Error) => void;
    const prompt = vi.fn<Prompt>(
      () =>
        new Promise((_resolve, reject) => {
          rejectPrompt = reject;
        }),
    );
    const root = setup(prompt);
    root.setSelectedID("session");
    root.annotationDrafts.add("session", annotationInput);
    const submitted = root.annotationDrafts.get("session");
    const admission = root.composer.submit().catch(() => undefined);
    let closed = false;
    const closing = Effect.runPromise(Scope.close(root.effects.scope, Exit.void)).then(() => {
      closed = true;
      return undefined;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    rejectPrompt(new Error("offline"));
    await closing;
    await admission;

    expect(closed).toBe(true);
    expect(root.annotationDrafts.get("session")).toEqual(submitted);
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("keeps drafts per session and clears only the submitted draft", async () => {
    const prompt = vi.fn<Prompt>((input) => Promise.resolve(promptResult(input)));
    const root = setup(prompt);
    root.setSelectedID("one");
    root.composer.input("first");
    root.setSelectedID("two");
    root.composer.input("second");
    root.setSelectedID("one");

    await root.composer.submit();

    expect(prompt).toHaveBeenCalledWith(
      expect.objectContaining({ sessionID: "one", text: "first" }),
    );
    expect(root.composer.value()).toBe("");
    root.setSelectedID("two");
    expect(root.composer.value()).toBe("second");
    root.dispose();
  });

  it("keeps edits made while prompt admission is in flight", async () => {
    let resolvePrompt!: () => void;
    const prompt = vi.fn<Prompt>(
      () =>
        new Promise<PromptResult>((resolve) => {
          resolvePrompt = () => resolve(promptResult({ sessionID: "session", text: "submitted" }));
        }),
    );
    const root = setup(prompt);
    root.setSelectedID("session");
    root.composer.input("submitted");

    const submission = root.composer.submit();
    await root.composer.submit();
    expect(root.composer.submitting()).toBe(true);
    root.composer.input("new edit");
    resolvePrompt();
    await submission;

    expect(root.composer.value()).toBe("new edit");
    expect(root.composer.submitting()).toBe(false);
    root.dispose();
  });

  it("does not let a cleared request clear a newer same-text submission", async () => {
    let resolveFirst!: () => void;
    let resolveSecond!: () => void;
    const prompt = vi.fn<Prompt>((input) => {
      const result = promptResult(input);
      return new Promise<PromptResult>((resolve) => {
        if (prompt.mock.calls.length === 1) resolveFirst = () => resolve(result);
        else resolveSecond = () => resolve(result);
      });
    });
    const root = setup(prompt);
    root.setSelectedID("session");
    root.composer.input("same draft");
    const first = root.composer.submit();
    await Promise.resolve();

    root.composer.clear("session");
    root.composer.input("same draft");
    const second = root.composer.submit();
    await Promise.resolve();
    resolveFirst();
    await first;
    expect(root.composer.value()).toBe("same draft");

    resolveSecond();
    await second;
    expect(root.composer.value()).toBe("");
    root.dispose();
  });

  it("keeps a failed draft and exposes the current prompt error", async () => {
    const prompt = vi.fn<Prompt>(() => Promise.reject(new Error("offline")));
    const root = setup(prompt);
    root.setSelectedID("session");
    root.composer.input("keep me");

    await root.composer.submit();

    expect(root.composer.value()).toBe("keep me");
    expect(root.composer.error()).toBe(
      "Couldn't confirm the message was sent. Your draft has been restored.",
    );
    root.dispose();
  });

  it("clears an error when selection changes and ignores guarded submissions", async () => {
    const prompt = vi.fn<Prompt>((input) => Promise.resolve(promptResult(input)));
    const root = setup(prompt);

    await root.composer.submit();
    root.setSelectedID("session");
    root.composer.input("   ");
    await root.composer.submit();
    expect(prompt).not.toHaveBeenCalled();

    root.annotationDrafts.add("session", { ...annotationInput, body: "  " });
    await root.composer.submit();
    expect(prompt).not.toHaveBeenCalled();
    expect(root.annotationDrafts.get("session")).toHaveLength(1);

    root.composer.input("message");
    root.setConnected(false);
    expect(root.composer.disabled()).toBe(true);
    await root.composer.submit();
    expect(prompt).not.toHaveBeenCalled();

    root.setConnected(true);
    root.setRunning(true);
    await root.composer.submit();
    expect(prompt).not.toHaveBeenCalled();

    root.setRunning(false);
    root.setTranscriptLoading(true);
    expect(root.composer.disabled()).toBe(true);
    root.setTranscriptLoading(false);
    root.setSelectedID("other");
    expect(root.composer.error()).toBeUndefined();
    root.dispose();
  });

  it("disables and guards submission while agent or model selection switches", async () => {
    const prompt = vi.fn<Prompt>((input) => Promise.resolve(promptResult(input)));
    const root = setup(prompt);
    root.setSelectedID("session");
    root.composer.input("message");
    root.setSelectionSwitching(true);

    expect(root.composer.disabled()).toBe(true);
    await root.composer.submit();
    expect(prompt).not.toHaveBeenCalled();

    root.setSelectionSwitching(false);
    await root.composer.submit();
    expect(prompt).toHaveBeenCalledWith(
      expect.objectContaining({ sessionID: "session", text: "message" }),
    );
    root.dispose();
  });

  it("submits a review without composer text through one prompt with versioned metadata", async () => {
    const prompt = vi.fn<Prompt>((input) => Promise.resolve(promptResult(input)));
    const root = setup(prompt);
    const { key } = seedReview(root);

    expect(root.composer.review()).toMatchObject({ count: 1 });
    await root.composer.submit();

    expect(prompt).toHaveBeenCalledTimes(1);
    expect(prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID: "session",
        text: expect.stringContaining("## Code review"),
        metadata: {
          [SESSION_PROMPT_METADATA_KEY]: expect.objectContaining({
            reviewComments: expect.any(Array),
            version: 1,
            instruction: "",
          }),
        },
      }),
    );
    expect(root.reviewDrafts.get(key).comments).toEqual([]);
    root.dispose();
  });

  it("does not attach a review whose key belongs to another session", async () => {
    const prompt = vi.fn<Prompt>((input) => Promise.resolve(promptResult(input)));
    const root = setup(prompt);
    seedReview(root, "other-session", "Do not attach this.");

    expect(root.composer.review()).toBeUndefined();
    await root.composer.submit();
    expect(prompt).not.toHaveBeenCalled();
    root.dispose();
  });

  it("submits composer text and review as one snapshot", async () => {
    const prompt = vi.fn<Prompt>((input) => Promise.resolve(promptResult(input)));
    const root = setup(prompt);
    const { key } = seedReview(root, "session", "Handle the empty state.");
    root.composer.input("Keep the public API unchanged.");

    await root.composer.submit();

    expect(prompt).toHaveBeenCalledTimes(1);
    expect(prompt.mock.calls[0]?.[0]).toMatchObject({
      sessionID: "session",
      text: expect.stringContaining("Keep the public API unchanged.\n\n## Code review"),
    });
    expect(root.composer.value()).toBe("");
    expect(root.reviewDrafts.get(key).comments).toEqual([]);
    root.dispose();
  });

  it("omits blank annotation drafts from a valid submission", async () => {
    const prompt = vi.fn<Prompt>((input) => Promise.resolve(promptResult(input)));
    const root = setup(prompt);
    root.setSelectedID("session");
    const validID = root.annotationDrafts.add("session", annotationInput);
    root.annotationDrafts.add("session", { ...annotationInput, body: "  " });

    await root.composer.submit();

    expect(prompt).toHaveBeenCalledTimes(1);
    expect(prompt.mock.calls[0]?.[0].metadata?.[SESSION_PROMPT_METADATA_KEY]).toMatchObject({
      annotations: [{ id: validID, body: annotationInput.body }],
    });
    expect(root.annotationDrafts.get("session")).toEqual([]);
    root.dispose();
  });

  it("keeps review edits made while admission is in flight", async () => {
    let resolvePrompt!: () => void;
    const prompt = vi.fn<Prompt>(
      (input) =>
        new Promise<PromptResult>((resolve) => {
          resolvePrompt = () => resolve(promptResult(input));
        }),
    );
    const root = setup(prompt);
    const { key, id } = seedReview(root, "session", "Submitted body");

    const submission = root.composer.submit();
    root.reviewDrafts.updateBody(key, id, "New edit");
    resolvePrompt();
    await submission;

    expect(root.reviewDrafts.get(key).comments[0]?.body).toBe("New edit");
    root.dispose();
  });

  it("keeps failed review content and requests discard for the captured key", async () => {
    const prompt = vi.fn<Prompt>(() => Promise.reject(new Error("offline")));
    const root = setup(prompt);
    const { key } = seedReview(root, "session", "Keep this comment");

    await root.composer.submit();
    expect(root.reviewDrafts.get(key).comments).toHaveLength(1);

    const opener = document.createElement("button");
    const review = root.composer.review();
    review?.onDiscard(opener);
    expect(root.requestDiscard).toHaveBeenCalledWith(key, 1, opener);
    root.dispose();
  });

  it("takes annotation drafts on send, restores them on failure, and retries with the same ID", async () => {
    let rejectPrompt!: (cause: Error) => void;
    let resolvePrompt!: (result: PromptResult) => void;
    const prompt = vi.fn<Prompt>((_input) => {
      if (prompt.mock.calls.length === 1) {
        return new Promise<PromptResult>((_resolve, reject) => {
          rejectPrompt = reject;
        });
      }
      return new Promise<PromptResult>((resolve) => {
        resolvePrompt = resolve;
      });
    });
    const root = setup(prompt);
    root.setSelectedID("session");
    root.annotationDrafts.add("session", annotationInput);

    const first = root.composer.submit();
    expect(root.annotationDrafts.get("session")).toEqual([]);
    rejectPrompt(new Error("offline"));
    await first;

    expect(root.annotationDrafts.get("session")).toHaveLength(1);
    expect(root.composer.error()).toBe(
      "Couldn't confirm the message was sent. Your draft has been restored.",
    );

    const retry = root.composer.submit();
    await Promise.resolve();
    expect(prompt).toHaveBeenCalledTimes(2);
    expect(prompt.mock.calls[1]?.[0].id).toBe(prompt.mock.calls[0]?.[0].id);
    expect(prompt.mock.calls[1]?.[0].metadata).toEqual(prompt.mock.calls[0]?.[0].metadata);
    resolvePrompt(promptResult(prompt.mock.calls[1]![0]));
    await retry;
    expect(root.annotationDrafts.get("session")).toEqual([]);
    expect(root.composer.error()).toBeUndefined();
    root.dispose();
  });

  it("completes a restored request when its durable row arrives later", async () => {
    let firstInput!: PromptInput;
    const prompt = vi.fn<Prompt>((input) => {
      firstInput = input;
      return Promise.reject(new Error("response lost"));
    });
    const root = setup(prompt);
    root.setSelectedID("session");
    root.annotationDrafts.add("session", annotationInput);

    await root.composer.submit();
    expect(root.annotationDrafts.get("session")).toHaveLength(1);
    expect(root.composer.error()).toContain("draft has been restored");
    root.composer.input("newer instruction");
    root.annotationDrafts.add("session", { ...annotationInput, body: "Keep this newer note." });

    root.setMessage("session", {
      id: firstInput.id!,
      type: "user",
      text: firstInput.text,
      metadata: firstInput.metadata,
      time: { created: 1 },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(root.annotationDrafts.get("session")).toHaveLength(1);
    expect(root.annotationDrafts.get("session")[0]?.body).toBe("Keep this newer note.");
    expect(root.composer.value()).toBe("newer instruction");
    expect(root.composer.error()).toBeUndefined();
    root.dispose();
  });

  it("keeps the selected session's failure when another failed session receives its echo", async () => {
    const prompt = vi.fn<Prompt>(() => Promise.reject(new Error("response lost")));
    const root = setup(prompt);
    try {
      root.setSelectedID("one");
      root.annotationDrafts.add("one", annotationInput);
      await root.composer.submit();
      const firstInput = prompt.mock.calls[0]![0];

      root.setSelectedID("two");
      root.annotationDrafts.add("two", annotationInput);
      await root.composer.submit();
      const secondInput = prompt.mock.calls[1]![0];
      expect(root.composer.error()).toContain("draft has been restored");

      root.setMessage("one", {
        id: firstInput.id!,
        type: "user",
        text: firstInput.text,
        metadata: firstInput.metadata,
        time: { created: 1 },
      });
      await vi.waitFor(() => expect(root.annotationDrafts.get("one")).toEqual([]));
      expect(root.annotationDrafts.get("two")).toHaveLength(1);
      expect(root.composer.error()).toContain("draft has been restored");

      root.setMessage("two", {
        id: secondInput.id!,
        type: "user",
        text: secondInput.text,
        metadata: secondInput.metadata,
        time: { created: 2 },
      });
      await vi.waitFor(() => expect(root.composer.error()).toBeUndefined());
      expect(root.annotationDrafts.get("two")).toEqual([]);
    } finally {
      root.dispose();
    }
  });

  it("restores a failed annotation to its origin session without showing another session's error", async () => {
    let rejectPrompt!: (cause: Error) => void;
    const prompt = vi.fn<Prompt>(
      () =>
        new Promise<PromptResult>((_resolve, reject) => {
          rejectPrompt = reject;
        }),
    );
    const root = setup(prompt);
    root.setSelectedID("one");
    root.annotationDrafts.add("one", annotationInput);
    const submission = root.composer.submit();
    root.setSelectedID("two");
    rejectPrompt(new Error("offline"));
    await submission;

    expect(root.composer.error()).toBeUndefined();
    root.setSelectedID("one");
    expect(root.annotationDrafts.get("one")).toHaveLength(1);
    root.dispose();
  });

  it("does not restore a row retained after the SDK rejects", async () => {
    let root!: ReturnType<typeof setup>;
    const prompt = vi.fn<Prompt>((input) => {
      root.setMessage("session", {
        id: input.id!,
        type: "user",
        text: input.text,
        metadata: input.metadata,
        time: { created: 1 },
      });
      return Promise.reject(new Error("response lost"));
    });
    root = setup(prompt);
    root.setSelectedID("session");
    root.annotationDrafts.add("session", annotationInput);

    await root.composer.submit();

    expect(root.annotationDrafts.get("session")).toEqual([]);
    expect(root.composer.error()).toBeUndefined();
    expect(prompt).toHaveBeenCalledTimes(1);
    root.dispose();
  });
});
