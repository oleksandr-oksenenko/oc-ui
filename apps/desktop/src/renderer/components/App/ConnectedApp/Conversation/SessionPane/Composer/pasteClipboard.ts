import {
  collectTransferFiles,
  type FileTransferLike,
} from "../../../../../../opencode/attachments.ts";

/**
 * The text flavor reading stage. It sits between the browser's clipboard and
 * the router: the clipboard exposes formats rather than one payload, so this
 * module owns the fallback order the sources actually provide. `text/html` is
 * never inspected; a payload without usable text is the router's no-op.
 */

/**
 * The subset of `DataTransfer` the paste reader needs. A real clipboard always
 * provides `getData` and `types`; tests and odd sources may omit either.
 */
type ClipboardDataLike = FileTransferLike & {
  readonly getData?: ((type: string) => string) | undefined;
};

const uriListToText = (value: string): string => value.replace(/\r?\n/g, " ");

/**
 * Reads the text flavor of a paste or drop payload synchronously; this is not
 * the system clipboard API. It follows ProseMirror's own fallback order:
 * `text/plain`, the legacy `Text` spelling, then `text/uri-list` with its line
 * feeds flattened. `text/html` is never inspected, and an absent `getData`
 * yields no text.
 */
export function readPastedText(data: ClipboardDataLike): string {
  const getData = data.getData?.bind(data);
  if (getData === undefined) return "";
  const plain = getData("text/plain") || getData("Text");
  if (plain !== "") return plain;
  const uris = getData("text/uri-list");
  return uris === "" ? "" : uriListToText(uris);
}

/**
 * Collects the file attachments from a paste or drop payload. Metadata only:
 * the bytes are never read here, and the existing size policy belongs to the
 * attachment owner.
 */
export function readPastedFiles(data: ClipboardDataLike): File[] {
  return collectTransferFiles(data);
}
