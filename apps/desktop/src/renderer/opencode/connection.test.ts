import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  OpenCodeConnectionError,
  createBasicAuthorization,
  mapConnectionFailure,
  normalizeServerUrl,
  verifyServer,
} from "./connection.ts";

afterEach(() => vi.unstubAllGlobals());

describe("OpenCode connection input", () => {
  it("normalizes a plain HTTP origin", () => {
    expect(normalizeServerUrl("http://homie:4096")).toBe("http://homie:4096");
    expect(normalizeServerUrl("http://127.0.0.1:4096/")).toBe("http://127.0.0.1:4096");
  });

  it.each([
    "https://homie:4096",
    "http://user:secret@homie:4096",
    "http://homie:4096/api",
    "http://homie:4096?query=yes",
    " http://homie:4096",
  ])("rejects unsupported server URL %s", (value) => {
    expect(() => normalizeServerUrl(value)).toThrowError(OpenCodeConnectionError);
  });

  it("encodes Unicode passwords as UTF-8 Basic authentication", () => {
    const header = createBasicAuthorization("pässword 🔐");
    const encoded = header.slice("Basic ".length);
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    expect(new TextDecoder().decode(bytes)).toBe("opencode:pässword 🔐");
  });

  it("maps authentication failures without exposing raw errors", () => {
    const failure = mapConnectionFailure({ _tag: "UnauthorizedError", message: "raw" }, "health");
    expect(failure.reason).toBe("unauthorized");
    expect(failure.message).toBe("The server rejected the password.");
  });

  it("rejects a server that reports another OpenCode version", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(Response.json({ healthy: true, version: "0.0.0-beta-other", pid: 1 })),
      ),
    );

    await expect(
      verifyServer({ serverUrl: "http://127.0.0.1:4096", password: "secret" }),
    ).rejects.toMatchObject({
      reason: "incompatible-version",
      phase: "health",
    });
  });
});
