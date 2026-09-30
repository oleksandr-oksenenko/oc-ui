import { describe, expect, it } from "vite-plus/test";
import { draftTitle, type DraftRecord } from "./drafts.ts";

const draft = (text: string): DraftRecord => ({
  id: "draft",
  serverKey: "server",
  revision: 0,
  created: 0,
  updated: 0,
  choices: { mode: "local" },
  text,
  skills: [],
  attachments: [],
});

describe("draftTitle", () => {
  it.each([
    ["hello,&#x20;", "hello,"],
    ["&#x20;\n\n**First line**\nSecond line", "First line"],
    ["hello,\\&#x20;", "hello,&#x20;"],
    ["`hello,&#x20;`", "hello,&#x20;"],
    ["\\-&#x20;", "-"],
  ])("shows composer text for %s", (text, title) => {
    const record = draft(text);
    expect(draftTitle(record)).toBe(title);
    expect(record.text).toBe(text);
  });

  it("uses the existing fallbacks when the prompt has no visible text", () => {
    expect(draftTitle(draft("&#x20;"))).toBe("Untitled draft");
    expect(draftTitle({ ...draft(""), skills: [{ id: "review", name: "review" }] })).toBe("review");
    expect(
      draftTitle({
        ...draft(""),
        attachments: [{ id: "file", name: "notes.txt", type: "text/plain", lastModified: 0 }],
      }),
    ).toBe("notes.txt");
  });
});
