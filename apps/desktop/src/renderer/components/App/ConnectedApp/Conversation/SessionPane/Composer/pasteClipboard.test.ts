import { describe, expect, it } from "vite-plus/test";

import { readClipboardFiles, readClipboardText } from "./pasteClipboard.ts";

/** A clipboard whose `getData` serves the provided flavors. */
const clipboard = (data: Readonly<Record<string, string>>) => ({
  files: [],
  getData: (type: string) => data[type] ?? "",
});

describe("readClipboardText", () => {
  it("reads the plain flavor", () => {
    expect(readClipboardText(clipboard({ "text/plain": "hello" }))).toBe("hello");
  });

  it("falls back to the URI list with line feeds flattened, then to the legacy Text spelling", () => {
    expect(readClipboardText(clipboard({ "text/uri-list": "https://example.com/a\r\n" }))).toBe(
      "https://example.com/a ",
    );
    expect(readClipboardText(clipboard({ Text: "legacy" }))).toBe("legacy");
    // A nonempty plain flavor always wins over the fallbacks.
    expect(
      readClipboardText(
        clipboard({ "text/plain": "plain", "text/uri-list": "https://example.com/a" }),
      ),
    ).toBe("plain");
  });

  it("reads no text from a payload with only unsupported flavors", () => {
    expect(readClipboardText(clipboard({ "text/html": "<p>hello</p>" }))).toBe("");
  });

  it("adapts to sources without a type list and to absent getData", () => {
    const data = { files: [], getData: (type: string) => (type === "text/plain" ? "x" : "") };
    expect(readClipboardText(data)).toBe("x");
    expect(readClipboardText({ files: [] })).toBe("");
  });
});

describe("readClipboardFiles", () => {
  it("collects file metadata without reading bytes", () => {
    const file = new File(["x"], "note.txt", { type: "text/plain" });
    expect(readClipboardFiles({ files: [file] })).toEqual([file]);
    expect(readClipboardFiles(null)).toEqual([]);
  });
});
