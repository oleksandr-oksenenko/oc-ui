import { Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { BrowserAnnotatorMessage, BrowserAnnotatorReply } from "./browser-annotator.ts";

describe("browser annotator protocol", () => {
  it("decodes popover messages and rejects unusable coordinates", () => {
    const message = Schema.decodeUnknownSync(BrowserAnnotatorMessage);
    const open = { _tag: "open", left: 1, top: 2, width: 3, height: 4 };
    expect(message(open)).toEqual(open);
    expect(message({ _tag: "close" })).toEqual({ _tag: "close" });
    expect(() => message({ ...open, left: Number.NaN })).toThrow(Schema.SchemaError);
  });

  it("bounds comment replies and rejects oversized comments", () => {
    const reply = Schema.decodeUnknownSync(BrowserAnnotatorReply);
    expect(reply({ _tag: "opened" })).toEqual({ _tag: "opened" });
    expect(reply({ _tag: "cancel" })).toEqual({ _tag: "cancel" });
    expect(reply({ _tag: "save", body: "Tighten the spacing" })).toEqual({
      _tag: "save",
      body: "Tighten the spacing",
    });
    expect(() => reply({ _tag: "save", body: "x".repeat(4_097) })).toThrow(Schema.SchemaError);
  });
});
