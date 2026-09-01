import { parseDiffFromFile, parsePatchFiles, processFile } from "@pierre/diffs";
import type { FileContents, FileDiffMetadata, SelectedLineRange } from "@pierre/diffs";

import type { ReviewComment } from "../../../../../../domain/review-drafts.ts";
export type { ReviewComment } from "../../../../../../domain/review-drafts.ts";

type PatchFile = {
  readonly path: string;
  readonly patch: string;
  readonly additions: number;
  readonly deletions: number;
  readonly status: "added" | "deleted" | "modified";
};

export type DiffRenderData =
  | {
      readonly kind: "files";
      readonly oldFile: FileContents;
      readonly newFile: FileContents;
      /** Normalized metadata used for review selections. */
      readonly fileDiff: FileDiffMetadata;
    }
  | {
      readonly kind: "patch";
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

export function prepareDiffRender(file: PatchFile): DiffRenderData | undefined {
  const complete = reconstructCompleteFiles(file);
  if (complete) {
    try {
      return {
        kind: "files",
        ...complete,
        fileDiff: {
          ...parseDiffFromFile(complete.oldFile, complete.newFile, undefined, true),
          name: file.path,
          type: file.status === "added" ? "new" : file.status === "deleted" ? "deleted" : "change",
        },
      };
    } catch {
      return undefined;
    }
  }

  const fileDiff = parseFilePatch(file);
  return fileDiff ? { kind: "patch", fileDiff } : undefined;
}

export function reconstructCompleteFiles(
  file: PatchFile,
): { readonly oldFile: FileContents; readonly newFile: FileContents } | undefined {
  const state = readCompletePatch(file.patch);
  if (!state || state.additions !== file.additions || state.deletions !== file.deletions)
    return undefined;
  if (!coversWholeFile(state.hunks, state.oldLines.length, state.newLines.length)) return undefined;
  if (file.status === "added" && state.oldLines.length !== 0) return undefined;
  if (file.status === "deleted" && state.newLines.length !== 0) return undefined;

  return {
    oldFile: { name: file.path, contents: state.oldLines.join("") },
    newFile: { name: file.path, contents: state.newLines.join("") },
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

export function parseFilePatch(file: PatchFile): FileDiffMetadata | undefined {
  try {
    const candidates = parsePatchFiles(file.patch, undefined, true).flatMap((patch) => patch.files);
    const parsed = candidates.find((candidate) => candidate.name === file.path) ?? candidates[0];
    const fallback =
      parsed ??
      processFile(`--- a/${file.path}\n+++ b/${file.path}\n${file.patch}`, {
        throwOnError: true,
      });
    if (!fallback || fallback.hunks.length === 0) return undefined;
    return {
      ...fallback,
      name: file.path,
      type: file.status === "added" ? "new" : file.status === "deleted" ? "deleted" : "change",
    };
  } catch {
    return undefined;
  }
}

export type DiffFileReview = {
  readonly comments: readonly ReviewComment[];
  readonly editingCommentID?: string;
  readonly selection?: SelectedLineRange | null;
  readonly onBeginComment?: (selection: SelectedLineRange, selectedCode: string) => void;
  readonly onUpdateCommentBody?: (commentID: string, body: string) => void;
  readonly onEditComment?: (commentID: string) => void;
  readonly onFinishComment?: (commentID: string) => void;
  readonly onRemoveComment?: (commentID: string, opener: HTMLElement) => void;
};

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
  // OpenCode's no-context request promises full context. Unified diffs do not
  // carry a separate EOF line count, so prove the parts they do encode: both
  // sides start at the file boundary, all hunks are contiguous, and their
  // declared counts end exactly at the reconstructed contents.
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
