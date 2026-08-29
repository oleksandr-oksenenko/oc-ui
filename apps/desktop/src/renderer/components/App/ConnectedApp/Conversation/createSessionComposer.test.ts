import type { SessionInboxUser } from "@opencode-ai/client";
import { createRoot, createSignal } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";

import { createSessionComposer } from "./createSessionComposer.ts";

type ComposerInput = Parameters<typeof createSessionComposer>[0];
type Prompt = ComposerInput["runtime"]["data"]["session"]["prompt"];
type PromptInput = Parameters<Prompt>[0];
type PromptResult = SessionInboxUser;

const promptResult = ({ sessionID, text }: PromptInput): PromptResult => ({
  id: "prompt",
  sessionID,
  timeCreated: 0,
  type: "user",
  payload: { text },
  delivery: "queue",
});

function setup(prompt: Prompt = vi.fn<Prompt>((input) => Promise.resolve(promptResult(input)))) {
  return createRoot((dispose) => {
    const [selectedID, setSelectedID] = createSignal<string>();
    const [running, setRunning] = createSignal(false);
    const [transcriptLoading, setTranscriptLoading] = createSignal(false);
    const [connected, setConnected] = createSignal(true);
    const composer = createSessionComposer({
      runtime: { data: { session: { prompt } } },
      selectedID,
      running,
      transcriptLoading,
      connected,
    });
    return {
      dispose,
      composer,
      setSelectedID,
      setRunning,
      setTranscriptLoading,
      setConnected,
      prompt,
    };
  });
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
});
