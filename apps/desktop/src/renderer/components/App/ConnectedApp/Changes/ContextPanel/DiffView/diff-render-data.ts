import { parsePatchFiles, processFile } from "@pierre/diffs";
import type { FileContents, FileDiffMetadata } from "@pierre/diffs";

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
  if (complete) return { kind: "files", ...complete };

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
