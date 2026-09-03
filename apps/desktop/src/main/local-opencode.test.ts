import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { EnsureOptions } from "@opencode-ai/client/service";

import {
  createLocalOpenCodeService,
  LocalOpenCodeUnavailableError,
  LOCAL_OPENCODE_VERSION,
  packagedOpenCodeBinaryPath,
} from "./local-opencode.ts";

const endpoint = {
  url: "http://127.0.0.1:4096",
  auth: { type: "basic" as const, username: "opencode", password: "test-secret" },
};

const healthy = (): Response =>
  Response.json({ healthy: true, version: LOCAL_OPENCODE_VERSION, pid: 1 });

afterEach(() => {
  vi.useRealTimers();
});

describe("local OpenCode sidecar", () => {
  it("starts an explicitly selected packaged binary with app-private registration state", async () => {
    const ensure = vi.fn<(_options?: EnsureOptions) => Promise<typeof endpoint>>(() =>
      Promise.resolve(endpoint),
    );
    const stop = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const service = createLocalOpenCodeService({
      userDataPath: "/private/app-data",
      service: { ensure, stop },
      binaryPath: packagedOpenCodeBinaryPath("/private/app-resources"),
      fetch: vi.fn<() => Promise<Response>>(() => Promise.resolve(healthy())),
    });

    const connected = await service.connect();

    expect(connected).toEqual({ serverUrl: endpoint.url, password: endpoint.auth.password });
    expect(ensure).toHaveBeenCalledWith({
      file: "/private/app-data/opencode/service.json",
      command: ["/private/app-resources/opencode/opencode2", "serve", "--service", "--port", "0"],
      version: LOCAL_OPENCODE_VERSION,
      env: { XDG_STATE_HOME: "/private/app-data", OPENCODE_CLIENT: "oc-ui" },
    });
    await service.disconnect();
  });

  it("deduplicates concurrent connects and repeated disconnects", async () => {
    let resolveEnsure: ((value: typeof endpoint) => void) | undefined;
    const ensure = vi.fn<() => Promise<typeof endpoint>>(
      () =>
        new Promise<typeof endpoint>((resolve) => {
          resolveEnsure = resolve;
        }),
    );
    const stop = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const service = createLocalOpenCodeService({
      registrationFile: "/private/app-data/service.json",
      service: { ensure, stop },
      resolveCliBinary: () => "/private/opencode2.exe",
    });

    const first = service.connect();
    const second = service.connect();
    expect(first).toBe(second);
    const disconnecting = service.disconnect();
    expect(stop).not.toHaveBeenCalled();
    resolveEnsure?.(endpoint);
    await expect(first).rejects.toBeInstanceOf(LocalOpenCodeUnavailableError);
    await Promise.all([disconnecting, service.disconnect()]);
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("waits for an in-flight stop before reconnecting", async () => {
    let finishFirstStop: (() => void) | undefined;
    const ensure = vi.fn<() => Promise<typeof endpoint>>(() => Promise.resolve(endpoint));
    const stop = vi
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined)
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishFirstStop = resolve;
          }),
      );
    const service = createLocalOpenCodeService({
      registrationFile: "/private/app-data/service.json",
      service: { ensure, stop },
      resolveCliBinary: () => "/private/opencode2.exe",
    });

    await service.connect();
    const disconnecting = service.disconnect();
    const reconnecting = service.connect();
    expect(ensure).toHaveBeenCalledTimes(1);

    finishFirstStop?.();
    await disconnecting;
    await reconnecting;
    expect(ensure).toHaveBeenCalledTimes(2);
    await service.disconnect();
  });

  it("keeps a timed-out start owned until disconnect can stop it", async () => {
    let finishEnsure: ((value: typeof endpoint) => void) | undefined;
    const ensure = vi.fn<() => Promise<typeof endpoint>>(
      () =>
        new Promise<typeof endpoint>((resolve) => {
          finishEnsure = resolve;
        }),
    );
    const stop = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const service = createLocalOpenCodeService({
      registrationFile: "/private/app-data/service.json",
      service: { ensure, stop },
      resolveCliBinary: () => "/private/opencode2.exe",
      connectTimeoutMs: 5,
    });

    await expect(service.connect()).rejects.toMatchObject({
      reason: "timed-out",
      message: "The built-in OpenCode server did not start before the startup timeout.",
    });
    const disconnecting = service.disconnect();
    expect(stop).not.toHaveBeenCalled();

    finishEnsure?.(endpoint);
    await disconnecting;
    expect(stop).toHaveBeenCalledOnce();
  });

  it("retries and reports a sidecar that cannot be stopped", async () => {
    const secret = "stop-secret";
    const stop = vi.fn<() => Promise<void>>(() =>
      Promise.reject(new Error(`could not stop ${secret}`)),
    );
    const service = createLocalOpenCodeService({
      registrationFile: "/private/app-data/service.json",
      service: {
        ensure: vi.fn<() => Promise<typeof endpoint>>(() => Promise.resolve(endpoint)),
        stop,
      },
      resolveCliBinary: () => "/private/opencode2.exe",
    });

    await service.connect();
    await expect(service.disconnect()).rejects.toBeInstanceOf(LocalOpenCodeUnavailableError);
    await expect(service.disconnect()).rejects.not.toThrow(secret);
    expect(stop).toHaveBeenCalledTimes(4);
  });

  it("reports an unavailable sidecar after a bounded health probe", async () => {
    vi.useFakeTimers();
    const statuses: string[] = [];
    const fetch = vi.fn<() => Promise<Response>>(() =>
      Promise.resolve(new Response(null, { status: 503 })),
    );
    const service = createLocalOpenCodeService({
      registrationFile: "/private/app-data/service.json",
      service: {
        ensure: vi.fn<() => Promise<typeof endpoint>>(() => Promise.resolve(endpoint)),
        stop: vi.fn<() => Promise<void>>(),
      },
      resolveCliBinary: () => "/private/opencode2.exe",
      fetch,
      monitorIntervalMs: 20,
      healthTimeoutMs: 10,
    });
    service.onUnavailable(() => statuses.push("unavailable"));

    await service.connect();
    await vi.advanceTimersByTimeAsync(60);

    expect(fetch).toHaveBeenCalledWith(
      new URL("/api/health", endpoint.url),
      expect.objectContaining({
        headers: { authorization: `Basic ${btoa("opencode:test-secret")}` },
      }),
    );
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(statuses).toEqual(["unavailable"]);
    await service.disconnect();
  });

  it("rejects non-loopback or unauthenticated endpoints without leaking secrets", async () => {
    const secret = "do-not-leak";
    const service = createLocalOpenCodeService({
      registrationFile: "/private/app-data/service.json",
      service: {
        ensure: vi.fn<() => Promise<never>>(() =>
          Promise.reject(new Error(`spawn failed with password ${secret}`)),
        ),
        stop: vi.fn<() => Promise<void>>(),
      },
      resolveCliBinary: () => "/private/opencode2.exe",
    });

    await expect(service.connect()).rejects.toMatchObject({
      reason: "start-failed",
      message: "The built-in OpenCode server failed to start.",
    });
    await expect(service.connect()).rejects.not.toThrow(secret);

    const invalidEndpoint = createLocalOpenCodeService({
      registrationFile: "/private/app-data/service.json",
      service: {
        ensure: vi.fn<() => Promise<{ url: string; auth: typeof endpoint.auth }>>(() =>
          Promise.resolve({
            url: "http://example.test:4096",
            auth: { type: "basic" as const, username: "opencode", password: secret },
          }),
        ),
        stop: vi.fn<() => Promise<void>>(),
      },
      resolveCliBinary: () => "/private/opencode2.exe",
    });
    await expect(invalidEndpoint.connect()).rejects.toMatchObject({
      reason: "invalid-endpoint",
      message: "The built-in OpenCode server returned invalid connection details.",
    });
  });
});
