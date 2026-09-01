import type { SessionInboxUser } from "@opencode-ai/client";
import { createRoot, createSignal } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";

import { createReviewDraftStore, type ReviewDraftKey } from "../../../../domain/index.ts";
import { CODE_REVIEW_METADATA_KEY } from "../../../../opencode/code-review.ts";
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

function setup(prompt: Prompt = vi.fn<Prompt>((input) => Promise.resolve(promptResult(input)))) {
  return createRoot((dispose) => {
    const [selectedID, setSelectedID] = createSignal<string>();
    const [running, setRunning] = createSignal(false);
    const [transcriptLoading, setTranscriptLoading] = createSignal(false);
    const [connected, setConnected] = createSignal(true);
    const [selectionSwitching, setSelectionSwitching] = createSignal(false);
    const [reviewKey, setReviewKey] = createSignal<ReviewDraftKey>();
    const reviewDrafts = createReviewDraftStore();
    const requestDiscard =
      vi.fn<(key: ReviewDraftKey, count: number, opener: HTMLButtonElement) => void>();
    const composer = createSessionComposer({
      runtime: { data: { session: { prompt } } },
      selectedID,
      running,
      transcriptLoading,
      connected,
      selectionSwitching,
      review: { drafts: reviewDrafts, key: reviewKey, requestDiscard },
    });
    return {
      dispose,
      composer,
      setSelectedID,
      setRunning,
      setTranscriptLoading,
      setConnected,
      setSelectionSwitching,
      setReviewKey,
      reviewDrafts,
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
  it("keeps drafts per session and clears only the submitted draft", async () => {
    const prompt = vi.fn<Prompt>((input) => Promise.resolve(promptResult(input)));
    const root = setup(prompt);
    root.setSelectedID("one");
    root.composer.input("first");
    root.setSelectedID("two");
    root.composer.input("second");
    root.setSelectedID("one");

    await root.composer.submit();

    expect(prompt).toHaveBeenCalledWith({ sessionID: "one", text: "first" });
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

  it("keeps a failed draft and exposes the current prompt error", async () => {
    const prompt = vi.fn<Prompt>(() => Promise.reject(new Error("offline")));
    const root = setup(prompt);
    root.setSelectedID("session");
    root.composer.input("keep me");

    await root.composer.submit();

    expect(root.composer.value()).toBe("keep me");
    expect(root.composer.error()).toBe("The prompt was not admitted. Your draft has been kept.");
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
    expect(prompt).toHaveBeenCalledWith({ sessionID: "session", text: "message" });
    root.dispose();
  });

  it("submits a review without composer text through one prompt with versioned metadata", async () => {
    const prompt = vi.fn<Prompt>((input) => Promise.resolve(promptResult(input)));
    const root = setup(prompt);
    const { key } = seedReview(root);

    expect(root.composer.review()).toMatchObject({ count: 1 });
    await root.composer.submit();

    expect(prompt).toHaveBeenCalledTimes(1);
    expect(prompt).toHaveBeenCalledWith({
      sessionID: "session",
      text: expect.stringContaining("## Code review"),
      metadata: {
        [CODE_REVIEW_METADATA_KEY]: expect.objectContaining({
          kind: "code-review",
          version: 1,
          instruction: "",
        }),
      },
    });
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
});
