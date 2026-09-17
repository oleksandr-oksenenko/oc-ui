import type { FileDiffInfo } from "@opencode/client";
import { parseDiffFromFile, parsePatchFiles, processFile } from "@pierre/diffs";
import type { FileContents, FileDiffMetadata, SelectedLineRange } from "@pierre/diffs";

export type { ReviewComment } from "../../../../../../domain/review-drafts.ts";

export type DiffRenderData = {
  readonly kind: "files" | "patch";
  readonly fileDiff: FileDiffMetadata;
};

type Hunk = {
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
  oldSeen: number;
  newSeen: number;
};

type BodyKind = "context" | "addition" | "deletion";

type PatchState = {
  readonly oldLines: string[];
  readonly newLines: string[];
  readonly hunks: Hunk[];
  current?: Hunk;
  previousBody?: BodyKind;
  additions: number;
  deletions: number;
  sawFileHeader: boolean;
};

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const NO_NEWLINE = "\\ No newline at end of file";

export function prepareDiffRender(file: FileDiffInfo): DiffRenderData | undefined {
  const complete = reconstructCompleteFiles(file);
  if (complete) {
    try {
      return {
        kind: "files",
        fileDiff: {
          ...parseDiffFromFile(complete.oldFile, complete.newFile, undefined, true),
          name: file.file,
          type: file.status === "added" ? "new" : file.status === "deleted" ? "deleted" : "change",
        },
      };
    } catch {
      // A reconstructed pair can still fail Pierre's parser (for example when a
      // generated patch is degenerate). Fall through so the original patch can
      // still render instead of discarding a displayable diff.
    }
  }

  const fileDiff = parseFilePatch(file);
  return fileDiff ? { kind: "patch", fileDiff } : undefined;
}

export function reconstructCompleteFiles(
  file: FileDiffInfo,
): { readonly oldFile: FileContents; readonly newFile: FileContents } | undefined {
  const state = readCompletePatch(file.patch);
  if (!state || state.additions !== file.additions || state.deletions !== file.deletions)
    return undefined;
  if (!coversWholeFile(state.hunks, state.oldLines.length, state.newLines.length)) return undefined;
  if (file.status === "added" && state.oldLines.length !== 0) return undefined;
  if (file.status === "deleted" && state.newLines.length !== 0) return undefined;

  return {
    oldFile: fileWithCacheKey(file.file, state.oldLines.join("")),
    newFile: fileWithCacheKey(file.file, state.newLines.join("")),
  };
}

function readCompletePatch(patch: string): PatchState | undefined {
  if (isUnsupportedPatch(patch)) return undefined;
  const state: PatchState = {
    oldLines: [],
    newLines: [],
    hunks: [],
    additions: 0,
    deletions: 0,
    sawFileHeader: false,
  };

  for (const rawLine of splitLines(patch)) {
    const line = withoutLineEnding(rawLine);
    const header = line.match(HUNK_HEADER);
    if (header) {
      if (state.current && !completeHunk(state.current)) return undefined;
      state.current = hunkFromHeader(header);
      state.hunks.push(state.current);
      state.previousBody = undefined;
      continue;
    }
    if (!state.current) {
      if (!recordFileHeader(state, line)) return undefined;
      continue;
    }
    if (!consumeHunkLine(state, rawLine, line)) return undefined;
  }

  return state.current && completeHunk(state.current) ? state : undefined;
}

function isUnsupportedPatch(patch: string): boolean {
  return (
    patch.length === 0 ||
    patch.includes("\0") ||
    patch.includes("GIT binary patch") ||
    patch.includes("Binary files ")
  );
}

function recordFileHeader(state: PatchState, line: string): boolean {
  if (!line.startsWith("diff --git ")) return true;
  if (state.sawFileHeader) return false;
  state.sawFileHeader = true;
  return true;
}

function hunkFromHeader(header: RegExpMatchArray): Hunk {
  return {
    oldStart: Number(header[1]),
    oldCount: countFromHeader(header[2]),
    newStart: Number(header[3]),
    newCount: countFromHeader(header[4]),
    oldSeen: 0,
    newSeen: 0,
  };
}

function consumeHunkLine(state: PatchState, rawLine: string, line: string): boolean {
  if (line.startsWith("diff --git ")) return false;
  const prefix = rawLine[0];
  if (prefix === " " || prefix === "+" || prefix === "-") {
    return appendBodyLine(state, prefix, rawLine);
  }
  if (line !== NO_NEWLINE || !state.previousBody) return false;
  if (state.previousBody !== "addition" && !removeLastLineEnding(state.oldLines)) return false;
  if (state.previousBody !== "deletion" && !removeLastLineEnding(state.newLines)) return false;
  state.previousBody = undefined;
  return true;
}

function appendBodyLine(state: PatchState, prefix: string, rawLine: string): boolean {
  const current = state.current;
  // A real diff body line always has a transport newline. A missing one is
  // truncation, not evidence that the source file lacked its final newline.
  if (!current || !hasLineEnding(rawLine)) return false;
  const content = rawLine.slice(1);
  if (prefix === " ") {
    state.oldLines.push(content);
    state.newLines.push(content);
    current.oldSeen++;
    current.newSeen++;
    state.previousBody = "context";
  } else if (prefix === "+") {
    state.newLines.push(content);
    current.newSeen++;
    state.additions++;
    state.previousBody = "addition";
  } else {
    state.oldLines.push(content);
    current.oldSeen++;
    state.deletions++;
    state.previousBody = "deletion";
  }
  return current.oldSeen <= current.oldCount && current.newSeen <= current.newCount;
}

export function parseFilePatch(file: FileDiffInfo): FileDiffMetadata | undefined {
  try {
    const candidates = parsePatchFiles(file.patch, undefined, true).flatMap((patch) => patch.files);
    const parsed = candidates.find((candidate) => candidate.name === file.file) ?? candidates[0];
    const fallback =
      parsed ??
      processFile(`--- a/${file.file}\n+++ b/${file.file}\n${file.patch}`, {
        throwOnError: true,
      });
    if (!fallback || fallback.hunks.length === 0) return undefined;
    return {
      ...fallback,
      name: file.file,
      type: file.status === "added" ? "new" : file.status === "deleted" ? "deleted" : "change",
      cacheKey: patchCacheKey(file.file, file.patch),
    };
  } catch {
    return undefined;
  }
}

type DiffRenderLine = {
  readonly kind: "context" | "deletion" | "addition";
  readonly oldLineNumber?: number;
  readonly newLineNumber?: number;
  readonly text: string;
};

/** Return the exact selected code from Pierre's normalized metadata. */
export function getSelectedCode(
  fileDiff: FileDiffMetadata,
  selection: SelectedLineRange,
): string | undefined {
  const lines = getDiffRenderLines(fileDiff);
  const range = selectionIndices(lines, selection);
  if (!range) return undefined;

  const first = Math.min(range.start, range.end);
  const last = Math.max(range.start, range.end);
  return lines
    .slice(first, last + 1)
    .map((line) => line.text)
    .join("");
}

/** Return the visual bottom row where Pierre should place an annotation. */
export function getAnnotationTarget(
  fileDiff: FileDiffMetadata,
  selection: SelectedLineRange,
): { readonly side: "deletions" | "additions"; readonly lineNumber: number } | undefined {
  const lines = getDiffRenderLines(fileDiff);
  const range = selectionIndices(lines, selection);
  if (!range) return undefined;
  const line = lines[Math.max(range.start, range.end)];
  if (!line) return undefined;
  return {
    side: line.kind === "deletion" ? "deletions" : "additions",
    lineNumber: line.kind === "deletion" ? line.oldLineNumber! : line.newLineNumber!,
  };
}

function selectionIndices(
  lines: readonly DiffRenderLine[],
  selection: SelectedLineRange,
): { readonly start: number; readonly end: number } | undefined {
  const start = lines.findIndex((line) =>
    lineMatchesSelection(line, selection.start, selection.side),
  );
  const end = lines.findIndex((line) =>
    lineMatchesSelection(line, selection.end, selection.endSide ?? selection.side),
  );
  return start < 0 || end < 0 ? undefined : { start, end };
}

function getDiffRenderLines(fileDiff: FileDiffMetadata): DiffRenderLine[] {
  const lines: DiffRenderLine[] = [];

  for (const hunk of fileDiff.hunks) {
    let oldLineNumber = hunk.deletionStart;
    let newLineNumber = hunk.additionStart;

    for (const content of hunk.hunkContent) {
      if (content.type === "context") {
        for (let index = 0; index < content.lines; index++) {
          const text =
            fileDiff.additionLines[content.additionLineIndex + index] ??
            fileDiff.deletionLines[content.deletionLineIndex + index] ??
            "";
          lines.push({ kind: "context", oldLineNumber, newLineNumber, text });
          oldLineNumber++;
          newLineNumber++;
        }
        continue;
      }

      for (let index = 0; index < content.deletions; index++) {
        lines.push({
          kind: "deletion",
          oldLineNumber,
          text: fileDiff.deletionLines[content.deletionLineIndex + index] ?? "",
        });
        oldLineNumber++;
      }
      for (let index = 0; index < content.additions; index++) {
        lines.push({
          kind: "addition",
          newLineNumber,
          text: fileDiff.additionLines[content.additionLineIndex + index] ?? "",
        });
        newLineNumber++;
      }
    }
  }

  return lines;
}

function lineMatchesSelection(
  line: DiffRenderLine,
  number: number,
  side?: "deletions" | "additions",
) {
  if (line.kind === "context") {
    return number === (side === "deletions" ? line.oldLineNumber : line.newLineNumber);
  }
  return side === "deletions"
    ? line.kind === "deletion" && line.oldLineNumber === number
    : line.kind === "addition" && line.newLineNumber === number;
}

function splitLines(value: string): string[] {
  return value.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g)?.filter((line) => line.length > 0) ?? [];
}

function withoutLineEnding(value: string): string {
  return value.replace(/(?:\r\n|\r|\n)$/, "");
}

function hasLineEnding(value: string): boolean {
  return /(?:\r\n|\r|\n)$/.test(value);
}

function removeLastLineEnding(lines: string[]): boolean {
  const index = lines.length - 1;
  const line = lines[index];
  if (line === undefined || !hasLineEnding(line)) return false;
  lines[index] = withoutLineEnding(line);
  return true;
}

function countFromHeader(value: string | undefined): number {
  return value === undefined ? 1 : Number(value);
}

function completeHunk(hunk: Hunk): boolean {
  return hunk.oldSeen === hunk.oldCount && hunk.newSeen === hunk.newCount;
}

function coversWholeFile(hunks: readonly Hunk[], oldLines: number, newLines: number): boolean {
  // Structural boundary check: both sides start at the file boundary, all hunks
  // are contiguous, and their declared counts end exactly at the reconstructed
  // contents. A unified hunk header records only the lines it includes, so this
  // cannot prove EOF coverage on its own. It is sound here only because the
  // renderer's sole diff producer (`opencode/vcs-diff.ts`) omits `context`, which
  // the server resolves to a full-context patch; keep that request unchanged, or
  // reconstruct from authoritative completeness instead of inferring it.
  let nextOld = oldLines === 0 ? 0 : 1;
  let nextNew = newLines === 0 ? 0 : 1;

  for (const hunk of hunks) {
    if (hunk.oldStart !== nextOld || hunk.newStart !== nextNew) return false;
    nextOld = hunk.oldStart + hunk.oldCount;
    nextNew = hunk.newStart + hunk.newCount;
  }

  return (
    nextOld === (oldLines === 0 ? 0 : oldLines + 1) &&
    nextNew === (newLines === 0 ? 0 : newLines + 1)
  );
}

/**
 * A stable cache key derived from file identity and content. Pierre skips its
 * worker highlight and diff caches unless a diff carries a `cacheKey`, and
 * `parseDiffFromFile` only combines the two sides when both files set one.
 *
 * The key uses the name plus the content length and a 53-bit cyrb53 hash. It is
 * synchronous and stable across renders for identical content. A collision would
 * let Pierre reuse a highlight result for different bytes; the length prefix
 * rejects most accidental collisions, and the residual risk only mis-highlights
 * an otherwise correct diff. The name is included so identical bytes with
 * different extensions do not reuse a language-mismatched highlight.
 */
function fileWithCacheKey(name: string, contents: string): FileContents {
  return { name, contents, cacheKey: `${name}:${contents.length}:${cyrb53(contents)}` };
}

function patchCacheKey(name: string, patch: string): string {
  return `${name}:patch:${patch.length}:${cyrb53(patch)}`;
}

/** cyrb53: a fast, synchronous, 53-bit non-cryptographic string hash. */
function cyrb53(value: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
