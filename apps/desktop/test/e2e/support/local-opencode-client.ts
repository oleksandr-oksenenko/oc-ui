/// <reference types="node" />

import { browser } from "@wdio/globals";
import { OpenCode } from "@opencode/client";
import type { OpenCodeClient } from "@opencode/client";
import {
  parseLocalOpenCodeConnectResult,
  type DesktopApi,
  type LocalOpenCodeConnection,
} from "../../../src/shared/desktop-api.ts";

declare global {
  interface Window {
    readonly desktop: DesktopApi;
  }
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
function validateConnection(connection: LocalOpenCodeConnection): LocalOpenCodeConnection {
  const url = new URL(connection.serverUrl);
  if (
    url.protocol !== "http:" ||
    url.username !== "" ||
    url.password !== "" ||
    !LOOPBACK_HOSTS.has(url.hostname.toLowerCase()) ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.search !== "" ||
    url.hash !== "" ||
    connection.password.length === 0
  ) {
    throw new Error("invalid local connection");
  }

  return { serverUrl: url.origin, password: connection.password };
}

function safeError(cause: unknown, connection: LocalOpenCodeConnection): Error {
  const authorization = `Basic ${Buffer.from(`opencode:${connection.password}`, "utf8").toString("base64")}`;
  const scrub = (value: string): string =>
    value
      .replaceAll(connection.serverUrl, "<local-opencode-url>")
      .replaceAll(connection.password, "<redacted>")
      .replaceAll(authorization, "Basic <redacted>");

  if (cause instanceof Error) {
    // Preserve assertion identity and diagnostics while also scrubbing wrapped errors.
    cause.message = scrub(cause.message);
    if (cause.stack !== undefined) cause.stack = scrub(cause.stack);
    if (cause.cause !== undefined) cause.cause = safeError(cause.cause, connection);
    return cause;
  }
  return new Error("Local OpenCode client failed: operation failed");
}

/** Run an operation against the app-owned server without exposing its credentials. */
export async function withLocalOpenCodeClient<T>(
  use: (client: OpenCodeClient) => Promise<T> | T,
): Promise<T> {
  let connection: LocalOpenCodeConnection;
  try {
    const result = parseLocalOpenCodeConnectResult(
      await browser.execute(() => window.desktop.localOpenCode.connect()),
    );
    if (result.status !== "connected") throw new Error("Local connection failed");
    connection = validateConnection(result.connection);
  } catch {
    throw new Error("App-owned OpenCode connection is invalid or unavailable.");
  }

  let client: OpenCodeClient;
  try {
    const authorization = `Basic ${Buffer.from(`opencode:${connection.password}`, "utf8").toString("base64")}`;
    client = OpenCode.make({
      baseUrl: connection.serverUrl,
      headers: { Authorization: authorization },
    });
  } catch (cause) {
    throw safeError(cause, connection);
  }

  try {
    return await use(client);
  } catch (cause) {
    throw safeError(cause, connection);
  }
}
