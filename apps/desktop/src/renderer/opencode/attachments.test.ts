import { describe, expect, it } from "vite-plus/test";

import {
  admitAttachments,
  collectTransferFiles,
  isFileTransfer,
  MAX_ATTACHMENT_BYTES,
  MAX_DRAFT_ATTACHMENT_BYTES,
  MAX_DRAFT_ATTACHMENTS,
  type FileTransferItem,
} from "./attachments.ts";

const item = (file: File | null): FileTransferItem => ({ kind: "file", getAsFile: () => file });
const textItem: FileTransferItem = { kind: "string", getAsFile: () => null };

/** A file whose metadata reports `size` without allocating the bytes. */
const sized = (name: string, size: number): File => {
  const file = new File([new Uint8Array(1)], name);
  Object.defineProperty(file, "size", { value: size });
  return file;
};

describe("admitAttachments", () => {
  it("admits files up to the per-file cap, keeping order and rejecting the rest", () => {
    const small = sized("small.txt", 2);
    const exact = sized("exact.txt", MAX_ATTACHMENT_BYTES);
    const large = sized("large.txt", MAX_ATTACHMENT_BYTES + 1);

    const result = admitAttachments([], [small, exact, large]);
    expect(result.admitted).toEqual([small, exact]);
    expect(result.tooLarge).toEqual([large]);
    expect(result.overBudget).toEqual([]);
  });

  it("accepts a mixed selection, rejecting only the files that do not fit", () => {
    const first = sized("first.txt", 10);
    const large = sized("large.txt", MAX_ATTACHMENT_BYTES + 1);
    const second = sized("second.txt", 20);
    const over = sized("over.txt", 1);

    const result = admitAttachments([sized("already.txt", 1)], [first, large, second]);
    expect(result.admitted).toEqual([first, second]);
    expect(result.tooLarge).toEqual([large]);

    // The second admission runs against the state the caller committed.
    const committed = admitAttachments([], [sized("half.bin", MAX_ATTACHMENT_BYTES / 2)]);
    expect(committed.admitted).toHaveLength(1);
    const refused = admitAttachments(committed.admitted, [over]);
    expect(refused.admitted).toEqual([over]);
    expect(refused.overBudget).toEqual([]);
  });

  it("skips an object the draft already holds, or repeated in the selection", () => {
    const notes = new File(["notes"], "notes.txt");
    const other = new File(["other"], "other.txt");

    const result = admitAttachments([notes], [notes, notes, other, other]);
    expect(result.admitted).toEqual([other]);
    expect(result.tooLarge).toEqual([]);
    expect(result.overBudget).toEqual([]);
  });

  it("bounds the count and reports the excess in order", () => {
    const existing = Array.from(
      { length: MAX_DRAFT_ATTACHMENTS - 1 },
      (_, index) => new File([`file ${index}`], `file-${index}.txt`),
    );
    const first = new File(["first"], "first.txt");
    const second = new File(["second"], "second.txt");

    const result = admitAttachments(existing, [first, second]);
    expect(result.admitted).toEqual([first]);
    expect(result.overBudget).toEqual([second]);

    // Freed room admits the next sequential selection.
    const freed = admitAttachments([...existing, first].slice(0, -1), [second]);
    expect(freed.admitted).toEqual([second]);
  });

  it("bounds the aggregate bytes exactly and admits after room is freed", () => {
    const count = MAX_DRAFT_ATTACHMENT_BYTES / MAX_ATTACHMENT_BYTES;
    const existing = Array.from({ length: count }, (_, index) =>
      sized(`file-${index}.bin`, MAX_ATTACHMENT_BYTES),
    );
    const extra = sized("extra.bin", 1);

    const full = admitAttachments(existing, [extra]);
    expect(full.admitted).toEqual([]);
    expect(full.overBudget).toEqual([extra]);

    const freed = admitAttachments(existing.slice(0, -1), [extra]);
    expect(freed.admitted).toEqual([extra]);
    expect(freed.overBudget).toEqual([]);
  });
});

describe("collectTransferFiles", () => {
  it("prefers the files list and preserves order", () => {
    const first = new File(["a"], "a.txt");
    const second = new File(["b"], "b.txt");
    expect(collectTransferFiles({ files: [first, second] })).toEqual([first, second]);
  });

  it("falls back to file-kind items and drops null entries", () => {
    const first = new File(["a"], "a.txt");
    const second = new File(["b"], "b.txt");
    expect(
      collectTransferFiles({
        files: [],
        items: [item(first), textItem, item(null), item(second)],
      }),
    ).toEqual([first, second]);
  });

  it("never adds the same file object twice", () => {
    const file = new File(["a"], "a.txt");
    expect(collectTransferFiles({ files: [file, file] })).toEqual([file]);
  });

  it("returns nothing for a missing payload", () => {
    expect(collectTransferFiles(null)).toEqual([]);
  });
});

describe("isFileTransfer", () => {
  it("recognizes a Files type even when the list is empty", () => {
    expect(isFileTransfer({ files: [], types: ["Files"] })).toBe(true);
  });

  it("recognizes file-kind items", () => {
    expect(isFileTransfer({ files: [], items: [item(new File(["a"], "a.txt"))] })).toBe(true);
  });

  it("rejects text-only payloads", () => {
    expect(isFileTransfer({ files: [], types: ["text/plain"], items: [] })).toBe(false);
    expect(isFileTransfer(null)).toBe(false);
  });
});
