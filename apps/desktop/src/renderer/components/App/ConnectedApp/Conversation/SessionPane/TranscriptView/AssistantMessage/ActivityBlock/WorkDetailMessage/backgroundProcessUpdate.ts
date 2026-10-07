import type { SessionMessageSynthetic } from "@opencode/client";
import { Option, Schema } from "effect";

const decodeMetadata = Schema.decodeUnknownOption(
  Schema.Struct({
    source: Schema.Literal("shell"),
    jobID: Schema.NonEmptyString,
    state: Schema.Literals(["completed", "error", "cancelled"]),
    exit: Schema.optional(
      Schema.Union([Schema.Finite, Schema.Literals(["Infinity", "-Infinity", "NaN"])]),
    ),
    timeout: Schema.optional(Schema.Boolean),
    truncated: Schema.optional(Schema.Boolean),
  }),
);

/** Shell notifications use unescaped, multiline attributes, not XML. */
export function backgroundProcessUpdate(message: SessionMessageSynthetic) {
  const metadata = Option.getOrUndefined(decodeMetadata(message.metadata));
  if (metadata === undefined || message.description === undefined) return undefined;
  const state = metadata.state;
  const command = message.description;
  // The producer repeats the full command in description. Match that exact
  // prefix so quotes, newlines and shell-like text in output stay lossless.
  const prefix = `<shell id="${metadata.jobID}" state="${state}" command="${command}">\n`;
  const suffix = "\n</shell>";
  const matches = message.text.startsWith(prefix) && message.text.endsWith(suffix);
  const failed =
    state === "error" ||
    metadata.timeout === true ||
    (state === "completed" && metadata.exit !== undefined && metadata.exit !== 0);
  return {
    command,
    output: matches ? message.text.slice(prefix.length, -suffix.length) : message.text,
    jobID: metadata.jobID,
    label:
      state === "cancelled"
        ? "Cancelled"
        : metadata.timeout === true
          ? "Timed out"
          : failed
            ? "Failed"
            : "Completed",
    status: state === "cancelled" ? "cancelled" : failed ? "error" : "success",
    truncated: metadata.truncated === true,
  };
}
