import { Schema } from "effect";
import type { BrowserApi } from "./browser-api.ts";

export const OPENCODE_VERSION = "2.0.3" as const;

const LocalTargetSchema = Schema.Struct({ kind: Schema.Literal("local") });
const RemoteTargetSchema = Schema.Struct({
  kind: Schema.Literal("remote"),
  serverUrl: Schema.String,
  password: Schema.optionalKey(Schema.String),
});
const OpenCodeTargetSchema = Schema.Union([LocalTargetSchema, RemoteTargetSchema]);

export type OpenCodeTarget = typeof OpenCodeTargetSchema.Type;

export type SaveTargetInput = OpenCodeTarget;

type SaveRemoteTargetInput = Omit<typeof RemoteTargetSchema.Type, "kind">;

const SaveTargetResultSchema = Schema.Struct({ passwordSaved: Schema.Boolean });
export type SaveTargetResult = typeof SaveTargetResultSchema.Type;

const LocalOpenCodeConnectionSchema = Schema.Struct({
  serverUrl: Schema.String,
  password: Schema.String,
});
export type LocalOpenCodeConnection = typeof LocalOpenCodeConnectionSchema.Type;

const LocalOpenCodeConnectResultSchema = Schema.Union([
  Schema.Struct({ status: Schema.Literal("connected"), connection: LocalOpenCodeConnectionSchema }),
  Schema.Struct({ status: Schema.Literal("failed"), message: Schema.String }),
]);
export type LocalOpenCodeConnectResult = typeof LocalOpenCodeConnectResultSchema.Type;

export type DesktopApi = {
  readonly browser?: BrowserApi;
  readonly target: {
    readonly load: () => Promise<OpenCodeTarget | undefined>;
    readonly saveLocal: () => Promise<void>;
    readonly saveRemote: (input: SaveRemoteTargetInput) => Promise<SaveTargetResult>;
    readonly clear: () => Promise<void>;
  };
  readonly localOpenCode: {
    readonly connect: () => Promise<LocalOpenCodeConnectResult>;
    readonly onUnavailable: (listener: () => void) => () => void;
  };
  /** Hands a web URL to the operating system's default handler. */
  readonly openExternal: (url: string) => Promise<void>;
  /**
   * Reads the system clipboard text for the composer's literal-paste escape
   * hatch. The renderer bounds the returned string immediately; the host owns
   * clipboard access because the runtime denies the web Clipboard API.
   */
  readonly clipboard: {
    readonly readText: () => Promise<string>;
  };
};

export const IPC_CHANNELS = {
  targetLoad: "desktop:target:load",
  targetSave: "desktop:target:save",
  targetClear: "desktop:target:clear",
  localOpenCodeConnect: "desktop:local-opencode:connect",
  localOpenCodeUnavailable: "desktop:local-opencode:unavailable",
  openExternal: "desktop:open-external",
  clipboardReadText: "desktop:clipboard:read-text",
} as const;

/**
 * Accepts only absolute web URLs for the OS handler. Other schemes can launch
 * arbitrary local programs or read local files through `shell.openExternal`.
 * The length bound applies to the normalized `href`, so preload and main agree
 * on the same value.
 */
const ExternalUrlSchema = Schema.URLFromString.check(
  Schema.makeFilter((url) => url.protocol === "http:" || url.protocol === "https:", {
    message: "Expected an http or https URL",
  }),
  Schema.makeFilter((url) => url.href.length <= 2_048, {
    message: "Expected a URL of at most 2048 characters",
  }),
);

export const parseOpenExternalUrl = Schema.decodeUnknownSync(ExternalUrlSchema);

const ipcParseOptions = { onExcessProperty: "error" } as const;

export const parseSaveTargetInput = Schema.decodeUnknownSync(OpenCodeTargetSchema, ipcParseOptions);
export const parseTargetLoadResult = Schema.decodeUnknownSync(
  Schema.UndefinedOr(OpenCodeTargetSchema),
  ipcParseOptions,
);
export const parseTargetSaveResult = Schema.decodeUnknownSync(
  SaveTargetResultSchema,
  ipcParseOptions,
);
export const parseVoidResult = Schema.decodeUnknownSync(Schema.Undefined, ipcParseOptions);
export const parseLocalOpenCodeConnectResult = Schema.decodeUnknownSync(
  LocalOpenCodeConnectResultSchema,
  ipcParseOptions,
);
export const parseClipboardText = Schema.decodeUnknownSync(Schema.String, ipcParseOptions);
