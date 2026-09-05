import { Schema } from "effect";

/** An HTTP(S) origin, without credentials, paths, queries, or fragments. */
export const ServerUrlSchema = Schema.Trim.check(
  Schema.isLengthBetween(1, 2_048),
  Schema.isPattern(/^https?:\/\/[^/?#\\\s]+\/?$/iu),
).pipe(
  Schema.decodeTo(
    Schema.URLFromString.check(
      Schema.makeFilter((url) => url.href === `${url.origin}/`, {
        message: "Expected an HTTP or HTTPS server origin without credentials",
      }),
    ),
  ),
);

export const parseServerUrl = Schema.decodeSync(ServerUrlSchema);
