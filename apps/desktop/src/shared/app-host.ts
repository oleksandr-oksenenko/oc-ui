import type { DesktopApi, OpenCodeTarget } from "./desktop-api.ts";

type RemoteTarget = Extract<OpenCodeTarget, { kind: "remote" }>;

export type AppHost =
  | ({ readonly kind: "desktop" } & DesktopApi)
  | {
      readonly kind: "browser";
      readonly target: {
        readonly load: () => Promise<Pick<RemoteTarget, "kind" | "serverUrl"> | undefined>;
        readonly saveRemote: DesktopApi["target"]["saveRemote"];
        readonly clear: DesktopApi["target"]["clear"];
      };
    };
