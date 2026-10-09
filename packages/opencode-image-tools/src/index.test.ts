import { Message } from "@opencode/ai";
import { describe, expect, it } from "vite-plus/test";

import { modelMessages } from "./index.js";

describe("original image attachments in model context", () => {
  it("keeps original bytes in stored content while sending previews and unrelated files", () => {
    const preview = {
      type: "file",
      mime: "image/png",
      name: "otter.png",
      uri: "data:image/png;base64,iVBORw0KGgoAAA",
    } as const;
    const original = {
      type: "file",
      mime: "application/octet-stream",
      name: "otter.original.png",
      uri: "data:application/octet-stream;base64,iVBORw0KGgoFULL",
    } as const;
    const unrelated = { ...original, name: "unrelated.bin" };
    const messages = [
      Message.tool({
        id: "call-execute",
        name: "execute",
        resultType: "content",
        result: [{ type: "text", text: "Saved" }, preview, original, unrelated],
      }),
      Message.user("Describe the image"),
    ];
    const outgoing = modelMessages(messages);
    expect(outgoing[0]!.content[0]).toMatchObject({
      type: "tool-result",
      result: { type: "content", value: [{ type: "text", text: "Saved" }, preview, unrelated] },
    });
    expect(messages[0]!.content[0]).toMatchObject({
      result: { value: [{ type: "text", text: "Saved" }, preview, original, unrelated] },
    });
    expect(outgoing[1]).toEqual(messages[1]);
  });
});
