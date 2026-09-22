import { describe, expect, it, vi } from "vite-plus/test";
import type {
  BrowserAnnotatorMessage,
  BrowserAnnotatorReply,
} from "../../../shared/browser-annotator.ts";
import { requestAnnotationComment, type AnnotationCommentTransport } from "./annotation-comment.ts";

const anchor = { x: 40, y: 60, width: 200, height: 40 };

function setup() {
  const sent: BrowserAnnotatorMessage[] = [];
  let listener: ((reply: BrowserAnnotatorReply) => void) | undefined;
  const transport: AnnotationCommentTransport = {
    send: (message) => {
      sent.push(message);
    },
    onReply: (next) => {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
    focus: vi.fn(),
  };
  const controller = new AbortController();
  const start = (options?: { openTimeoutMs?: number }) =>
    requestAnnotationComment(transport, anchor, controller.signal, {
      openTimeoutMs: 40,
      ...options,
    });
  const reply = (value: BrowserAnnotatorReply) => listener?.(value);
  const closes = () => sent.filter((item) => item._tag === "close").length;
  return { start, reply, closes, abort: () => controller.abort(), focus: transport.focus };
}

describe("annotation comment exchange", () => {
  it("returns a saved comment and closes the interaction", async () => {
    const fixture = setup();
    const pending = fixture.start();
    fixture.reply({ _tag: "opened" });
    fixture.reply({ _tag: "save", body: "Tighten the spacing" });
    await expect(pending).resolves.toBe("Tighten the spacing");
    expect(fixture.closes()).toBe(1);
  });

  it("returns undefined when the user cancels", async () => {
    const fixture = setup();
    const pending = fixture.start();
    fixture.reply({ _tag: "opened" });
    fixture.reply({ _tag: "cancel" });
    await expect(pending).resolves.toBeUndefined();
  });

  it("fails with a message when the editor never acknowledges", async () => {
    const fixture = setup();
    await expect(fixture.start({ openTimeoutMs: 20 })).rejects.toThrow(
      "The comment box did not open. Select the element again.",
    );
    expect(fixture.closes()).toBe(1);
  });

  it("cancels when the interaction is interrupted", async () => {
    const fixture = setup();
    const pending = fixture.start();
    fixture.reply({ _tag: "opened" });
    fixture.abort();
    await expect(pending).resolves.toBeUndefined();
    expect(fixture.closes()).toBe(1);
  });

  it("keeps waiting after a duplicate open and accepts the comment", async () => {
    const fixture = setup();
    const pending = fixture.start();
    fixture.reply({ _tag: "opened" });
    fixture.reply({ _tag: "opened" });
    fixture.reply({ _tag: "save", body: "right" });
    await expect(pending).resolves.toBe("right");
  });

  it("fails when the transport refuses to open", async () => {
    const transport: AnnotationCommentTransport = {
      send: () => {
        throw new Error("no renderer");
      },
      onReply: () => () => undefined,
      focus: () => undefined,
    };
    await expect(
      requestAnnotationComment(transport, anchor, new AbortController().signal),
    ).rejects.toThrow("The comment box is unavailable. Select the element again.");
  });
});
