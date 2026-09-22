import { withTestWorkspace } from "../../../../test/workspace.ts";
import type { SessionInboxUser, SessionMessageInfo } from "@opencode/client";
import { createRoot, createSignal, onCleanup } from "solid-js";
import { Effect, Exit, Scope } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  createAnnotationDraftStore,
  createReviewDraftStore,
  type ReviewDraftKey,
} from "../../../../domain/index.ts";
import { SESSION_PROMPT_METADATA_KEY } from "../../../../opencode/session-prompt.ts";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_TEXT_ATTACHMENT_BYTES,
} from "../../../../opencode/attachments.ts";
import { createSessionComposer } from "./createSessionComposer.ts";

type ComposerInput = Parameters<typeof createSessionComposer>[0];
type Prompt = ComposerInput["runtime"]["data"]["session"]["prompt"];
type PromptInput = Parameters<Prompt>[0];
type PromptResult = SessionInboxUser;
type Command = ComposerInput["runtime"]["api"]["session"]["command"];
type Commands = ReturnType<ComposerInput["commands"]>;

/** Simulates a FileReader failure so the command never reaches the server. */
function readFailed(this: FileReader): void {
  this.dispatchEvent(new Event("error"));
}

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

function setup(
  prompt: Prompt = vi.fn<Prompt>((input) => Promise.resolve(promptResult(input))),
  command: Command = vi.fn<Command>(async () => undefined),
) {
  return withTestWorkspace((effects, dispose) => {
    const [selectedID, setSelectedID] = createSignal<string>();
    const [, setRunning] = createSignal(false);
    const [transcriptLoading, setTranscriptLoading] = createSignal(false);
    const [transcriptError, setTranscriptError] = createSignal<string>();
    const [connected, setConnected] = createSignal(true);
    const [selectionSwitching, setSelectionSwitching] = createSignal(false);
    const [reviewKey, setReviewKey] = createSignal<ReviewDraftKey>();
    const [commands, setCommands] = createSignal<Commands>({ state: "ready", items: [] });
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
          api: { session: { command } },
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
        commands,
        selectedID,
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
      setCommands,
      reviewDrafts,
      annotationDrafts,
      messages,
      setMessage,
      requestDiscard,
      prompt,
      command,
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
  it("preserves delivery on retry and creates a new ID when delivery changes", async () => {
    const prompt = vi.fn<Prompt>().mockRejectedValue(new Error("offline"));
    const root = setup(prompt);
    root.setSelectedID("session");
    root.setRunning(true);
    root.composer.input("Next task");
    await root.composer.submit("queue");
    const first = prompt.mock.calls[0]![0];
    expect(first.delivery).toBe("queue");
    await root.composer.submit("queue");
    expect(prompt.mock.calls[1]![0].id).toBe(first.id);
    await root.composer.submit();
    expect(prompt.mock.calls[2]![0].delivery).toBe("steer");
    expect(prompt.mock.calls[2]![0].id).not.toBe(first.id);
    root.dispose();
  });

  it("keeps pasted files per session and retries attachment-only sends with the same ID", async () => {
    const prompt = vi
      .fn<Prompt>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementation((input) => Promise.resolve(promptResult(input)));
    const root = setup(prompt);
    root.setSelectedID("session");
    const screenshot = new File(["image"], "screenshot.png", { type: "image/png" });
    const notes = new File(["notes"], "notes.txt", { type: "text/plain" });
    root.composer.attachFiles([screenshot, notes]);
    root.setSelectedID("other");
    expect(root.composer.files()).toEqual([]);
    root.setSelectedID("session");
    expect(root.composer.files()).toEqual([screenshot, notes]);
    await root.composer.submit();
    expect(root.composer.files()).toEqual([screenshot, notes]);
    expect(root.composer.error()).toBeDefined();
    await root.composer.submit();
    expect(prompt.mock.calls[1]?.[0]).toEqual(prompt.mock.calls[0]?.[0]);
    expect(prompt.mock.calls[0]?.[0].files).toEqual([
      { name: "screenshot.png", uri: "data:image/png;base64,aW1hZ2U=" },
      { name: "notes.txt", uri: "data:text/plain;base64,bm90ZXM=" },
    ]);
    expect(root.composer.files()).toEqual([]);
    root.dispose();
  });

  it("attaches pasted text under the byte cap with a unique name", () => {
    const root = setup();
    root.setSelectedID("session");
    root.composer.attachText("hello");
    const first = root.composer.files()[0];
    expect(first?.name).toBe("pasted-text.txt");
    expect(first?.type).toBe("text/plain");
    expect(first?.size).toBe(5);
    root.composer.attachText("second");
    expect(root.composer.files().map((file) => file.name)).toEqual([
      "pasted-text.txt",
      "pasted-text-2.txt",
    ]);
    expect(root.composer.pasteRecovery()).toBeUndefined();
    root.dispose();
  });

  it("keeps a text attachment with its originating session across navigation", () => {
    const root = setup();
    root.setSelectedID("session");
    root.composer.attachText("belongs to session");
    root.setSelectedID("other");
    expect(root.composer.files()).toEqual([]);
    root.composer.attachText("belongs to other");
    expect(root.composer.files().map((file) => file.name)).toEqual(["pasted-text.txt"]);
    root.setSelectedID("session");
    const [file] = root.composer.files();
    expect(file?.name).toBe("pasted-text.txt");
    expect(file?.size).toBe("belongs to session".length);
    root.dispose();
  });

  it("submits a text attachment that was just pasted", async () => {
    const prompt = vi.fn<Prompt>((input) => Promise.resolve(promptResult(input)));
    const root = setup(prompt);
    root.setSelectedID("session");
    root.composer.attachText("attached text");
    await root.composer.submit();
    expect(prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [
          {
            name: "pasted-text.txt",
            uri: `data:text/plain;base64,${btoa("attached text")}`,
          },
        ],
      }),
    );
    // A confirmed send consumes the attachment.
    expect(root.composer.files()).toEqual([]);
    root.dispose();
  });

  it("accepts text exactly at the 2 MiB UTF-8 byte cap", () => {
    const root = setup();
    root.setSelectedID("session");
    root.composer.attachText("a".repeat(MAX_TEXT_ATTACHMENT_BYTES));
    expect(root.composer.files()[0]?.size).toBe(MAX_TEXT_ATTACHMENT_BYTES);
    expect(root.composer.pasteRecovery()).toBeUndefined();
    root.dispose();
  });

  it("rejects text one byte over the cap and retains the source text", () => {
    const root = setup();
    root.setSelectedID("session");
    const over = "a".repeat(MAX_TEXT_ATTACHMENT_BYTES + 1);
    root.composer.attachText(over);
    expect(root.composer.files()).toEqual([]);
    const recovery = root.composer.pasteRecovery();
    expect(recovery?.message).toContain("2 MiB");
    // Taking the retained text is a one-time recovery.
    expect(recovery?.take()).toBe(over);
    expect(root.composer.pasteRecovery()).toBeUndefined();
    expect(root.composer.files()).toEqual([]);
    root.dispose();
  });

  it("counts the cap in UTF-8 bytes rather than characters", () => {
    const root = setup();
    root.setSelectedID("session");
    // 1,048,576 two-byte characters are exactly 2 MiB.
    const twoByte = "é".repeat(1_048_576);
    root.composer.attachText(twoByte);
    expect(root.composer.files()[0]?.size).toBe(MAX_TEXT_ATTACHMENT_BYTES);
    root.composer.removeFile(root.composer.files()[0]!);
    // One more byte fails even though the character count is far below the cap.
    root.composer.attachText(`${twoByte}a`);
    expect(root.composer.files()).toEqual([]);
    expect(root.composer.pasteRecovery()?.take()).toBe(`${twoByte}a`);

    // 524,288 four-byte code points are exactly 2 MiB; one more pair is over.
    const emoji = "😀".repeat(524_288);
    root.composer.attachText(emoji);
    expect(root.composer.files()[0]?.size).toBe(MAX_TEXT_ATTACHMENT_BYTES);
    root.composer.removeFile(root.composer.files()[0]!);
    root.composer.attachText(`${emoji}😀`);
    expect(root.composer.files()).toEqual([]);
    expect(root.composer.pasteRecovery()?.take()).toBe(`${emoji}😀`);
    root.dispose();
  });

  it("retains a rejected paste with its origin session and clears it with the session", () => {
    const root = setup();
    root.setSelectedID("session");
    const over = "a".repeat(MAX_TEXT_ATTACHMENT_BYTES + 1);
    root.composer.attachText(over);
    root.setSelectedID("other");
    expect(root.composer.pasteRecovery()).toBeUndefined();
    expect(root.composer.files()).toEqual([]);
    root.setSelectedID("session");
    expect(root.composer.files()).toEqual([]);
    expect(root.composer.pasteRecovery()?.take()).toBe(over);

    root.composer.attachText(over);
    root.composer.pasteRecovery()?.dismiss();
    expect(root.composer.pasteRecovery()).toBeUndefined();

    root.composer.attachText(over);
    root.composer.attachText("small");
    // A successful attachment replaces the recovery surface.
    expect(root.composer.pasteRecovery()).toBeUndefined();
    root.composer.clear("session");
    expect(root.composer.files()).toEqual([]);
    expect(root.composer.pasteRecovery()).toBeUndefined();
    root.dispose();
  });

  it("preserves files pasted during admission and completes after navigation", async () => {
    let resolvePrompt!: (result: PromptResult) => void;
    const prompt = vi.fn<Prompt>(
      () =>
        new Promise((resolve) => {
          resolvePrompt = resolve;
        }),
    );
    const root = setup(prompt);
    root.setSelectedID("session");
    const sent = new File(["first"], "first.txt");
    const next = new File(["next"], "next.txt");
    root.composer.attachFiles([sent]);
    const admission = root.composer.submit();
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce());
    root.composer.attachFiles([next]);
    root.setSelectedID("other");
    resolvePrompt(promptResult(prompt.mock.calls[0]![0]));
    await admission;
    root.setSelectedID("session");
    expect(root.composer.files()).toEqual([next]);
    root.composer.removeFile(next);
    expect(root.composer.files()).toEqual([]);
    root.dispose();
  });

  it("finishes reading and sending pasted files after the UI subscriber unmounts", async () => {
    const root = setup();
    root.setSelectedID("session");
    root.composer.attachFiles([new File(["notes"], "notes.txt", { type: "text/plain" })]);
    const admission = root.composer.submit();
    root.unmountComposer();
    await admission;
    expect(root.prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [{ name: "notes.txt", uri: "data:text/plain;base64,bm90ZXM=" }],
      }),
    );
    root.dispose();
  });

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
    expect(prompt).toHaveBeenCalledOnce();

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

describe("skill attachments", () => {
  const skills = [
    { id: "review-id", name: "review", mention: { start: 2, end: 8, text: "review" } },
  ];
  it("preserves skills per session and retries the identical payload with the same message ID", async () => {
    const prompt = vi
      .fn<Prompt>()
      .mockRejectedValueOnce(new Error("lost response"))
      .mockImplementation((input) => Promise.resolve(promptResult(input)));
    const root = setup(prompt);
    root.setSelectedID("one");
    root.composer.input("  review", skills);
    root.setSelectedID("two");
    expect(root.composer.skills()).toEqual([]);
    root.setSelectedID("one");
    expect(root.composer.skills()).toEqual(skills);
    await root.composer.submit("queue");
    expect(root.composer.skills()).toEqual(skills);
    await root.composer.submit("queue");
    expect(prompt.mock.calls[0]![0].skills).toEqual(skills);
    expect(prompt.mock.calls[1]![0].id).toBe(prompt.mock.calls[0]![0].id);
    expect(root.composer.skills()).toEqual([]);
    root.dispose();
  });
  it("keeps a changed skill selection when admission succeeds with identical text", async () => {
    let resolve!: (value: PromptResult) => void;
    const prompt = vi.fn<Prompt>(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const root = setup(prompt);
    root.setSelectedID("one");
    root.composer.input("  review", skills);
    const sending = root.composer.submit();
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce());
    const newer = [{ ...skills[0]!, id: "other-review" }];
    root.composer.input("  review", newer);
    resolve(promptResult(prompt.mock.calls[0]![0]));
    await sending;
    expect(root.composer.value()).toBe("  review");
    expect(root.composer.skills()).toEqual(newer);
    root.dispose();
  });
  it("adjusts mention offsets when review formatting trims leading whitespace", async () => {
    const root = setup();
    seedReview(root);
    root.composer.input("  review", skills);
    await root.composer.submit();
    expect(vi.mocked(root.prompt).mock.calls[0]![0].skills).toEqual([
      { ...skills[0], mention: { start: 0, end: 6, text: "review" } },
    ]);
    root.dispose();
  });
});

describe("command submissions", () => {
  const inventory = { state: "ready" as const, items: [{ name: "review" }] };
  const settle = () => vi.fn<Command>(async () => undefined);

  it("runs a known command with arguments and clears the draft on success", async () => {
    const command = settle();
    const root = setup(undefined, command);
    root.setSelectedID("session");
    root.setCommands(inventory);
    root.composer.input("/review the changes");
    expect(root.composer.command()).toBe("review");

    await root.composer.submit("queue");

    expect(command).toHaveBeenCalledOnce();
    const [input, options] = command.mock.calls[0]!;
    expect(input).toEqual({
      sessionID: "session",
      command: "review",
      text: "the changes",
      skills: undefined,
      files: undefined,
      delivery: "queue",
    });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(root.prompt).not.toHaveBeenCalled();
    expect(root.composer.value()).toBe("");
    expect(root.composer.error()).toBeUndefined();
    root.dispose();
  });

  it("forwards files and strips skill mention offsets", async () => {
    const command = settle();
    const root = setup(undefined, command);
    root.setSelectedID("session");
    root.setCommands(inventory);
    root.composer.attachFiles([new File(["notes"], "notes.txt", { type: "text/plain" })]);
    root.composer.input("/review review", [
      { id: "review-id", name: "review", mention: { start: 8, end: 14, text: "review" } },
    ]);

    await root.composer.submit();

    expect(command.mock.calls[0]![0]).toMatchObject({
      text: "review",
      skills: [{ id: "review-id" }],
      files: [{ name: "notes.txt", uri: "data:text/plain;base64,bm90ZXM=" }],
    });
    expect(root.composer.value()).toBe("");
    expect(root.composer.skills()).toEqual([]);
    expect(root.composer.files()).toEqual([]);
    root.dispose();
  });

  it("keeps review comments and annotations attached when a command runs", async () => {
    const command = settle();
    const root = setup(undefined, command);
    const { key } = seedReview(root);
    root.annotationDrafts.add("session", annotationInput);
    root.setCommands(inventory);
    root.composer.input("/review");

    await root.composer.submit();

    expect(command).toHaveBeenCalledOnce();
    expect(root.prompt).not.toHaveBeenCalled();
    expect(root.reviewDrafts.get(key).comments).toHaveLength(1);
    expect(root.annotationDrafts.get("session")).toHaveLength(1);
    expect(root.composer.value()).toBe("");
    root.dispose();
  });

  it("restores the draft and reports an uncertain command failure", async () => {
    const command = vi.fn<Command>(() => Promise.reject(new Error("lost")));
    const root = setup(undefined, command);
    root.setSelectedID("session");
    root.setCommands(inventory);
    root.composer.input("/review keep");

    await root.composer.submit();

    expect(root.composer.value()).toBe("/review keep");
    expect(root.composer.error()).toContain("Couldn't confirm the command completed");
    expect(root.composer.submitting()).toBe(false);
    root.dispose();
  });

  it("reports an unread attachment without dispatching the command", async () => {
    const spy = vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(readFailed);
    try {
      const command = settle();
      const root = setup(undefined, command);
      root.setSelectedID("session");
      root.setCommands(inventory);
      root.composer.attachFiles([new File(["notes"], "notes.txt", { type: "text/plain" })]);
      root.composer.input("/review");

      await root.composer.submit();

      expect(command).not.toHaveBeenCalled();
      expect(root.composer.error()).toContain("command was not sent");
      expect(root.composer.files()).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("reports an unread prompt attachment without dispatching the prompt", async () => {
    const spy = vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(readFailed);
    try {
      const prompt = vi.fn<Prompt>();
      const root = setup(prompt);
      root.setSelectedID("session");
      root.composer.attachFiles([new File(["notes"], "notes.txt", { type: "text/plain" })]);

      await root.composer.submit();

      expect(prompt).not.toHaveBeenCalled();
      expect(root.composer.error()).toContain('Couldn\'t read "notes.txt"');
      expect(root.composer.files()).toHaveLength(1);
      root.dispose();
    } finally {
      spy.mockRestore();
    }
  });

  it("rejects an oversized attachment before reading and keeps the valid ones", () => {
    const root = setup();
    root.setSelectedID("session");
    const notes = new File(["notes"], "notes.txt", { type: "text/plain" });
    const large = new File(["x"], "large.bin");
    Object.defineProperty(large, "size", { value: MAX_ATTACHMENT_BYTES + 1 });

    root.composer.attachFiles([notes, large]);

    expect(root.composer.files()).toEqual([notes]);
    expect(root.composer.error()).toContain("large.bin");
    expect(root.composer.error()).toContain("20 MiB");

    root.composer.attachFiles([new File(["more"], "more.txt", { type: "text/plain" })]);
    expect(root.composer.error()).toBeUndefined();
    root.dispose();
  });

  it("never stores the same File object twice", () => {
    const root = setup();
    root.setSelectedID("session");
    const notes = new File(["notes"], "notes.txt", { type: "text/plain" });
    const other = new File(["other"], "other.txt", { type: "text/plain" });

    root.composer.attachFiles([notes, notes, other]);
    root.composer.attachFiles([notes]);

    expect(root.composer.files()).toEqual([notes, other]);
    root.dispose();
  });

  it("does not mask a later network failure with an earlier attachment read error", async () => {
    const spy = vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(readFailed);
    const prompt = vi.fn<Prompt>().mockRejectedValue(new Error("offline"));
    const root = setup(prompt);
    root.setSelectedID("session");
    root.composer.attachFiles([new File(["notes"], "notes.txt", { type: "text/plain" })]);

    await root.composer.submit();
    expect(root.composer.error()).toContain('Couldn\'t read "notes.txt"');
    spy.mockRestore();

    await root.composer.submit();
    expect(prompt).toHaveBeenCalledOnce();
    expect(root.composer.error()).toContain("Couldn't confirm the message was sent");
    root.dispose();
  });

  it("does not mask a later network failure with an oversized attachment notice", async () => {
    const prompt = vi.fn<Prompt>().mockRejectedValue(new Error("offline"));
    const root = setup(prompt);
    root.setSelectedID("session");
    const large = new File(["x"], "large.bin");
    Object.defineProperty(large, "size", { value: MAX_ATTACHMENT_BYTES + 1 });

    root.composer.attachFiles([large]);
    root.composer.input("go");
    await root.composer.submit();

    expect(prompt).toHaveBeenCalledOnce();
    expect(root.composer.error()).toContain("Couldn't confirm the message was sent");
    expect(root.composer.error()).not.toContain("large.bin");
    root.dispose();
  });

  it("clears a command attachment error when the file is removed", async () => {
    const spy = vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(readFailed);
    try {
      const command = settle();
      const root = setup(undefined, command);
      root.setSelectedID("session");
      root.setCommands(inventory);
      const notes = new File(["notes"], "notes.txt", { type: "text/plain" });
      root.composer.attachFiles([notes]);
      root.composer.input("/review");

      await root.composer.submit();
      expect(root.composer.error()).toContain("command was not sent");

      root.composer.removeFile(notes);
      expect(root.composer.error()).toBeUndefined();
      root.dispose();
    } finally {
      spy.mockRestore();
    }
  });

  it("keeps a newer attachment notice when an older request's echo arrives", async () => {
    let firstInput!: PromptInput;
    const prompt = vi.fn<Prompt>((input) => {
      firstInput = input;
      return Promise.reject(new Error("response lost"));
    });
    const root = setup(prompt);
    root.setSelectedID("session");
    root.composer.input("first");

    await root.composer.submit();
    expect(root.composer.error()).toContain("draft has been restored");

    const large = new File(["x"], "large.bin");
    Object.defineProperty(large, "size", { value: MAX_ATTACHMENT_BYTES + 1 });
    root.composer.attachFiles([large]);
    expect(root.composer.error()).toContain("large.bin");

    root.setMessage("session", {
      id: firstInput.id!,
      type: "user",
      text: firstInput.text,
      metadata: firstInput.metadata,
      time: { created: 1 },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(root.composer.error()).toContain("large.bin");
    root.dispose();
  });

  it("does not claim a retry was not sent while an earlier attempt is uncertain", async () => {
    let firstInput!: PromptInput;
    const prompt = vi.fn<Prompt>((input) => {
      firstInput = input;
      return Promise.reject(new Error("response lost"));
    });
    const root = setup(prompt);
    root.setSelectedID("session");
    root.composer.attachFiles([new File(["notes"], "notes.txt", { type: "text/plain" })]);

    await root.composer.submit();
    expect(root.composer.error()).toContain("draft has been restored");

    const spy = vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(readFailed);
    try {
      await root.composer.submit();
      expect(root.composer.error()).toContain('Couldn\'t read "notes.txt"');
      expect(root.composer.error()).not.toContain("was not sent");
    } finally {
      spy.mockRestore();
    }

    root.setMessage("session", {
      id: firstInput.id!,
      type: "user",
      text: firstInput.text,
      metadata: firstInput.metadata,
      time: { created: 1 },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(root.composer.error()).toBeUndefined();
    root.dispose();
  });

  it("blocks a leading slash until the inventory is ready", async () => {
    const command = settle();
    const root = setup(undefined, command);
    root.setSelectedID("session");
    root.setCommands({ state: "loading", items: [] });
    root.composer.input("/review");

    await root.composer.submit();

    expect(command).not.toHaveBeenCalled();
    expect(root.prompt).not.toHaveBeenCalled();
    expect(root.composer.error()).toContain("still loading");

    root.setCommands(inventory);
    expect(root.composer.error()).toBeUndefined();

    await root.composer.submit();
    expect(command).toHaveBeenCalledOnce();
    root.dispose();
  });

  it("updates and clears the blocked inventory notice as the inventory changes", async () => {
    const command = settle();
    const root = setup(undefined, command);
    root.setSelectedID("session");
    root.setCommands({ state: "loading", items: [] });
    root.composer.input("/review");
    await root.composer.submit();
    expect(root.composer.error()).toContain("still loading");

    root.setCommands({ state: "failed", items: [] });
    expect(root.composer.error()).toContain("couldn't be loaded");

    root.setCommands(inventory);
    expect(root.composer.error()).toBeUndefined();
    root.dispose();
  });

  it("shows a blocked notice instead of an older prompt failure", async () => {
    const prompt = vi.fn<Prompt>(() => Promise.reject(new Error("offline")));
    const root = setup(prompt);
    root.setSelectedID("session");
    root.composer.input("keep me");
    await root.composer.submit();
    expect(root.composer.error()).toContain("draft has been restored");

    root.setCommands({ state: "loading", items: [] });
    root.composer.input("/review");
    await root.composer.submit();

    expect(prompt).toHaveBeenCalledTimes(1);
    expect(root.composer.error()).toContain("still loading");
    root.dispose();
  });

  it("still reconciles a failed prompt echo after a blocked command attempt", async () => {
    const prompt = vi.fn<Prompt>(() => Promise.reject(new Error("offline")));
    const root = setup(prompt);
    root.setSelectedID("session");
    root.annotationDrafts.add("session", annotationInput);
    root.composer.input("keep me");
    await root.composer.submit();
    expect(root.composer.error()).toContain("draft has been restored");

    root.setCommands({ state: "loading", items: [] });
    root.composer.input("/review");
    await root.composer.submit();
    expect(root.composer.error()).toContain("still loading");

    const submitted = prompt.mock.calls[0]![0];
    root.setMessage("session", {
      id: submitted.id!,
      type: "user",
      text: submitted.text,
      metadata: submitted.metadata,
      time: { created: 1 },
    });
    await vi.waitFor(() => expect(root.annotationDrafts.get("session")).toEqual([]));
    root.dispose();
  });

  it("sends an unknown leading slash as a prompt once the inventory is ready", async () => {
    const command = settle();
    const root = setup(undefined, command);
    root.setSelectedID("session");
    root.setCommands(inventory);
    root.composer.input("/unknown hi");
    expect(root.composer.command()).toBeUndefined();

    await root.composer.submit();

    expect(command).not.toHaveBeenCalled();
    expect(root.prompt).toHaveBeenCalledWith(expect.objectContaining({ text: "/unknown hi" }));
    root.dispose();
  });

  it("forgets a superseded failed prompt instead of reconciling a later echo", async () => {
    const prompt = vi.fn<Prompt>(() => Promise.reject(new Error("offline")));
    const command = settle();
    const root = setup(prompt, command);
    root.setSelectedID("session");
    root.annotationDrafts.add("session", annotationInput);
    root.composer.input("keep me");
    await root.composer.submit();
    expect(root.composer.error()).toContain("draft has been restored");

    root.setCommands(inventory);
    root.composer.input("/review");
    await root.composer.submit();
    expect(command).toHaveBeenCalledOnce();
    expect(root.composer.error()).toBeUndefined();

    root.annotationDrafts.add("session", { ...annotationInput, body: "newer note" });
    const superseded = prompt.mock.calls[0]![0];
    root.setMessage("session", {
      id: superseded.id!,
      type: "user",
      text: superseded.text,
      metadata: superseded.metadata,
      time: { created: 1 },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(root.annotationDrafts.get("session").map((draft) => draft.body)).toEqual([
      annotationInput.body,
      "newer note",
    ]);
    root.dispose();
  });

  it("keeps edits made while command admission is in flight", async () => {
    let resolve!: () => void;
    const command = vi.fn<Command>(
      (_input, options) =>
        new Promise<void>((done, reject) => {
          resolve = done;
          options?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const root = setup(undefined, command);
    root.setSelectedID("session");
    root.setCommands(inventory);
    root.composer.input("/review submitted");
    const submission = root.composer.submit();
    await vi.waitFor(() => expect(command).toHaveBeenCalledOnce());

    root.composer.input("/review edited");
    resolve();
    await submission;

    expect(root.composer.value()).toBe("/review edited");
    expect(root.composer.submitting()).toBe(false);
    root.dispose();
  });

  it("removes only the submitted file identities from a successful command", async () => {
    let resolve!: () => void;
    const command = vi.fn<Command>(
      (_input, options) =>
        new Promise<void>((done, reject) => {
          resolve = done;
          options?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const root = setup(undefined, command);
    root.setSelectedID("session");
    root.setCommands(inventory);
    const sent = new File(["sent"], "sent.txt", { type: "text/plain" });
    const next = new File(["next"], "next.txt", { type: "text/plain" });
    root.composer.attachFiles([sent]);
    root.composer.input("/review");
    const submission = root.composer.submit();
    await vi.waitFor(() => expect(command).toHaveBeenCalledOnce());

    root.composer.attachFiles([next]);
    resolve();
    await submission;

    expect(root.composer.files()).toEqual([next]);
    root.dispose();
  });

  it("ignores a command result after the session is cleared", async () => {
    let resolve!: () => void;
    const command = vi.fn<Command>(
      (_input, options) =>
        new Promise<void>((done, reject) => {
          resolve = done;
          options?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const root = setup(undefined, command);
    root.setSelectedID("session");
    root.setCommands(inventory);
    root.composer.input("/review");
    const submission = root.composer.submit();
    await vi.waitFor(() => expect(command).toHaveBeenCalledOnce());

    root.composer.clear("session");
    root.composer.input("/review newer");
    resolve();
    await submission;

    expect(root.composer.value()).toBe("/review newer");
    expect(root.composer.error()).toBeUndefined();
    root.dispose();
  });

  it("does not start a second submission while a command is active", async () => {
    const command = vi.fn<Command>(
      (_input, options) =>
        new Promise<void>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const root = setup(undefined, command);
    root.setSelectedID("session");
    root.setCommands(inventory);
    root.composer.input("/review");
    void root.composer.submit().catch(() => undefined);
    await vi.waitFor(() => expect(command).toHaveBeenCalledOnce());

    await root.composer.submit();

    expect(command).toHaveBeenCalledOnce();
    root.dispose();
  });

  it("aborts and settles command admission when the workspace shuts down", async () => {
    let aborted = false;
    const command = vi.fn<Command>(
      (_input, options) =>
        new Promise<void>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("aborted"));
          });
        }),
    );
    const root = setup(undefined, command);
    root.setSelectedID("session");
    root.setCommands(inventory);
    root.composer.input("/review");
    const admission = root.composer.submit().catch(() => undefined);
    await vi.waitFor(() => expect(command).toHaveBeenCalledOnce());

    await Effect.runPromise(Scope.close(root.effects.scope, Exit.void));
    await admission;

    expect(aborted).toBe(true);
    expect(root.composer.value()).toBe("/review");
    root.dispose();
  });

  it("keeps a command failure for another session out of the selected session", async () => {
    let reject!: (cause: Error) => void;
    const command = vi.fn<Command>(
      (_input, options) =>
        new Promise<void>((_resolve, error) => {
          reject = error;
          options?.signal?.addEventListener("abort", () => error(new Error("aborted")));
        }),
    );
    const root = setup(undefined, command);
    root.setSelectedID("one");
    root.setCommands(inventory);
    root.composer.input("/review");
    const submission = root.composer.submit();
    await vi.waitFor(() => expect(command).toHaveBeenCalledOnce());

    root.setSelectedID("two");
    reject(new Error("lost"));
    await submission;

    expect(root.composer.error()).toBeUndefined();
    root.setSelectedID("one");
    // Command failures are session-transient, matching prompt failure policy.
    expect(root.composer.value()).toBe("/review");
    expect(root.composer.error()).toBeUndefined();
    root.dispose();
  });
});

describe("annotation batches", () => {
  it("appends text and screenshots without dropping skill mentions", () => {
    const root = setup();
    root.setSelectedID("one");
    root.composer.input("  review the pricing page", [
      { id: "review-id", name: "review", mention: { start: 2, end: 8, text: "review" } },
    ]);
    const screenshot = new File([new Uint8Array([1, 2, 3])], "annotation-1.png", {
      type: "image/png",
    });
    root.composer.appendBatch("one", "### Annotation 1: make it wider", [screenshot]);
    expect(root.composer.value()).toBe(
      "  review the pricing page\n\n### Annotation 1: make it wider",
    );
    expect(root.composer.skills()).toHaveLength(1);
    expect(root.composer.files()).toEqual([screenshot]);
    root.dispose();
  });

  it("rejects an incomplete batch without changing the draft", () => {
    const root = setup();
    root.setSelectedID("one");
    root.composer.input("keep this");
    const screenshot = new File([new Uint8Array([1])], "annotation-1.png", {
      type: "image/png",
    });
    expect(() => root.composer.appendBatch("one", "   ", [screenshot])).toThrow(/comment/);
    expect(() => root.composer.appendBatch("one", "note", [])).toThrow(/screenshot/);
    expect(root.composer.value()).toBe("keep this");
    expect(root.composer.files()).toEqual([]);
    root.dispose();
  });
});
