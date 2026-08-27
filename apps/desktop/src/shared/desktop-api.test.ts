import { describe, expect, it } from "vite-plus/test";

import {
  parseConnectionClearResult,
  parseConnectionLoadResult,
  parseConnectionSaveResult,
} from "./desktop-api.ts";

describe("desktop IPC result parsing", () => {
  it("accepts valid connection results", () => {
    expect(parseConnectionLoadResult(undefined)).toBeUndefined();
    expect(parseConnectionLoadResult({ serverUrl: "https://example.test" })).toEqual({
      serverUrl: "https://example.test",
    });
    expect(
      parseConnectionLoadResult({ serverUrl: "https://example.test", password: "secret" }),
    ).toEqual({ serverUrl: "https://example.test", password: "secret" });
    expect(parseConnectionSaveResult({ passwordSaved: true })).toEqual({ passwordSaved: true });
    expect(parseConnectionClearResult(undefined)).toBeUndefined();
  });

  it("rejects malformed connection results", () => {
    expect(() => parseConnectionLoadResult({ serverUrl: 1 })).toThrow("Expected string");
    expect(() =>
      parseConnectionLoadResult({ serverUrl: "https://example.test", password: 1 }),
    ).toThrow("Expected string");
    expect(() =>
      parseConnectionLoadResult({ serverUrl: "https://example.test", extra: true }),
    ).toThrow("Expected no excess property");
    expect(() => parseConnectionSaveResult({ passwordSaved: "yes" })).toThrow("Expected boolean");
    expect(() => parseConnectionSaveResult({ passwordSaved: true, extra: true })).toThrow(
      "Expected no excess property",
    );
    expect(() => parseConnectionClearResult(null)).toThrow("Expected undefined");
  });
});
