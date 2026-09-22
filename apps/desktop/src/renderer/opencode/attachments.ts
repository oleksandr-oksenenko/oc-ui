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
 * /prompt). The stack overflow itself has no issue yet; the reproduction is in
 * docs/upstream-attachment-size-report.md. Remove this cap once the validator
 * is fixed.
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
 * The UTF-16 code-unit bound on the source text retained for one rejected
 * paste. A session holds at most one such recovery entry (a later paste is
 * refused until the entry is restored or dismissed), so this is the per-session
 * recovery memory bound. Text past it is not retained at all rather than
 * truncated; the notice names the bound so the user can paste a smaller part.
 */
export const MAX_RETAINED_PASTE_UNITS = 4 * 1024 * 1024;

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

type AttachmentSelection = {
  readonly accepted: readonly File[];
  readonly rejected: readonly File[];
};

/** Split a selection by the server's per-file size limit, preserving order. */
export function selectAttachableFiles(files: readonly File[]): AttachmentSelection {
  const accepted: File[] = [];
  const rejected: File[] = [];
  for (const file of files) {
    if (file.size > MAX_ATTACHMENT_BYTES) rejected.push(file);
    else accepted.push(file);
  }
  return { accepted, rejected };
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
