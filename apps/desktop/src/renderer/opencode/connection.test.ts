import { Effect, Exit } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  OpenCodeConnectionError,
  createBasicAuthorization,
  mapConnectionFailure,
  normalizeServerUrl,
  verifyServer,
} from "./connection.ts";
import { OPENCODE_VERSION } from "../../shared/desktop-api.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("OpenCode connection input", () => {
  it("normalizes a plain HTTP origin", () => {
    expect(normalizeServerUrl("http://homie:4096")).toBe("http://homie:4096");
    expect(normalizeServerUrl("http://127.0.0.1:4096/")).toBe("http://127.0.0.1:4096");
    expect(normalizeServerUrl(" HTTPS://HOMIE:443/ ")).toBe("https://homie");
  });

  it.each([
    "ftp://homie:4096",
    "http://user:secret@homie:4096",
    "http://homie:4096/api",
    "http://homie:4096?query=yes",
    "http://homie:4096#",
  ])("rejects unsupported server URL %s", (value) => {
    expect(() => normalizeServerUrl(value)).toThrowError(OpenCodeConnectionError);
  });

  it("encodes Unicode passwords as UTF-8 Basic authentication", () => {
    const header = createBasicAuthorization("pässword 🔐");
    const encoded = header.slice("Basic ".length);
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    expect(new TextDecoder().decode(bytes)).toBe("opencode:pässword 🔐");
  });

  it("rejects HTTP from an HTTPS browser page before sending credentials", async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);
    await expect(
      Effect.runPromise(
        verifyServer(
          { serverUrl: "http://127.0.0.1:4096", password: "secret" },
          "https://ocui.example.com",
        ),
      ),
    ).rejects.toMatchObject({
      reason: "invalid-url",
      message: expect.stringContaining("HTTPS server"),
    });
    expect(fetcher).not.toHaveBeenCalled();
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
      Effect.runPromise(verifyServer({ serverUrl: "http://127.0.0.1:4096", password: "secret" })),
    ).rejects.toMatchObject({
      reason: "incompatible-version",
      phase: "health",
    });
  });

  it("maps the beta server's empty 401 response to an authentication error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(null, { status: 401 }))),
    );

    await expect(
      Effect.runPromise(verifyServer({ serverUrl: "http://127.0.0.1:4096", password: "wrong" })),
    ).rejects.toMatchObject({
      reason: "unauthorized",
      phase: "health",
      message: "The server rejected the password.",
    });
  });

  it.each(["health", "location"] as const)(
    "aborts the actual %s request at its deadline",
    async (phase) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      let requestSignal: AbortSignal | undefined;
      const fetcher = vi.fn<typeof fetch>((_input, init) => {
        requestSignal = init?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          requestSignal?.addEventListener("abort", () => reject(requestSignal?.reason), {
            once: true,
          });
        });
      });
      if (phase === "location") {
        fetcher.mockResolvedValueOnce(
          Response.json({ healthy: true, version: OPENCODE_VERSION, pid: 1 }),
        );
      }
      vi.stubGlobal("fetch", fetcher);
      const verification = Effect.runPromise(
        verifyServer({ serverUrl: "http://127.0.0.1:4096", password: "secret" }),
      );
      const settled = verification.catch((cause: unknown) => cause);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await settled).toMatchObject({ reason: "unreachable", phase });
      expect(requestSignal?.aborted).toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(phase === "health" ? 1 : 2);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("cancels superseded verification and does not begin another request", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const controller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    const fetcher = vi.fn<typeof fetch>((_input, init) => {
      requestSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener("abort", () => reject(requestSignal?.reason), {
          once: true,
        });
      });
    });
    vi.stubGlobal("fetch", fetcher);
    const input = { serverUrl: "http://127.0.0.1:4096", password: "secret" };
    const verification = Effect.runPromiseExit(verifyServer(input), { signal: controller.signal });
    controller.abort();
    expect(Exit.hasInterrupts(await verification)).toBe(true);
    expect(requestSignal?.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["timeout", "caller cancellation"])(
    "retains an uncooperative request until it settles after %s",
    async (cancellation) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const controller = new AbortController();
      let requestSignal: AbortSignal | undefined;
      let finish: ((response: Response) => void) | undefined;
      const fetcher = vi.fn<typeof fetch>((_input, init) => {
        requestSignal = init?.signal ?? undefined;
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      });
      vi.stubGlobal("fetch", fetcher);
      const completed = vi.fn<() => void>();
      const verification = Effect.runPromiseExit(
        verifyServer({ serverUrl: "http://127.0.0.1:4096", password: "secret" }),
        { signal: controller.signal },
      ).then((result) => {
        completed();
        return result;
      });
      if (cancellation === "timeout") await vi.advanceTimersByTimeAsync(10_000);
      else controller.abort();
      expect(requestSignal?.aborted).toBe(true);
      await Promise.resolve();
      expect(completed).not.toHaveBeenCalled();
      finish?.(Response.json({ healthy: true, version: OPENCODE_VERSION, pid: 1 }));
      const result = await verification;
      expect(Exit.isFailure(result)).toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
