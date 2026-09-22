import type {
  BrowserAnnotatorMessage,
  BrowserAnnotatorReply,
} from "../../../shared/browser-annotator.ts";

/**
 * Drives one comment interaction with the in-page popover. Kept free of
 * Electron imports so the protocol is unit testable: the caller supplies a
 * transport that sends messages and forwards decoded replies.
 *
 * One editor exists per tab and app-to-page messages share one ordered pipe,
 * so the exchange only has to ignore a duplicate open. A card that opened is
 * the user's to finish, cancel, or abandon; the host's backstop ends an
 * abandoned operation, so there is no comment deadline here.
 */

export type AnnotationCommentTransport = {
  readonly send: (message: BrowserAnnotatorMessage) => void;
  readonly onReply: (listener: (reply: BrowserAnnotatorReply) => void) => () => void;
  readonly focus: () => void;
};

export type AnnotationCommentOptions = {
  readonly openTimeoutMs?: number;
};

const OPEN_TIMEOUT_MS = 10_000;

/**
 * Resolves with the comment, or `undefined` when the user cancelled or the
 * interaction was interrupted. Rejects when the editor never appeared, so the
 * failure is reported instead of adding an empty annotation.
 */
export async function requestAnnotationComment(
  transport: AnnotationCommentTransport,
  anchor: { x: number; y: number; width: number; height: number },
  signal: AbortSignal,
  options: AnnotationCommentOptions = {},
): Promise<string | undefined> {
  const openTimeoutMs = options.openTimeoutMs ?? OPEN_TIMEOUT_MS;
  if (signal.aborted) return undefined;
  let settled = false;
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  const outcome = Promise.withResolvers<string | undefined>();
  const settle = () => {
    settled = true;
    clearTimeout(openTimer);
    off();
    try {
      transport.send({ _tag: "close" });
    } catch {
      // A gone editor must not mask a settled comment.
    }
  };
  const finish = (result: string | undefined) => {
    if (settled) return;
    settle();
    outcome.resolve(result);
  };
  const fail = (error: Error) => {
    if (settled) return;
    settle();
    outcome.reject(error);
  };
  signal.addEventListener("abort", () => finish(undefined), { once: true });
  const off = transport.onReply((reply) => {
    if (settled) return;
    if (reply._tag === "opened") {
      clearTimeout(openTimer);
      return;
    }
    if (reply._tag === "save") {
      finish(reply.body);
      return;
    }
    if (reply._tag === "cancel") finish(undefined);
  });
  try {
    transport.send({
      _tag: "open",
      left: anchor.x,
      top: anchor.y,
      width: anchor.width,
      height: anchor.height,
    });
  } catch {
    fail(new Error("The comment box is unavailable. Select the element again."));
    return outcome.promise;
  }
  transport.focus();
  openTimer = setTimeout(
    () => fail(new Error("The comment box did not open. Select the element again.")),
    openTimeoutMs,
  );
  return outcome.promise;
}
