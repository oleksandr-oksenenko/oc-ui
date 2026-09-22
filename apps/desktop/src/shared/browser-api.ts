import { Browser } from "@opencode/plugin-browser/rpc";
import { SessionID } from "@opencode/schema/session-id";
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
export const BrowserAnnotationStart = Schema.Struct({
  bindingID,
  tabID: Browser.TabID,
  requestID: Schema.String.check(Schema.isLengthBetween(1, 128)),
  number: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 999 })),
  mode: Schema.Literals(["element", "area"]),
});
export type BrowserAnnotationStart = typeof BrowserAnnotationStart.Type;
const BrowserAnnotationCancel = Schema.Struct({ bindingID, tabID: Browser.TabID });
/** Page-authored fields; each is bounded and treated as untrusted page data. */
export const BrowserSelection = Schema.Struct({
  frameUrl: Schema.String.check(Schema.isMaxLength(16_384)),
  selector: Schema.String.check(Schema.isMaxLength(4_096)),
  tag: Schema.String.check(Schema.isMaxLength(256)),
  text: Schema.String.check(Schema.isMaxLength(4_096)),
  role: Schema.String.check(Schema.isMaxLength(256)),
  label: Schema.String.check(Schema.isMaxLength(1_024)),
  /** Viewport CSS pixels when `topFrame`, otherwise frame-local CSS pixels. */
  bounds: Schema.Struct({
    x: Schema.Finite,
    y: Schema.Finite,
    width: Schema.Finite,
    height: Schema.Finite,
  }),
  topFrame: Schema.Boolean,
});
export type BrowserSelection = typeof BrowserSelection.Type;
export const BrowserAnnotationCapture = Schema.Struct({
  requestID: Schema.String,
  number: Schema.Int,
  mode: Schema.Literals(["element", "area"]),
  tab: Browser.Tab,
  capturedAt: Schema.String.check(Schema.isMaxLength(64)),
  selection: BrowserSelection,
  // Empty only when the picker's popover could not be used (for example a child frame).
  body: Schema.String.check(Schema.isMaxLength(4_096)),
  // Electron IPC carries typed bytes; the RPC's base64 codec is for server transport.
  image: Schema.toType(Browser.File),
});
export type BrowserAnnotationCapture = typeof BrowserAnnotationCapture.Type;

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
  annotationStart: BrowserAnnotationStart.fields,
  annotationCancel: BrowserAnnotationCancel.fields,
});
export const BrowserEvent = Schema.Union([
  Schema.Struct({ bindingID, type: Schema.Literal("focus"), tabID: Browser.TabID }),
  Schema.Struct({
    bindingID,
    type: Schema.Literal("annotation"),
    capture: BrowserAnnotationCapture,
  }),
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
  /** Resolves when the pick settles, including cancellation; failures reject. */
  readonly annotationStart: (input: BrowserAnnotationStart) => Promise<void>;
  readonly annotationCancel: (input: typeof BrowserAnnotationCancel.Type) => Promise<void>;
  readonly onEvent: (listener: (event: BrowserEvent) => void) => () => void;
};
export const BROWSER_CHANNELS = {
  request: "desktop:browser:request",
  event: "desktop:browser:event",
} as const;
export const emptyBrowserState = (): Browser.State => ({ tabs: [], focusedTabID: null });
