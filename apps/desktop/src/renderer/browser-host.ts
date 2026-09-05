import { Effect, Schema } from "effect";

import type { AppHost } from "../shared/app-host.ts";
import { parseServerUrl, ServerUrlSchema } from "../shared/server-url.ts";

const storageKey = "ocui.connection.v1";
const StoredTargetSchema = Schema.Struct({
  version: Schema.Literal(1),
  serverUrl: ServerUrlSchema,
});
const parseStored = Schema.decodeUnknownSync(Schema.fromJsonString(StoredTargetSchema), {
  onExcessProperty: "error",
});
const encodeStored = Schema.encodeSync(Schema.fromJsonString(Schema.toEncoded(StoredTargetSchema)));

/** Storage is accessed lazily: denied storage must not prevent startup. */
export function createBrowserHost(): Extract<AppHost, { kind: "browser" }> {
  return {
    kind: "browser",
    target: {
      load: () =>
        Effect.runPromise(
          Effect.try(() => {
            const stored = localStorage.getItem(storageKey);
            return stored === null
              ? undefined
              : { kind: "remote" as const, serverUrl: parseStored(stored).serverUrl.origin };
          }),
        ),
      saveRemote: ({ serverUrl }) =>
        Effect.runPromise(
          Effect.try(() => {
            localStorage.setItem(
              storageKey,
              encodeStored({ version: 1, serverUrl: parseServerUrl(serverUrl).origin }),
            );
            return { passwordSaved: false };
          }),
        ),
      clear: () => Effect.runPromise(Effect.try(() => localStorage.removeItem(storageKey))),
    },
  };
}
