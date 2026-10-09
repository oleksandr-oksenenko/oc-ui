import { Schema } from "effect";

/** Keep validation in the plugin's Effect copy, including encoded tool outputs. */
export function standardSchema<S extends Schema.ConstraintDecoder<unknown>>(schema: S) {
  return {
    "~standard": Schema.toStandardJSONSchemaV1(Schema.toStandardSchemaV1(schema))["~standard"],
  };
}
