import type { SessionMessageAssistantTool, ToolContent } from "@opencode/client";
import { describe, expect, it } from "vite-plus/test";

import { mount } from "../../../../../../../../test/mount.ts";
import { ToolCall } from "./ToolCall.tsx";

const preview = (name: string, mime = "image/png"): ToolContent => ({
  type: "file",
  name: `${name}.png`,
  mime,
  uri: `data:${mime};base64,PREVIEW-${name}`,
});
const original = (name: string): ToolContent => ({
  type: "file",
  name: `${name}.original.png`,
  mime: "application/octet-stream",
  uri: `data:application/octet-stream;base64,iVBORw0KGgo-${name}`,
});

function renderContents(content: [ToolContent, ...ToolContent[]]) {
  const tool: SessionMessageAssistantTool = {
    type: "tool",
    id: "image-execute",
    name: "execute",
    time: { created: 1 },
    state: { status: "completed", input: {}, content },
  };
  const mounted = mount(() => <ToolCall tool={tool} />);
  mounted.host.querySelector<HTMLButtonElement>(".transcript-tool-header")!.click();
  return mounted;
}

describe("tool image attachments", () => {
  it("leaves generated images to the transcript while retaining mixed tool output", () => {
    const name = "ocui-image-00000000000000000000000001";
    const mounted = renderContents([
      preview(name),
      original(name),
      { type: "text", text: "Other tool output" },
      preview("browser-capture"),
    ]);
    try {
      expect(mounted.host.querySelectorAll(".transcript-tool-image-thumbnail")).toHaveLength(1);
      expect(mounted.host.textContent).toContain("browser-capture.png");
      expect(mounted.host.textContent).toContain("Other tool output");
      expect(mounted.host.textContent).not.toContain(name);
    } finally {
      mounted.dispose();
    }
  });

  it("pairs PNG and JPEG-normalized previews with their own distinct originals", () => {
    const mounted = renderContents([
      preview("first"),
      original("first"),
      preview("second", "image/jpeg"),
      original("second"),
    ]);
    try {
      const thumbnails = mounted.host.querySelectorAll<HTMLButtonElement>(
        ".transcript-tool-image-thumbnail",
      );
      expect(thumbnails).toHaveLength(2);
      for (const [index, name] of ["first", "second"].entries()) {
        thumbnails[index]!.click();
        expect(document.querySelector(".image-preview-image")?.getAttribute("src")).toBe(
          `data:image/png;base64,iVBORw0KGgo-${name}`,
        );
        document.querySelector<HTMLButtonElement>(".image-preview-close")!.click();
      }
    } finally {
      mounted.dispose();
    }
  });

  it("keeps mismatched originals and originals without previews independently viewable", () => {
    const mounted = renderContents([
      preview("unmatched"),
      original("different"),
      { type: "text", text: "An omitted preview does not remove its original" },
      original("solo"),
    ]);
    try {
      const thumbnails = mounted.host.querySelectorAll<HTMLButtonElement>(
        ".transcript-tool-image-thumbnail",
      );
      expect(thumbnails).toHaveLength(3);
      for (const [index, source] of [
        "data:image/png;base64,PREVIEW-unmatched",
        "data:image/png;base64,iVBORw0KGgo-different",
        "data:image/png;base64,iVBORw0KGgo-solo",
      ].entries()) {
        thumbnails[index]!.click();
        expect(document.querySelector(".image-preview-image")?.getAttribute("src")).toBe(source);
        document.querySelector<HTMLButtonElement>(".image-preview-close")!.click();
      }
    } finally {
      mounted.dispose();
    }
  });
});
