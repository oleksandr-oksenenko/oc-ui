import { describe, expect, it } from "vite-plus/test";

import {
  parseLocalOpenCodeConnectResult,
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
      parseLocalOpenCodeConnectResult({
        status: "connected",
        connection: { serverUrl: "http://127.0.0.1:4096", password: "secret" },
      }),
    ).toEqual({
      status: "connected",
      connection: { serverUrl: "http://127.0.0.1:4096", password: "secret" },
    });
    expect(
      parseLocalOpenCodeConnectResult({ status: "failed", message: "Server failed to start." }),
    ).toEqual({ status: "failed", message: "Server failed to start." });
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
    expect(() =>
      parseLocalOpenCodeConnectResult({
        status: "connected",
        connection: { serverUrl: "http://127.0.0.1:4096" },
      }),
    ).toThrow('Missing key\n  at ["connection"]["password"]');
    expect(() => parseVoidResult(null)).toThrow("Expected undefined");
  });
});
