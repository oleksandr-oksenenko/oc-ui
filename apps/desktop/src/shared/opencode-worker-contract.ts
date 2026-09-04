import { Schema } from "effect";

const WorkerCommandSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("start"),
    userDataPath: Schema.NonEmptyString,
    password: Schema.NonEmptyString,
  }),
  Schema.Struct({ type: Schema.Literal("stop") }),
]);
const WorkerMessageSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal("listening"), url: Schema.NonEmptyString }),
  Schema.Struct({
    type: Schema.Literal("fatal"),
    message: Schema.Literal("Built-in OpenCode failed."),
  }),
]);

export type OpenCodeWorkerCommand = typeof WorkerCommandSchema.Type;
export type OpenCodeWorkerMessage = typeof WorkerMessageSchema.Type;
export const parseWorkerCommand = Schema.decodeUnknownSync(WorkerCommandSchema, {
  onExcessProperty: "error",
});
export const parseWorkerMessage = Schema.decodeUnknownSync(WorkerMessageSchema, {
  onExcessProperty: "error",
});
