import type {
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageInfo,
  ToolContent,
  ToolFileContent,
} from "@opencode/client";
import { describe, expect, it } from "vite-plus/test";

import { projectGeneratedImages } from "./generatedImages.ts";

const first = "ocui-image-00000000000000000000000001";
const second = "ocui-image-00000000000000000000000002";
const reference = (name = first) => `attachment:${name}`;
const preview = (name = first): ToolFileContent => ({
  type: "file",
  name: `${name}.png`,
  mime: "image/jpeg",
  uri: "data:image/jpeg;base64,PREVIEW",
});
const original = (name = first): ToolContent => ({
  type: "file",
  name: `${name}.original.png`,
  mime: "application/octet-stream",
  uri: "data:application/octet-stream;base64,iVBORw0KGgoFULL",
});
const tool = (
  id: string,
  content: [ToolContent, ...ToolContent[]],
): SessionMessageAssistantTool => ({
  type: "tool",
  id,
  name: "execute",
  time: { created: 1 },
  state: { status: "completed", input: {}, content },
});
const assistant = (
  id: string,
  content: SessionMessageAssistant["content"],
): SessionMessageAssistant => ({
  type: "assistant",
  id,
  agent: "build",
  model: { providerID: "p", id: "m" },
  time: { created: 1 },
  content,
});
const text = (value: string) => ({ type: "text" as const, text: value });
const idle: SessionMessageInfo = {
  type: "idle",
  id: "idle",
  time: { created: 1 },
  outcome: "succeeded",
};

describe("generated image projection", () => {
  it("pairs by identity despite normalization, interleaved files, and missing previews", () => {
    const projection = projectGeneratedImages([
      assistant("producer", [
        tool("batch", [
          preview(),
          { type: "text", text: "Other tool output" },
          original(second),
          original(),
        ]),
      ]),
      assistant("answer", [text(`![One](${reference()})\n\n![Two](${reference(second)})`)]),
    ]);
    expect(projection.resolve("answer", 0, reference())).toMatchObject({
      src: "data:image/jpeg;base64,PREVIEW",
      fullSrc: "data:image/png;base64,iVBORw0KGgoFULL",
    });
    expect(projection.resolve("answer", 0, reference(second))?.src).toBe(
      "data:image/png;base64,iVBORw0KGgoFULL",
    );
    expect(projection.fallback.size).toBe(0);
  });

  it("resolves only preceding tools and never guesses a future or another session's image", () => {
    const message = assistant("same", [
      text(`![Too soon](${reference()})`),
      tool("source", [preview(), original()]),
      text(`![Now](${reference()})`),
    ]);
    const projection = projectGeneratedImages([message]);
    expect(projection.resolve("same", 0, reference())).toBeUndefined();
    expect(projection.resolve("same", 2, reference())?.src).toBeDefined();
    expect(projection.resolve("unknown", 2, reference())).toBeUndefined();
    expect(
      projectGeneratedImages([
        assistant("another-session", [text(`![No](${reference()})`)]),
      ]).resolve("another-session", 0, reference()),
    ).toBeUndefined();
  });

  it("keeps fallback for code examples, omitted references, and later-turn reuse", () => {
    const projection = projectGeneratedImages([
      assistant("producer", [tool("source", [original()])]),
      assistant("example", [text(`\`\`\`md\n![Example](${reference()})\n\`\`\``)]),
      idle,
      assistant("later", [text(`![Show again](${reference()})`)]),
    ]);
    expect(projection.fallback.get("producer")).toHaveLength(1);
    expect(projection.resolve("later", 0, reference())?.src).toBeDefined();
  });

  it("shows a generated image after Code Mode failure", () => {
    const source = tool("source", [original(), preview("browser-capture")]);
    source.state = {
      ...source.state,
      status: "error",
      input: {},
      error: { type: "tool", message: "After generation" },
      content: [original(), preview("browser-capture")],
    };
    const projection = projectGeneratedImages([assistant("failed", [source])]);
    expect(projection.fallback.get("failed")?.[0]?.src).toBeDefined();
    expect(projection.fallback.get("failed")).toHaveLength(1);
  });

  it("does not resolve duplicate identifiers or load non-inline sources", () => {
    const projection = projectGeneratedImages([
      assistant("one", [tool("one", [original()])]),
      assistant("two", [tool("two", [original()])]),
      assistant("unsafe", [
        tool("unsafe", [{ ...preview(second), uri: "https://example.test/image.png" }]),
      ]),
      assistant("answer", [
        text(`![Ambiguous](${reference()})\n\n![Unavailable](${reference(second)})`),
      ]),
    ]);
    expect(projection.resolve("answer", 0, reference())).toBeUndefined();
    expect(projection.resolve("answer", 0, reference(second))?.src).toBeUndefined();
    expect(projection.fallback.get("one")?.[0]?.src).toBeUndefined();
    expect(projection.fallback.get("two")?.[0]?.src).toBeUndefined();
    expect(projection.fallback.get("unsafe")).toHaveLength(1);
  });

  it("rejects repeated roles even when the first attachment has no supported source", () => {
    const projection = projectGeneratedImages([
      assistant("producer", [
        tool("source", [{ ...preview(), uri: "file:///missing.png" }, preview(), original()]),
      ]),
      assistant("answer", [text(`![Ambiguous](${reference()})`)]),
    ]);
    expect(projection.resolve("answer", 0, reference())).toBeUndefined();
    expect(projection.fallback.get("producer")).toEqual([{ reference: reference() }]);
  });
});
