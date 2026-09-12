import { Schema } from "effect";
import type { BrowserApi } from "./browser-api.ts";

export const OPENCODE_VERSION = "0.0.0-beta-19271" as const;

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
};

export const IPC_CHANNELS = {
  targetLoad: "desktop:target:load",
  targetSave: "desktop:target:save",
  targetClear: "desktop:target:clear",
  localOpenCodeConnect: "desktop:local-opencode:connect",
  localOpenCodeUnavailable: "desktop:local-opencode:unavailable",
} as const;

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
