/** The connected server rejects decoded attachment bytes over this limit
 * (`@opencode/core` `SessionPrompt.materializeAttachment`). It is a server
 * contract, not a desktop tuning value.
 */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/**
 * The text-attachment cap, in UTF-8 bytes. The pinned server's base64
 * validation overflows the stack somewhere above 3 MiB decoded and fails
 * opaquely, so text attachments stay under a cap with headroom. It is a byte
 * cap, not a character count.
 */
export const MAX_TEXT_ATTACHMENT_BYTES = 2 * 1024 * 1024;

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
