import { describe, expect, it } from "vite-plus/test";

import { readPastedFiles, readPastedText } from "./pasteClipboard.ts";

/** A clipboard whose `getData` serves the provided flavors. */
const clipboard = (data: Readonly<Record<string, string>>) => ({
  files: [],
  getData: (type: string) => data[type] ?? "",
});

describe("readPastedText", () => {
  it("reads the plain flavor", () => {
    expect(readPastedText(clipboard({ "text/plain": "hello" }))).toBe("hello");
  });

  it("falls back to the URI list with line feeds flattened, then to the legacy Text spelling", () => {
    expect(readPastedText(clipboard({ "text/uri-list": "https://example.com/a\r\n" }))).toBe(
      "https://example.com/a ",
    );
    expect(readPastedText(clipboard({ Text: "legacy" }))).toBe("legacy");
    // A nonempty plain flavor always wins over the fallbacks.
    expect(
      readPastedText(
        clipboard({ "text/plain": "plain", "text/uri-list": "https://example.com/a" }),
      ),
    ).toBe("plain");
  });

  it("reads no text from a payload with only unsupported flavors", () => {
    expect(readPastedText(clipboard({ "text/html": "<p>hello</p>" }))).toBe("");
  });

  it("adapts to sources without a type list and to absent getData", () => {
    const data = { files: [], getData: (type: string) => (type === "text/plain" ? "x" : "") };
    expect(readPastedText(data)).toBe("x");
    expect(readPastedText({ files: [] })).toBe("");
  });
});

describe("readPastedFiles", () => {
  it("collects file metadata without reading bytes", () => {
    const file = new File(["x"], "note.txt", { type: "text/plain" });
    expect(readPastedFiles({ files: [file] })).toEqual([file]);
    expect(readPastedFiles(null)).toEqual([]);
  });
});
