import { createProfile } from "./profile.mjs";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";
import { build, preview } from "vite-plus";
import { chromium } from "playwright";
import { access, mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startScriptedProvider } from "./scripted-provider.mjs";
import { git, prepareProjectFixture } from "./project-fixture.ts";
import { startServer, startTlsProxy, testCertificate } from "./browser-fixture.mjs";

let profile;
let provider;
let server;
let proxy;
let ui;
let browser;
let context;
let project;
let page;
let uiUrl;
let failed = false;
const errors = [];
const artifacts = new URL("../../dist/web-artifacts/", import.meta.url).pathname;

beforeAll(async () => {
  profile = await createProfile("ocui-browser-e2e-");
  provider = await startScriptedProvider();
  project = join(profile.paths.app, "acceptance-project");
  await prepareProjectFixture(project);
  await writeFile(join(project, "opencode.json"), JSON.stringify(provider.config));
  await Promise.all(
    Array.from({ length: 24 }, (_, index) =>
      mkdir(join(project, `folder-${String(index).padStart(2, "0")}`)),
    ),
  );
  const tls = await testCertificate(profile.root);
  const outDir = join(profile.root, "web");
  const built = await build({
    configFile: "vite.web.config.ts",
    base: "/ocui/",
    build: { outDir },
    logLevel: "silent",
  });
  const modules = built.output
    .filter((item) => item.type === "chunk")
    .flatMap((chunk) => Object.keys(chunk.modules));
  expect(
    modules.filter((id) =>
      /src\/(main|preload)\/|__vite-browser-external|node:|node_modules\/electron\//u.test(id),
    ),
  ).toEqual([]);
  ui = await preview({
    configFile: "vite.web.config.ts",
    base: "/ocui/",
    build: { outDir },
    preview: { port: 0, strictPort: false, https: tls },
  });
  uiUrl = `${ui.resolvedUrls.local[0]}ocui/`.replace("/ocui/ocui/", "/ocui/");
  server = await startServer(profile, project, new URL(uiUrl).origin);
  proxy = await startTlsProxy(tls, server.url);
  browser = await chromium.launch({ ignoreDefaultArgs: ["--disable-back-forward-cache"] });
  // Trust the disposable test certificate only in this test context, never in app code.
  context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 860 },
  });
  page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(30_000);
  await mkdir(artifacts, { recursive: true });
});

afterAll(async () => {
  const cleanup = await Promise.allSettled([
    browser?.close(),
    proxy?.close(),
    server?.close(),
    provider?.close(),
    ui &&
      new Promise((resolve) => {
        ui.httpServer.close(resolve);
      }),
  ]);
  const failures = cleanup.filter((result) => result.status === "rejected");
  if (failures.length)
    throw new AggregateError(
      failures.map((result) => result.reason),
      `Cleanup failed; profile preserved at ${profile?.root}`,
    );
  if (failed) console.error(`Browser acceptance failed; profile preserved at ${profile?.root}`);
  else await profile?.remove();
});

afterEach(async ({ task }) => {
  if (task.result?.state !== "fail") return;
  failed = true;
  if (page && !page.isClosed()) {
    console.error(await page.locator("body").innerText());
    await page.screenshot({ path: join(artifacts, "browser-failure.png") });
  }
});

async function connect(target = page) {
  await target.getByRole("textbox", { name: "Server URL", exact: true }).fill(proxy.url);
  await target.getByLabel("Password", { exact: true }).fill(server.password);
  await target.getByRole("button", { name: /^(Connect|Retry)$/u }).click();
  await target.getByRole("button", { name: /Select server, .*Connected/u }).waitFor();
}

async function transcript(text) {
  await expect.poll(() => page.locator(".transcript-view").textContent()).toContain(text);
}

async function send(text) {
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => page.getByLabel("Prompt", { exact: true }).inputValue()).toBe("");
}

async function idle() {
  await page.getByRole("button", { name: "Send", exact: true }).waitFor();
  await page.locator(".transcript-working").waitFor({ state: "hidden" });
}

async function changeServer(target = page) {
  await target.getByRole("button", { name: /Select server, .*Connected/u }).click();
  await target.getByRole("heading", { name: "Connect to OpenCode" }).waitFor();
}

describe.sequential("production browser app", () => {
  it("connects over authenticated cross-origin HTTPS and isolates credentials between tabs and reloads", async () => {
    await page.goto(uiUrl);
    expect(await page.evaluate(() => "desktop" in window)).toBe(false);
    expect(await page.getByText("Built-in server", { exact: true }).count()).toBe(0);
    await page.getByLabel("Server URL", { exact: true }).fill(server.url);
    await page.getByRole("button", { name: /^(Connect|Retry)$/u }).click();
    await page.getByRole("alert").filter({ hasText: "HTTPS" }).waitFor();
    await page.getByLabel("Server URL", { exact: true }).fill(proxy.url);
    await page.getByLabel("Password", { exact: true }).fill("incorrect");
    await page.getByRole("button", { name: /^(Connect|Retry)$/u }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: /password/iu })
      .waitFor();
    await connect();
    expect(
      await page.evaluate(() =>
        JSON.stringify(
          Object.fromEntries(
            [localStorage, sessionStorage].flatMap((storage) =>
              Object.keys(storage).map((key) => [key, storage.getItem(key)]),
            ),
          ),
        ),
      ),
    ).toBe(
      JSON.stringify({
        "ocui.connection.v1": JSON.stringify({ version: 1, serverUrl: proxy.url }),
      }),
    );
    const second = await context.newPage();
    await second.goto(uiUrl);
    expect(await second.getByLabel("Server URL", { exact: true }).inputValue()).toBe(proxy.url);
    expect(await second.getByLabel("Password", { exact: true }).inputValue()).toBe("");
    await connect(second);
    await changeServer();
    expect(await page.getByLabel("Password", { exact: true }).inputValue()).toBe("");
    await page.getByRole("button", { name: "Forget saved choice" }).click();
    expect(await page.getByLabel("Server URL", { exact: true }).inputValue()).toBe("");
    expect(await second.getByRole("button", { name: /Select server, .*Connected/u }).count()).toBe(
      1,
    );
    await second.close();
    expect((await server.health()).healthy).toBe(true);
    await connect();
    await page.reload();
    await page.getByRole("heading", { name: "Connect to OpenCode" }).waitFor();
    expect(await page.getByLabel("Password", { exact: true }).inputValue()).toBe("");
    await connect();
  });

  it("keeps the shared session, directory, keyboard, and narrow-layout flows working", async () => {
    const opener = page.getByRole("button", { name: "Create session", exact: true });
    await opener.click();
    await page.getByLabel("Close new session dialog").waitFor();
    await page.keyboard.press("Escape");
    await expect.poll(() => opener.evaluate((node) => node === document.activeElement)).toBe(true);
    await opener.click();
    await page.getByRole("button", { name: "Add project", exact: true }).click();
    await page.getByRole("button", { name: "Browse directory folder-00/", exact: true }).click();
    await page.getByText("No child directories.", { exact: true }).waitFor();
    await page.getByLabel("Go to parent directory").click();
    await page.setViewportSize({ width: 430, height: 600 });
    await page.locator('[aria-label="Directories"]').evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: join(artifacts, "browser-directory-narrow.png") });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Add project", exact: true }).click();
    await page.locator('.server-flow-dialog button[type="submit"]').click();
    await page.locator('.server-flow-dialog button[type="submit"]').click();
    await page.getByLabel("Prompt", { exact: true }).waitFor();
    await page.locator(".transcript-empty-state").waitFor();
    expect(await page.getByRole("button", { name: "Send", exact: true }).isDisabled()).toBe(true);
    await page.getByLabel("Prompt", { exact: true }).fill("Independent draft");
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.getByRole("button", { name: "Show sessions", exact: true }).click();
    await opener.click();
    await page.locator('.server-flow-dialog button[type="submit"]').click();
    await expect.poll(() => page.getByLabel("Prompt", { exact: true }).inputValue()).toBe("");
    await page.locator('.shell-session-main:not([aria-current="page"])').click();
    await expect
      .poll(() => page.getByLabel("Prompt", { exact: true }).inputValue())
      .toBe("Independent draft");
    expect(await page.evaluate(() => document.documentElement.dataset.host)).toBe("browser");
  });

  it("streams prompts, resolves questions, stops real provider work, and reconnects after transport loss", async () => {
    await send("E2E_STREAM browser");
    await transcript("Acceptance first streamed fragment.");
    await page.getByRole("button", { name: "Stop", exact: true }).waitFor();
    await transcript("Acceptance completed with stream.");
    await idle();
    await send("E2E_QUESTION browser");
    await page.locator(".question-form").waitFor();
    await page.locator(".question-form label").filter({ hasText: "Alpha" }).click();
    await page.locator('.question-form button[type="submit"]').click();
    await transcript("Acceptance question resolved:");
    await idle();
    await send("E2E_PROVIDER_ERROR browser");
    await transcript("Acceptance provider rejected this prompt");
    await idle();
    await send("E2E_STOP browser");
    await transcript("Acceptance stream is waiting for cancellation.");
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await idle();
    await expect
      .poll(async () => (await (await fetch(`${provider.url}/_state`)).json()).cancelledStreams)
      .toBeGreaterThan(0);
    proxy.disconnect();
    await page.getByRole("button", { name: /Select server, .*Reconnecting/u }).waitFor();
    proxy.reconnect();
    await page.getByRole("button", { name: /Select server, .*Connected/u }).waitFor();
    await send("E2E_RECOVER browser");
    await transcript("E2E_RECOVER browser");
    await idle();
    expect(errors).toEqual([]);
  });

  it("submits annotations and reviews through the same server-backed workspace", async () => {
    const block = page.locator(".transcript-assistant-message [data-annotation-block]").first();
    await block.scrollIntoViewIfNeeded();
    // Scrolling dismisses selection, so let those events settle before selecting text.
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await block.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await page.locator(".annotation-selection-action button").click();
    const annotation = "Browser annotation reaches the provider.";
    await page.getByPlaceholder("Write a question or note…").fill(annotation);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await page.getByLabel("Discard 1 annotations").waitFor();
    await send("E2E_ANNOTATION browser");
    await idle();
    await page.locator(".transcript-annotation-trigger").click();
    await transcript(annotation);
    if (await page.getByLabel("Show context", { exact: true }).count())
      await page.getByLabel("Show context", { exact: true }).click();
    const diff = page.locator(".pierre-diff-host diffs-container").first();
    await diff.locator('[data-column-number="1"][data-line-type="change-addition"]').hover();
    await diff.locator("[data-utility-button]").click();
    const review = "Browser review survives panel remount.";
    await page.getByLabel("Comment on working.txt").fill(review);
    await page.keyboard.press("Escape");
    await page.getByLabel("Hide context panel").click();
    await page.getByLabel("Show context").click();
    await expect.poll(() => page.locator(".diff-review-text").textContent()).toBe(review);
    await send("E2E_REVIEW browser");
    await idle();
    await page.locator(".transcript-code-review-trigger").click();
    await expect
      .poll(() => page.locator(".transcript-code-review-content").textContent())
      .toContain(review);
    const requests = (await (await fetch(`${provider.url}/_state`)).json()).requests;
    expect(requests.some((request) => request.prompt.includes(annotation))).toBe(true);
    expect(
      requests.some(
        (request) => request.prompt.includes(review) && request.prompt.includes("working.txt"),
      ),
    ).toBe(true);
  });

  it("creates and removes an isolated server worktree with cancel and reopen", async () => {
    await page.screenshot({ path: join(artifacts, "browser-connected.png") });
    const before = await git(project, "worktree", "list", "--porcelain");
    await page.getByLabel("Create session", { exact: true }).click();
    await page.getByText("Create a worktree", { exact: true }).click();
    await page.locator('.server-flow-dialog button[type="submit"]').click();
    await page.getByText("No working tree changes", { exact: true }).waitFor();
    const after = await git(project, "worktree", "list", "--porcelain");
    const worktree = after
      .split("\n")
      .find((line) => line.startsWith("worktree ") && !before.includes(line))
      .slice(9);
    expect(worktree.startsWith(`${await realpath(profile.paths.data)}/opencode/worktree/`)).toBe(
      true,
    );
    expect(await git(worktree, "rev-parse", "HEAD")).toBe(
      await git(project, "rev-parse", "origin/main"),
    );
    const row = page.locator(".shell-session-row.selected");
    await row.hover();
    await row.locator(".shell-session-delete").click();
    await page.locator(".delete-session-dialog").waitFor();
    await page.keyboard.press("Escape");
    await access(worktree);
    await row.hover();
    await row.locator(".shell-session-delete").click();
    await page.locator('.delete-session-dialog button[type="submit"]').click();
    await expect
      .poll(() => git(project, "worktree", "list", "--porcelain"))
      .not.toContain(worktree);
    await expect(access(worktree)).rejects.toHaveProperty("code", "ENOENT");
    await access(join(project, "working.txt"));
  });

  it("recovers from browser navigation and unavailable storage without stopping the server", async () => {
    await page.goto("about:blank");
    await page.goBack();
    await page.getByRole("heading", { name: "Connect to OpenCode" }).waitFor();
    expect(await page.getByLabel("Password", { exact: true }).inputValue()).toBe("");
    await connect();
    // Exercise the persisted-page branch even when Chromium declines to cache a streaming page.
    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    await page.getByRole("heading", { name: "Connect to OpenCode" }).waitFor();
    expect(await page.getByLabel("Password", { exact: true }).inputValue()).toBe("");
    await page.evaluate(() => localStorage.setItem("ocui.connection.v1", "broken"));
    await page.reload();
    await page
      .getByText("Saved connection settings could not be loaded. You can still connect manually.", {
        exact: true,
      })
      .waitFor();
    await connect();
    const denied = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      await denied.addInitScript(() =>
        Object.defineProperty(window, "localStorage", {
          get() {
            throw new DOMException("Storage denied", "SecurityError");
          },
        }),
      );
      const deniedPage = await denied.newPage();
      await deniedPage.goto(uiUrl);
      await deniedPage
        .getByText(
          "Saved connection settings could not be loaded. You can still connect manually.",
          { exact: true },
        )
        .waitFor();
      await connect(deniedPage);
      await deniedPage
        .getByText("The connection works, but its settings could not be saved.", { exact: true })
        .waitFor();
      expect(
        await deniedPage.getByRole("button", { name: /Select server, .*Connected/u }).count(),
      ).toBe(1);
    } finally {
      await denied.close();
    }
    const blocked = await context.newPage();
    await blocked.goto(uiUrl.replace("127.0.0.1", "localhost"));
    await blocked.getByLabel("Server URL", { exact: true }).fill(proxy.url);
    await blocked.getByLabel("Password", { exact: true }).fill(server.password);
    await blocked.getByRole("button", { name: "Connect", exact: true }).click();
    await blocked.getByRole("alert").filter({ hasText: "browser access settings" }).waitFor();
    await blocked.close();
    await page.close();
    expect((await server.health()).healthy).toBe(true);
    expect(errors).toEqual([]);
  });
});
