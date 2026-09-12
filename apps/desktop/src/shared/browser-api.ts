import { Browser } from "@opencode/plugin-browser/rpc";
import { SessionID } from "@opencode-ai/schema/session-id";
import { Schema } from "effect";

const bindingID = Schema.String.check(Schema.isLengthBetween(1, 128));
export const BrowserAttach = Schema.Struct({
  bindingID,
  sessionID: SessionID,
  serverUrl: Schema.String.check(Schema.isLengthBetween(1, 2_048)),
  password: Schema.String,
});
export type BrowserAttach = typeof BrowserAttach.Type;
const BrowserBinding = Schema.Struct({ bindingID });
export const BrowserLayout = Schema.Struct({
  bindingID,
  tabID: Schema.NullOr(Browser.TabID),
  visible: Schema.Boolean,
  bounds: Schema.Struct({
    x: Schema.Int,
    y: Schema.Int,
    width: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 20_000 })),
    height: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 20_000 })),
  }),
});
export type BrowserLayout = typeof BrowserLayout.Type;

// The renderer exposes navigation controls, not privileged file or evaluation commands.
const controls = new Set<Browser.Method>([
  "tabs.list",
  "tabs.open",
  "tabs.close",
  "tabs.focus",
  "navigate",
  "back",
  "forward",
  "reload",
  "stop",
]);
export const BrowserCommand = Schema.Struct({
  bindingID,
  action: Browser.Action.check(Schema.makeFilter((action) => controls.has(action.type))),
});
export const BrowserRequest = Schema.TaggedUnion({
  attach: BrowserAttach.fields,
  detach: BrowserBinding.fields,
  command: BrowserCommand.fields,
  layout: BrowserLayout.fields,
});
export const BrowserEvent = Schema.Union([
  Schema.Struct({ bindingID, type: Schema.Literal("focus"), tabID: Browser.TabID }),
  Schema.Struct({
    bindingID,
    type: Schema.Literal("state"),
    status: Schema.Literals(["connected", "closed", "failed", "replaced", "unsupported"]),
    state: Browser.State,
    error: Schema.optional(Schema.String),
  }),
]);
export type BrowserEvent = typeof BrowserEvent.Type;
export type BrowserApi = {
  /** Remains pending until the attachment closes; readiness arrives through onEvent. */
  readonly attach: (input: BrowserAttach) => Promise<void>;
  readonly detach: (input: typeof BrowserBinding.Type) => Promise<void>;
  readonly command: (input: typeof BrowserCommand.Type) => Promise<void>;
  readonly layout: (input: BrowserLayout) => Promise<void>;
  readonly onEvent: (listener: (event: BrowserEvent) => void) => () => void;
};
export const BROWSER_CHANNELS = {
  request: "desktop:browser:request",
  event: "desktop:browser:event",
} as const;
export const emptyBrowserState = (): Browser.State => ({ tabs: [], focusedTabID: null });
