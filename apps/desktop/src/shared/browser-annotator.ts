import { Schema } from "effect";

/**
 * The in-page comment popover protocol. Kept separate from `browser-api.ts` so
 * the preload that draws the popover does not pull in the browser tool RPC
 * package through that module's imports.
 *
 * There is no interaction id: one editor exists per tab, the card sends a
 * single terminal message, and app-to-page control messages share one ordered
 * pipe, so the exchange only ignores a duplicate open.
 */

export { BROWSER_ANNOTATOR_CHANNEL } from "./browser-annotator-protocol.ts";

/** Main asks the tab's isolated world to show the minimal comment popover. */
export const BrowserAnnotatorMessage = Schema.TaggedUnion({
  open: {
    left: Schema.Finite,
    top: Schema.Finite,
    width: Schema.Finite,
    height: Schema.Finite,
  },
  close: {},
});
export type BrowserAnnotatorMessage = typeof BrowserAnnotatorMessage.Type;
/** The popover reports its open, the comment, or its dismissal to main. */
export const BrowserAnnotatorReply = Schema.TaggedUnion({
  opened: {},
  save: { body: Schema.String.check(Schema.isMaxLength(4_096)) },
  cancel: {},
});
export type BrowserAnnotatorReply = typeof BrowserAnnotatorReply.Type;
