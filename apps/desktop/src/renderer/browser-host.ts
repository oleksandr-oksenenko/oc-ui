import { Effect, Schema } from "effect";

import type { AppHost } from "../shared/app-host.ts";
import { parseOpenExternalUrl } from "../shared/desktop-api.ts";
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
    saveFile: ({ name, bytes }) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const anchor = document.createElement("a");
          const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              anchor.remove();
              URL.revokeObjectURL(url);
            }),
          );
          anchor.href = url;
          anchor.download = name;
          anchor.hidden = true;
          document.body.append(anchor);
          anchor.click();
          // Chromium must start consuming the Blob before its URL is revoked.
          yield* Effect.sleep(1_000);
        }).pipe(Effect.scoped),
      ),
    openExternal: (url) => {
      try {
        // Keep the tab open synchronous with the activation call stack.
        window.open(parseOpenExternalUrl(url).href, "_blank", "noopener,noreferrer");
        return Promise.resolve();
      } catch (cause) {
        return Promise.reject(cause);
      }
    },
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
