import { OpenCode } from "@opencode-ai/client";
import type { LocationGetOutput, OpenCodeClient } from "@opencode-ai/client";
import { Effect, Predicate } from "effect";

import { OPENCODE_VERSION } from "../../shared/desktop-api.ts";
import { workspaceRequest } from "../workspace-owner.ts";
const HEALTH_TIMEOUT_MS = 10_000;
const BASIC_USERNAME = "opencode";

type ConnectionFailureReason =
  | "invalid-url"
  | "unauthorized"
  | "unreachable"
  | "incompatible-version"
  | "stream-handshake"
  | "setup";

type ConnectionFailurePhase = "url" | "health" | "location" | "stream" | "setup";

export class OpenCodeConnectionError extends Error {
  readonly name = "OpenCodeConnectionError";
  readonly reason: ConnectionFailureReason;
  readonly phase: ConnectionFailurePhase;
  readonly cause: unknown;

  constructor(
    reason: ConnectionFailureReason,
    message: string,
    phase: ConnectionFailurePhase,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options);
    this.reason = reason;
    this.phase = phase;
    this.cause = options?.cause;
  }
}

export type VerifiedServer = {
  readonly serverUrl: string;
  readonly api: OpenCodeClient;
  readonly location: LocationGetOutput;
};

type VerifyServerInput = {
  readonly serverUrl: string;
  readonly password: string;
};

/** Normalize to an origin while rejecting every URL component outside an HTTP origin. */
export function normalizeServerUrl(value: string): string {
  if (value.trim() !== value || value.length === 0) {
    throw new OpenCodeConnectionError(
      "invalid-url",
      "Enter a plain HTTP server origin, such as http://127.0.0.1:4096.",
      "url",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (cause) {
    throw new OpenCodeConnectionError(
      "invalid-url",
      "Enter a valid plain HTTP server origin.",
      "url",
      { cause },
    );
  }

  if (
    parsed.protocol !== "http:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    value.includes("?") ||
    value.includes("#") ||
    parsed.hostname === "" ||
    !hasOnlyOriginPath(value)
  ) {
    throw new OpenCodeConnectionError(
      "invalid-url",
      "Only a plain http:// origin without credentials, path, query, or fragment is supported.",
      "url",
    );
  }

  return parsed.origin;
}

function hasOnlyOriginPath(value: string): boolean {
  const separator = value.indexOf("//");
  if (separator < 0) return false;
  const authority = value.slice(separator + 2);
  const slash = authority.indexOf("/");
  return slash < 0 || authority.slice(slash) === "/";
}

/** Build the one Basic header used by both HTTP calls and the SSE stream. */
export function createBasicAuthorization(password: string): string {
  const bytes = new TextEncoder().encode(`${BASIC_USERNAME}:${password}`);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

function createAuthenticatedClient(serverUrl: string, password: string): OpenCodeClient {
  return OpenCode.make({
    baseUrl: normalizeServerUrl(serverUrl),
    // The beta client discards HTTP status when an error response has no JSON
    // content type (the server's 401 response is intentionally empty). Keep
    // the status available so the connection form can give the right advice.
    fetch: async (input, init) => {
      const response = await fetch(input, init);
      if (response.status === 401) throw new HttpStatusError(response.status);
      return response;
    },
    headers: { Authorization: createBasicAuthorization(password) },
  });
}

class HttpStatusError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`OpenCode server returned HTTP ${status}.`);
    this.name = "HttpStatusError";
    this.status = status;
  }
}

/** Verify health, exact protocol version, and the server's default location. */
export const verifyServer = Effect.fn("verifyServer")(function* (
  input: VerifyServerInput,
): Effect.fn.Return<VerifiedServer, OpenCodeConnectionError> {
  const serverUrl = yield* Effect.try({
    try: () => normalizeServerUrl(input.serverUrl),
    catch: (cause) =>
      cause instanceof OpenCodeConnectionError
        ? cause
        : new OpenCodeConnectionError(
            "invalid-url",
            "Enter a valid plain HTTP server origin.",
            "url",
            { cause },
          ),
  });
  const api = createAuthenticatedClient(serverUrl, input.password);
  const health = yield* verifyRequest((signal) => api.health.get({ signal }), "health");
  if (health.version !== OPENCODE_VERSION) {
    return yield* Effect.fail(
      new OpenCodeConnectionError(
        "incompatible-version",
        `This app requires OpenCode ${OPENCODE_VERSION}; the server reports ${health.version}.`,
        "health",
      ),
    );
  }
  const location = yield* verifyRequest(
    (signal) => api.location.get(undefined, { signal }),
    "location",
  );
  if (location.directory.length === 0) {
    return yield* Effect.fail(
      new OpenCodeConnectionError("setup", "The server returned no default directory.", "location"),
    );
  }
  return { serverUrl, api, location };
});

export function mapConnectionFailure(
  cause: unknown,
  phase: Exclude<ConnectionFailurePhase, "url">,
): OpenCodeConnectionError {
  if (cause instanceof OpenCodeConnectionError) return cause;

  const status = findStatus(cause);
  if (status === 401 || hasTag(cause, "UnauthorizedError")) {
    return new OpenCodeConnectionError("unauthorized", "The server rejected the password.", phase, {
      cause,
    });
  }

  if (isTransportFailure(cause)) {
    return new OpenCodeConnectionError(
      phase === "stream" ? "stream-handshake" : "unreachable",
      phase === "health"
        ? "The server did not respond within 10 seconds."
        : phase === "location"
          ? "The server could not be reached."
          : "The event stream could not be established.",
      phase,
      { cause },
    );
  }

  return new OpenCodeConnectionError(
    phase === "stream" ? "stream-handshake" : "setup",
    phase === "health"
      ? "The server health check failed."
      : phase === "location"
        ? "The server location check failed."
        : "The event stream handshake failed.",
    phase,
    { cause },
  );
}

const verifyRequest = <A>(
  operation: (signal: AbortSignal) => Promise<A>,
  phase: "health" | "location",
) =>
  workspaceRequest(operation).pipe(
    Effect.mapError((error) => mapConnectionFailure(error.cause, phase)),
    Effect.timeoutOrElse({
      duration: HEALTH_TIMEOUT_MS,
      orElse: () =>
        Effect.fail(
          new OpenCodeConnectionError("unreachable", `Timed out during ${phase}.`, phase),
        ),
    }),
  );

function hasTag(cause: unknown, tag: string): boolean {
  return Predicate.isObject(cause) && "_tag" in cause && cause._tag === tag;
}

function findStatus(cause: unknown): number | undefined {
  if (!Predicate.isObject(cause)) return undefined;
  if ("status" in cause && Predicate.isNumber(cause.status)) return cause.status;
  if ("cause" in cause) return findStatus(cause.cause);
  return undefined;
}

function isTransportFailure(cause: unknown): boolean {
  if (cause instanceof TypeError) return true;
  if (cause instanceof DOMException && cause.name === "AbortError") return true;
  if (!Predicate.isObject(cause)) return false;
  if ("reason" in cause && cause.reason === "Transport") return true;
  return "cause" in cause && isTransportFailure(cause.cause);
}
