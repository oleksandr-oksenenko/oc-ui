import { describe, expect, it } from "vite-plus/test";

import {
  parseLocalOpenCodeConnection,
  parseTargetLoadResult,
  parseTargetSaveResult,
  parseVoidResult,
} from "./desktop-api.ts";

describe("desktop IPC result parsing", () => {
  it("accepts valid target and sidecar results", () => {
    expect(parseTargetLoadResult(undefined)).toBeUndefined();
    expect(parseTargetLoadResult({ kind: "local" })).toEqual({ kind: "local" });
    expect(
      parseTargetLoadResult({
        kind: "remote",
        serverUrl: "http://example.test",
        password: "secret",
      }),
    ).toEqual({ kind: "remote", serverUrl: "http://example.test", password: "secret" });
    expect(parseTargetSaveResult({ passwordSaved: true })).toEqual({ passwordSaved: true });
    expect(
      parseLocalOpenCodeConnection({
        serverUrl: "http://127.0.0.1:4096",
        password: "secret",
      }),
    ).toEqual({ serverUrl: "http://127.0.0.1:4096", password: "secret" });
    expect(parseVoidResult(undefined)).toBeUndefined();
  });

  it("rejects malformed target and sidecar results", () => {
    expect(() => parseTargetLoadResult({ kind: "remote", serverUrl: 1 })).toThrow(
      "Expected string",
    );
    expect(() => parseTargetLoadResult({ kind: "local", extra: true })).toThrow(
      "Expected no excess property",
    );
    expect(() => parseTargetSaveResult({ passwordSaved: "yes" })).toThrow("Expected boolean");
    expect(() => parseLocalOpenCodeConnection({ serverUrl: "http://127.0.0.1:4096" })).toThrow(
      "Expected string",
    );
    expect(() => parseVoidResult(null)).toThrow("Expected undefined");
  });
});
