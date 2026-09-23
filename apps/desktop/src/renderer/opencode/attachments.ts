/**
 * The decoded byte cap for every attachment the composer sends.
 *
 * TEMPORARY compatibility cap. The pinned server validates attachment base64
 * with an open-ended regexp (`Prompt.Base64`) that fails opaquely on large
 * payloads and overflows the stack above roughly 3.2 MiB decoded. 2 MiB keeps
 * about 37% margin below the measured failure and applies to text, files, and
 * images alike: the server re-encodes every attachment through the same
 * `SessionPrompt.materializeAttachment` path.
 *
 * Filed upstream: https://github.com/anomalyco/opencode/issues/50336 (a large
 * file crashes the session through Prompt.Base64) and
 * https://github.com/anomalyco/opencode/issues/45558 (Prompt.Base64 500 on
 * /prompt). The stack overflow itself has no issue yet; the finding and
 * reproduction are in docs/upstream-attachment-size-report.md. Remove this cap
 * once the validator is fixed.
 */
export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;

/**
 * How many attachments one session draft may hold. The renderer keeps every
 * draft's `File` objects (and later encodes them for the server), so the count
 * and the aggregate bytes below bound one session's attachment memory; drafts
 * are per session and are released when the draft is cleared or sent.
 */
export const MAX_DRAFT_ATTACHMENTS = 16;

/**
 * The aggregate attachment byte cap for one session draft. It is above the
 * per-file cap so several attachments fit, and below any batch size whose
 * encoding would retain an unbounded payload. A file that does not fit is
 * refused with a notice; nothing is partially encoded.
 */
export const MAX_DRAFT_ATTACHMENT_BYTES = 24 * 1024 * 1024;

/**
 * The file-bearing subset of `DataTransferItem`. A real `DataTransferItem` is
 * structurally assignable, and tests can build one without a DOM.
 */
export type FileTransferItem = {
  readonly kind: string;
  getAsFile(): File | null;
};

/**
 * The subset of `DataTransfer` attachment handling needs. A real clipboard or
 * drag payload always provides `files`; tests and non-browser callers may omit
 * the rest.
 */
export type FileTransferLike = {
  readonly files: ArrayLike<File>;
  readonly items?: ArrayLike<FileTransferItem> | undefined;
  readonly types?: ReadonlyArray<string> | undefined;
};

type AttachmentAdmission = {
  /** Candidates the draft can hold, in input order, after identity dedupe. */
  readonly admitted: readonly File[];
  /** Candidates over the per-file byte cap, in input order, for the caller's notice. */
  readonly tooLarge: readonly File[];
  /** Candidates that fit the per-file cap but not the draft's remaining budget. */
  readonly overBudget: readonly File[];
};

/**
 * Decides which candidate attachments one draft accepts. Pure: the caller
 * passes the draft's current files and commits the admitted slice, so an
 * admission always runs against the state read immediately before it.
 *
 * Identity wins over size: an object already in the draft, or repeated within
 * the selection, is skipped without a rejection because removal and completion
 * track the same identity. Order is preserved, and both the count and the
 * aggregate byte budget stop admitting in order, so a mixed selection keeps
 * everything that fits and reports the exact reason for the rest.
 */
export function admitAttachments(
  existing: readonly File[],
  candidates: readonly File[],
): AttachmentAdmission {
  const known = new Set(existing);
  const admitted: File[] = [];
  const tooLarge: File[] = [];
  const overBudget: File[] = [];
  let budget = remainingAttachmentBudget(existing);
  for (const file of candidates) {
    if (known.has(file)) continue;
    if (file.size > MAX_ATTACHMENT_BYTES) {
      tooLarge.push(file);
      continue;
    }
    if (budget.count <= 0 || file.size > budget.bytes) {
      overBudget.push(file);
      continue;
    }
    known.add(file);
    admitted.push(file);
    budget = { count: budget.count - 1, bytes: budget.bytes - file.size };
  }
  return { admitted, tooLarge, overBudget };
}

/** The attachment count and bytes one session's draft may still hold. */
function remainingAttachmentBudget(existing: readonly File[]) {
  const bytes = existing.reduce((total, file) => total + file.size, 0);
  return {
    count: MAX_DRAFT_ATTACHMENTS - existing.length,
    bytes: MAX_DRAFT_ATTACHMENT_BYTES - bytes,
  };
}

/**
 * Extract files from a paste or drop payload. Prefer the `files` list because it
 * is the stable representation, but fall back to file-kind items for sources that
 * populate only `DataTransferItem`s. Order is preserved and an identical `File`
 * object is never added twice, because removal and completion track identity.
 */
export function collectTransferFiles(dataTransfer: FileTransferLike | null): File[] {
  if (dataTransfer === null) return [];
  const candidates =
    dataTransfer.files.length > 0
      ? Array.from(dataTransfer.files)
      : Array.from(dataTransfer.items ?? [])
          .filter((item) => item.kind === "file")
          .map((item) => item.getAsFile())
          .filter((file): file is File => file !== null);
  const seen = new Set<File>();
  const files: File[] = [];
  for (const file of candidates) {
    if (seen.has(file)) continue;
    seen.add(file);
    files.push(file);
  }
  return files;
}

/**
 * Whether a drag payload could carry files. `dataTransfer.files` can be empty
 * while a drag is in progress, so the type list is the reliable signal.
 */
export function isFileTransfer(dataTransfer: FileTransferLike | null): boolean {
  if (dataTransfer === null) return false;
  if (dataTransfer.types?.includes("Files") === true) return true;
  return Array.from(dataTransfer.items ?? []).some((item) => item.kind === "file");
}
