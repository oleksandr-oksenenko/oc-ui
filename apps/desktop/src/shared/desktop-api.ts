import { Schema } from "effect";

const LoadedConnectionSchema = Schema.Struct({
  serverUrl: Schema.String,
  password: Schema.optionalKey(Schema.String),
});

export type LoadedConnection = typeof LoadedConnectionSchema.Type;

const SaveConnectionInputSchema = Schema.Struct({
  serverUrl: Schema.String,
  password: Schema.String,
});

export type SaveConnectionInput = typeof SaveConnectionInputSchema.Type;

const SaveConnectionResultSchema = Schema.Struct({
  passwordSaved: Schema.Boolean,
});

export type SaveConnectionResult = typeof SaveConnectionResultSchema.Type;

export type DesktopApi = {
  readonly connection: {
    readonly load: () => Promise<LoadedConnection | undefined>;
    readonly save: (input: SaveConnectionInput) => Promise<SaveConnectionResult>;
    readonly clear: () => Promise<void>;
  };
};

export const IPC_CHANNELS = {
  connectionLoad: "desktop:connection:load",
  connectionSave: "desktop:connection:save",
  connectionClear: "desktop:connection:clear",
} as const;

const ipcParseOptions = { onExcessProperty: "error" } as const;

export const parseSaveConnectionInput = Schema.decodeUnknownSync(
  SaveConnectionInputSchema,
  ipcParseOptions,
);
export const parseConnectionLoadResult = Schema.decodeUnknownSync(
  Schema.UndefinedOr(LoadedConnectionSchema),
  ipcParseOptions,
);
export const parseConnectionSaveResult = Schema.decodeUnknownSync(
  SaveConnectionResultSchema,
  ipcParseOptions,
);
export const parseConnectionClearResult = Schema.decodeUnknownSync(
  Schema.Undefined,
  ipcParseOptions,
);
