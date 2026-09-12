import assert from "node:assert/strict";
import { createServer, request as forwardRequest } from "node:http";
import type { Socket } from "node:net";
import { $, $$, browser } from "@wdio/globals";
import { Schema } from "effect";

const TIMEOUT = 30_000;

export async function verifyTransportRecovery(): Promise<void> {
  const local = await browser.execute(() => window.desktop.localOpenCode.connect());
  if (local.status !== "connected") throw new Error(local.message);
  const workerPID = await browser.electron.execute(
    (electron) =>
      electron.app.getAppMetrics().find((metric) => metric.name === "Ocui built-in OpenCode")?.pid,
  );
  assert.ok(workerPID);
  const title = await $(".titlebar-session-title").getText();
  const model = await $('[aria-label^="Model:"]').getAttribute("aria-label");
  const sockets = new Set<Socket>();
  let offline = false;
  let eventStreams = 0;
  let rejectedConnections = 0;
  // Only this disposable test owns the proxy sockets. Every payload and credential
  // otherwise travels unchanged to the real packaged OpenCode server.
  const proxy = createServer((incoming, outgoing) => {
    if (offline) {
      rejectedConnections += 1;
      outgoing.writeHead(503).end();
      return;
    }
    if (incoming.url?.startsWith("/api/event")) eventStreams += 1;
    const upstream = new URL(incoming.url ?? "/", local.connection.serverUrl);
    const forwarded = forwardRequest(
      upstream,
      {
        method: incoming.method,
        headers: { ...incoming.headers, host: upstream.host },
      },
      (response) => {
        response.on("error", () => outgoing.destroy());
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      },
    );
    forwarded.on("error", () => outgoing.destroy());
    outgoing.on("close", () => forwarded.destroy());
    incoming.pipe(forwarded);
  });
  proxy.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    proxy.once("error", reject);
    proxy.listen(0, "127.0.0.1", resolve);
  });
  const address = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Int }))(proxy.address());
  const url = `http://127.0.0.1:${address.port}`;
  try {
    await $(".shell-server-selector").click();
    await $("#connection-form-title").waitForDisplayed();
    await $("span=Remote").click();
    await $('input[placeholder="http://homie:4096"]').setValue(url);
    await $('input[placeholder="Optional server password"]').setValue(local.connection.password);
    await $(".connection-form-submit").click();
    await $('.shell-server-selector[aria-label$=", Connected"]').waitForDisplayed({
      timeout: TIMEOUT,
    });
    await $(`.shell-session-main*=${title}`).waitForClickable({ timeout: TIMEOUT });
    await $(`.shell-session-main*=${title}`).click();
    await browser.waitUntil(
      async () => (await $(".transcript-view").getText()).includes("E2E_RECOVER"),
      { timeout: TIMEOUT },
    );
    const streamsBeforeDisconnect = eventStreams;
    assert.ok(streamsBeforeDisconnect > 0, "The real event stream must pass through the proxy");
    offline = true;
    for (const socket of sockets) socket.destroy();
    await $('.shell-server-selector[aria-label$=", Reconnecting"]').waitForDisplayed({
      timeout: TIMEOUT,
    });
    await browser.waitUntil(() => rejectedConnections > 0, { timeout: TIMEOUT });
    offline = false;
    await $('.shell-server-selector[aria-label$=", Connected"]').waitForDisplayed({
      timeout: TIMEOUT,
    });
    assert.ok(
      eventStreams > streamsBeforeDisconnect,
      "Recovery must create a new real SSE request",
    );
    assert.equal(await $(".titlebar-session-title").getText(), title);
    await browser.waitUntil(
      async () => (await $('[aria-label^="Model:"]').getAttribute("aria-label")) === model,
      { timeout: TIMEOUT },
    );
    assert.ok((await $(".transcript-view").getText()).includes("E2E_RECOVER"));
    const providerURL = process.env.OCUI_E2E_PROVIDER_URL;
    assert.ok(providerURL);
    const requestsBefore: { requests: unknown[] } = await (
      await fetch(`${providerURL}/_state`)
    ).json();
    const completed = await $$(".transcript-assistant-complete").length;
    await $('textarea[aria-label="Prompt"]').setValue(
      "E2E_TRANSPORT_RECOVER: send after the connection returns.",
    );
    await $('[aria-label="Send"]').waitForClickable({ timeout: TIMEOUT });
    await $('[aria-label="Send"]').click();
    await browser.waitUntil(
      async () => (await $$(".transcript-assistant-complete").length) > completed,
      { timeout: TIMEOUT },
    );
    await $('[aria-label="Send"]').waitForDisplayed({ timeout: TIMEOUT });
    const state: { requests: { model: string; prompt: string }[] } = await (
      await fetch(`${providerURL}/_state`)
    ).json();
    assert.ok(
      state.requests
        .slice(requestsBefore.requests.length)
        .some(
          (request) =>
            request.model !== "title" && request.prompt.includes("E2E_TRANSPORT_RECOVER"),
        ),
    );
    assert.equal(
      await browser.electron.execute(
        (electron) =>
          electron.app.getAppMetrics().find((metric) => metric.name === "Ocui built-in OpenCode")
            ?.pid,
      ),
      workerPID,
    );
  } finally {
    offline = false;
    try {
      if (await $(".shell-server-selector").isExisting()) await $(".shell-server-selector").click();
      await $("#connection-form-title").waitForDisplayed({ timeout: TIMEOUT });
      await $("span=Built-in").click();
      await $("button*=Start built-in server").click();
      await $('[aria-label="Select server, Local server, Connected"]').waitForDisplayed({
        timeout: TIMEOUT,
      });
      await $(`.shell-session-main*=${title}`).waitForClickable({ timeout: TIMEOUT });
      await $(`.shell-session-main*=${title}`).click();
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        proxy.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }
}
