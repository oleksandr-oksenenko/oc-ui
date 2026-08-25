export type LoadedConnection = {
  readonly serverUrl: string;
  readonly password?: string;
};

export type SaveConnectionInput = {
  readonly serverUrl: string;
  readonly password: string;
};

export type SaveConnectionResult = {
  readonly passwordSaved: boolean;
};

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
