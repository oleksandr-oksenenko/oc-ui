import { describe, expect, it } from "vite-plus/test";

import {
  collectTransferFiles,
  isFileTransfer,
  MAX_ATTACHMENT_BYTES,
  selectAttachableFiles,
  type FileTransferItem,
} from "./attachments.ts";

const item = (file: File | null): FileTransferItem => ({ kind: "file", getAsFile: () => file });
const textItem: FileTransferItem = { kind: "string", getAsFile: () => null };

describe("selectAttachableFiles", () => {
  it("accepts files up to the server limit and rejects the rest", () => {
    const small = new File([new Uint8Array(2)], "small.txt");
    const exact = new File([new Uint8Array(1)], "exact.txt");
    Object.defineProperty(exact, "size", { value: MAX_ATTACHMENT_BYTES });
    const large = new File([new Uint8Array(1)], "large.txt");
    Object.defineProperty(large, "size", { value: MAX_ATTACHMENT_BYTES + 1 });

    const result = selectAttachableFiles([small, exact, large]);
    expect(result.accepted).toEqual([small, exact]);
    expect(result.rejected).toEqual([large]);
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
