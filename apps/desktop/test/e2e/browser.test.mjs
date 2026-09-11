import { createProfile } from "./profile.mjs";
import { OpenCode } from "@opencode-ai/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";
import { build, preview } from "vite-plus";
import { chromium } from "playwright";
import { access, mkdir, realpath, rename, unlink, writeFile } from "node:fs/promises";
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
let secondaryProject;
let page;
let uiUrl;
let api;
let acceptanceConfig;
let failed = false;
let permissionRequestNumber = 0;
const errors = [];
const artifacts = new URL("../../dist/web-artifacts/", import.meta.url).pathname;

async function preparePermissionProject(directory, identity) {
  await mkdir(directory, { recursive: true });
  await git(directory, "init", "--initial-branch=main");
  await writeFile(join(directory, ".git", "info", "exclude"), "/opencode.json\n");
  await git(directory, "config", "user.name", "Ocui acceptance test");
  await git(directory, "config", "user.email", "acceptance@example.invalid");
  await writeFile(join(directory, "identity.txt"), `${identity}\n`);
  await git(directory, "add", "identity.txt");
  await git(directory, "commit", "-m", identity);
}

beforeAll(async () => {
  profile = await createProfile("ocui-browser-e2e-");
  provider = await startScriptedProvider();
  project = join(profile.paths.app, "acceptance-project");
  secondaryProject = join(profile.paths.app, "permission-secondary", "acceptance-project");
  await Promise.all([
    prepareProjectFixture(project),
    preparePermissionProject(secondaryProject, "Secondary permission project"),
  ]);
  acceptanceConfig = JSON.stringify({
    ...provider.config,
    agents: {
      ...provider.config.agents,
      "permission-review": {
        mode: "primary",
        description: "Permission acceptance agent",
        model: "acceptance/alternate",
        permissions: [{ action: "*", resource: "*", effect: "ask" }],
      },
    },
  });
  await Promise.all(
    [project, secondaryProject].map((directory) =>
      writeFile(join(directory, "opencode.json"), acceptanceConfig),
    ),
  );
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
  api = OpenCode.make({ baseUrl: server.url, headers: server.headers });
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

async function ensureConnected() {
  if (page.url() === "about:blank") await page.goto(uiUrl);
  const connected = page.getByRole("button", { name: /Select server, .*Connected/u });
  const serverUrl = page.getByLabel("Server URL", { exact: true });
  await expect
    .poll(async () => {
      if (await connected.count()) return "connected";
      if (await serverUrl.count()) return "connect";
      return "loading";
    })
    .not.toBe("loading");
  if (!(await connected.count())) await connect();
}

function locationRequestOptions(directory) {
  return { headers: { "x-opencode-directory": encodeURIComponent(directory) } };
}

async function warmPermissionLocation(directory) {
  const canonical = await realpath(directory);
  await expect
    .poll(async () =>
      (await api.agent.list({ location: { directory: canonical } })).data.some(
        (agent) => agent.id === "permission-review",
      ),
    )
    .toBe(true);
  return canonical;
}

async function createPermissionSession(title, directory = project) {
  const canonical = await realpath(directory);
  return api.session.create(
    {
      title,
      agent: "permission-review",
      location: { directory: canonical },
    },
    locationRequestOptions(canonical),
  );
}

async function createPermission(sessionID, action, options = {}) {
  permissionRequestNumber += 1;
  const id = `per_acceptance_${permissionRequestNumber}`;
  const directory = await realpath(options.directory ?? project);
  const result = await api.permission.create(
    {
      sessionID,
      id,
      action,
      resources: options.resources ?? [`/acceptance/${action}/${permissionRequestNumber}`],
      save: options.save,
      source: options.source,
      agent: "permission-review",
    },
    locationRequestOptions(directory),
  );
  expect(result).toEqual({ id, effect: "ask" });
  await expect
    .poll(async () =>
      (await api.permission.list({ sessionID }, locationRequestOptions(directory))).some(
        (item) => item.id === id,
      ),
    )
    .toBe(true);
  return id;
}

function permissionCard(requestID) {
  return page.locator(`[data-permission-request-id="${requestID}"]`);
}

async function selectSession(title) {
  const session = page.getByRole("button", { name: new RegExp(`^${title},`, "u") });
  await session.waitFor();
  await session.click();
  await expect.poll(() => session.getAttribute("aria-current")).toBe("page");
}

async function expectPermissionSettled(sessionID, requestID, directory = project) {
  const canonical = await realpath(directory);
  await permissionCard(requestID).waitFor({ state: "hidden" });
  await expect
    .poll(async () =>
      (await api.permission.list({ sessionID }, locationRequestOptions(canonical))).some(
        (item) => item.id === requestID,
      ),
    )
    .toBe(false);
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

  it("refreshes external disk edits without watcher events and preserves unchanged collapsed files", async () => {
    if (await page.getByLabel("Show context", { exact: true }).count())
      await page.getByLabel("Show context", { exact: true }).click();
    await page.getByRole("button", { name: "Collapse working.txt", exact: true }).click();
    let release;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    let finish;
    const continued = new Promise((resolve) => {
      finish = resolve;
    });
    let refreshing = false;
    const holdDiff = async (route) => {
      refreshing = true;
      await pending;
      finish(route.continue());
    };
    await page.route("**/api/vcs/diff**", holdDiff);
    try {
      await expect.poll(() => refreshing).toBe(true);
      expect(await page.locator(".context-spinner").count()).toBe(0);
      expect(
        await page.getByRole("button", { name: "Expand working.txt", exact: true }).count(),
      ).toBe(1);
    } finally {
      release();
      if (refreshing) await continued;
      await page.unroute("**/api/vcs/diff**", holdDiff);
    }
    const path = join(project, "polling.txt");
    try {
      await writeFile(path, "External creation\n");
      const row = page.locator(".diff-file").filter({ has: page.locator('[title="polling.txt"]') });
      await expect.poll(() => row.count()).toBe(1);
      await expect
        .poll(() => page.getByRole("button", { name: "Expand working.txt", exact: true }).count())
        .toBe(1);
      await writeFile(path, "External edit\nSecond line\n");
      await expect
        .poll(() => row.locator(".sr-only").textContent())
        .toBe("2 additions, 0 deletions");
      await unlink(path);
      await expect.poll(() => row.count()).toBe(0);
      await page.getByLabel("Hide context panel").click();
      await writeFile(path, "Created while closed\n");
      await page.getByLabel("Show context", { exact: true }).click();
      await expect.poll(() => row.count()).toBe(1);
    } finally {
      await unlink(path).catch(() => undefined);
    }
  });

  it("pastes screenshot and document attachments, preserves drafts across navigation, and sends their bytes", async () => {
    await ensureConnected();
    const session = await api.session.create({
      title: "Clipboard attachments",
      location: { directory: await realpath(project) },
    });
    const other = await api.session.create({
      title: "Clipboard other",
      location: { directory: await realpath(project) },
    });
    await selectSession(session.title);
    await page.getByRole("textbox", { name: "Prompt", exact: true }).evaluate((input) => {
      const clipboardData = new DataTransfer();
      const canvas = document.createElement("canvas");
      canvas.width = 8;
      canvas.height = 8;
      canvas.getContext("2d").fillRect(0, 0, 8, 8);
      const png = atob(canvas.toDataURL("image/png").split(",")[1]);
      clipboardData.items.add(
        new File([Uint8Array.from(png, (char) => char.charCodeAt(0))], "screenshot.png", {
          type: "image/png",
        }),
      );
      clipboardData.items.add(
        new File(["Clipboard document contents"], "notes.txt", { type: "text/plain" }),
      );
      clipboardData.items.add(new File(["remove me"], "remove.txt", { type: "text/plain" }));
      input.dispatchEvent(
        new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }),
      );
    });
    await page.getByRole("button", { name: "Remove remove.txt", exact: true }).click();
    await selectSession(other.title);
    expect(await page.getByRole("list", { name: "Attached files", exact: true }).count()).toBe(0);
    await selectSession(session.title);
    await page.getByRole("button", { name: "Remove screenshot.png", exact: true }).waitFor();
    const admitted = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/session/${session.id}/prompt`) &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const response = await admitted;
    expect(response.ok(), await response.text()).toBe(true);
    await page
      .getByRole("list", { name: "Attached files", exact: true })
      .waitFor({ state: "hidden" });
    await transcript("screenshot.png");
    await transcript("notes.txt");
    await idle();
    const messages = await api.message.list({ sessionID: session.id });
    const message = messages.data.find((item) => item.type === "user");
    expect(message.files.map((file) => ({ name: file.name, mime: file.mime }))).toEqual([
      { name: "screenshot.png", mime: "image/png" },
      { name: "notes.txt", mime: "text/plain" },
    ]);
    expect(Buffer.from(message.files[1].data, "base64").toString()).toBe(
      "Clipboard document contents",
    );
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

  it("loads, preserves, and replies to real pinned-server permission requests", async () => {
    await ensureConnected();
    const title = "Permission acceptance";
    const permissionSession = await createPermissionSession(title);
    const navigationTitle = "Permission navigation target";
    await createPermissionSession(navigationTitle);
    const beforeConnect = await createPermission(permissionSession.id, "acceptance.preexisting", {
      resources: ["/acceptance/preexisting/one", "/acceptance/preexisting/two"],
      source: { type: "tool", messageID: "msg_acceptance", id: "call_acceptance" },
    });

    await changeServer();
    await connect();
    await selectSession(title);
    const preexistingCard = permissionCard(beforeConnect);
    await preexistingCard.waitFor();
    await expect.poll(() => preexistingCard.textContent()).toContain("acceptance.preexisting");
    await expect.poll(() => preexistingCard.textContent()).toContain("/acceptance/preexisting/one");
    await expect.poll(() => preexistingCard.textContent()).toContain("/acceptance/preexisting/two");
    await expect.poll(() => preexistingCard.textContent()).toContain("call_acceptance");

    await selectSession(navigationTitle);
    expect(await preexistingCard.count()).toBe(0);
    await selectSession(title);
    const allowOnce = preexistingCard.getByRole("button", { name: "Allow once", exact: true });
    await allowOnce.focus();
    await page.keyboard.press("Enter");
    await expectPermissionSettled(permissionSession.id, beforeConnect);
    await expect
      .poll(() =>
        page
          .getByLabel("Prompt", { exact: true })
          .evaluate((node) => node === document.activeElement),
      )
      .toBe(true);

    const live = await createPermission(permissionSession.id, "acceptance.live");
    const liveCard = permissionCard(live);
    await liveCard.waitFor();
    await liveCard.getByRole("button", { name: "Allow once", exact: true }).click();
    await expectPermissionSettled(permissionSession.id, live);

    const rejected = await createPermission(permissionSession.id, "acceptance.reject.first");
    const rejectedTogether = await createPermission(
      permissionSession.id,
      "acceptance.reject.second",
    );
    await permissionCard(rejectedTogether).waitFor();
    await permissionCard(rejected).getByRole("button", { name: "Reject all", exact: true }).click();
    await expectPermissionSettled(permissionSession.id, rejected);
    await expectPermissionSettled(permissionSession.id, rejectedTogether);

    const savedPattern = "/acceptance/persist/*";
    const always = await createPermission(permissionSession.id, "acceptance.persist", {
      resources: ["/acceptance/persist/current"],
      save: [savedPattern],
    });
    const alwaysCard = permissionCard(always);
    await alwaysCard.waitFor();
    await expect.poll(() => alwaysCard.textContent()).toContain(savedPattern);
    await alwaysCard.getByRole("button", { name: "Always allow", exact: true }).click();
    await expectPermissionSettled(permissionSession.id, always);
    await expect
      .poll(async () =>
        (await api.permission.saved.list()).some(
          (rule) => rule.action === "acceptance.persist" && rule.resource === savedPattern,
        ),
      )
      .toBe(true);

    const external = await createPermission(permissionSession.id, "acceptance.external");
    await permissionCard(external).waitFor();
    await api.permission.reply({
      sessionID: permissionSession.id,
      requestID: external,
      reply: "once",
    });
    await expectPermissionSettled(permissionSession.id, external);
    expect(errors).toEqual([]);
  });

  it("discovers permissions across locations and revokes a saved approval", async () => {
    // Build the unavailable-location fixture without a live UI reloading its services.
    await page.goto("about:blank");
    const primaryDirectory = await warmPermissionLocation(project);
    const secondaryDirectory = await warmPermissionLocation(secondaryProject);
    const historicalProject = join(
      profile.paths.app,
      "permission-historical",
      "acceptance-project",
    );
    await preparePermissionProject(historicalProject, "Historical permission project");
    await writeFile(join(historicalProject, "opencode.json"), acceptanceConfig);
    const historicalDirectory = await warmPermissionLocation(historicalProject);
    const historicalTitle = "Historical permission location";
    await createPermissionSession(historicalTitle, historicalDirectory);
    await expect
      .poll(async () =>
        (await api.debug.location.list()).some(
          (location) => location.directory === historicalDirectory,
        ),
      )
      .toBe(true);
    await api.debug.location.evict({ location: { directory: historicalDirectory } });
    await expect
      .poll(async () =>
        (await api.debug.location.list()).some(
          (location) => location.directory === historicalDirectory,
        ),
      )
      .toBe(false);
    const movedHistoricalProject = join(profile.paths.app, "permission-historical-evicted");
    await rename(historicalProject, movedHistoricalProject);
    await expect(access(historicalDirectory)).rejects.toHaveProperty("code", "ENOENT");
    await access(movedHistoricalProject);
    await ensureConnected();
    const primaryTitle = "Primary permission inbox";
    const secondaryTitle = "Secondary permission inbox";
    const primarySession = await createPermissionSession(primaryTitle, primaryDirectory);
    const secondarySession = await createPermissionSession(secondaryTitle, secondaryDirectory);
    expect(primarySession.projectID).not.toBe(secondarySession.projectID);
    const primaryAction = "acceptance.management.saved";
    const secondaryAction = "acceptance.management.once";
    const primaryResource = "/acceptance/management/current";
    const secondaryResource = "/acceptance/management/secondary";
    const savedPattern = "/acceptance/management/**/raw pattern";
    const primaryRequest = await createPermission(primarySession.id, primaryAction, {
      directory: primaryDirectory,
      resources: [primaryResource],
      save: [savedPattern],
    });
    const secondaryRequest = await createPermission(secondarySession.id, secondaryAction, {
      directory: secondaryDirectory,
      resources: [secondaryResource],
    });

    const primaryLocationRequests = await api.permission.request.list({
      location: { directory: primaryDirectory },
    });
    const secondaryLocationRequests = await api.permission.request.list({
      location: { directory: secondaryDirectory },
    });
    expect(primaryLocationRequests.data.map((request) => request.id)).toContain(primaryRequest);
    expect(primaryLocationRequests.data.map((request) => request.id)).not.toContain(
      secondaryRequest,
    );
    expect(secondaryLocationRequests.data.map((request) => request.id)).toContain(secondaryRequest);
    expect(secondaryLocationRequests.data.map((request) => request.id)).not.toContain(
      primaryRequest,
    );

    let inventorySeen = false;
    const permissionDiscovery = [];
    const observeDiscovery = (request) => {
      const url = new URL(request.url());
      if (request.method() !== "GET") return;
      if (url.pathname === "/api/debug/location") {
        inventorySeen = true;
        return;
      }
      if (url.pathname !== "/api/permission/request") return;
      permissionDiscovery.push({
        afterInventory: inventorySeen,
        directory: url.searchParams.get("location[directory]"),
      });
    };
    await changeServer();
    page.on("request", observeDiscovery);
    await connect();
    await page.getByRole("button", { name: new RegExp(`^${historicalTitle},`, "u") }).waitFor();
    const launcher = page.getByRole("button", {
      name: /^Permissions, 2 pending permission requests/u,
    });
    await launcher.waitFor();
    await launcher.click();
    let dialog = page.getByRole("dialog", { name: "Permissions", exact: true });
    await dialog.waitFor();
    const primaryGroup = dialog.getByRole("group", {
      name: `Permissions for ${primaryTitle}`,
      exact: true,
    });
    const secondaryGroup = dialog.getByRole("group", {
      name: `Permissions for ${secondaryTitle}`,
      exact: true,
    });
    await primaryGroup.waitFor();
    await secondaryGroup.waitFor();
    await expect.poll(() => primaryGroup.textContent()).toContain(primaryDirectory);
    await expect.poll(() => primaryGroup.textContent()).toContain(primaryAction);
    await expect.poll(() => primaryGroup.textContent()).toContain(primaryResource);
    await expect.poll(() => secondaryGroup.textContent()).toContain(secondaryDirectory);
    await expect.poll(() => secondaryGroup.textContent()).toContain(secondaryAction);
    await expect.poll(() => secondaryGroup.textContent()).toContain(secondaryResource);
    await dialog.getByRole("button", { name: "Refresh pending permissions", exact: true }).click();
    await dialog
      .getByText("Loading pending permissions…", { exact: true })
      .waitFor({ state: "hidden" });
    await expect
      .poll(
        () =>
          permissionDiscovery.some((request) => request.directory === primaryDirectory) &&
          permissionDiscovery.some((request) => request.directory === secondaryDirectory),
      )
      .toBe(true);
    expect(permissionDiscovery.every((request) => request.afterInventory)).toBe(true);
    expect(permissionDiscovery.some((request) => request.directory === historicalDirectory)).toBe(
      false,
    );
    page.off("request", observeDiscovery);
    await secondaryGroup
      .getByRole("button", { name: `Open session ${secondaryTitle}`, exact: true })
      .click();

    const secondaryCard = permissionCard(secondaryRequest);
    await secondaryCard.waitFor();
    await secondaryCard.getByRole("button", { name: "Allow once", exact: true }).click();
    await expectPermissionSettled(secondarySession.id, secondaryRequest, secondaryDirectory);
    await expect
      .poll(async () =>
        (
          await api.permission.request.list({ location: { directory: secondaryDirectory } })
        ).data.some((request) => request.id === secondaryRequest),
      )
      .toBe(false);

    await page.getByRole("button", { name: /^Permissions, 1 pending permission request/u }).click();
    dialog = page.getByRole("dialog", { name: "Permissions", exact: true });
    await dialog.waitFor();
    expect(
      await dialog
        .getByRole("group", { name: `Permissions for ${secondaryTitle}`, exact: true })
        .count(),
    ).toBe(0);
    await dialog
      .getByRole("group", { name: `Permissions for ${primaryTitle}`, exact: true })
      .getByRole("button", { name: `Open session ${primaryTitle}`, exact: true })
      .click();

    const primaryCard = permissionCard(primaryRequest);
    await primaryCard.waitFor();
    await primaryCard.getByRole("button", { name: "Always allow", exact: true }).click();
    await expectPermissionSettled(primarySession.id, primaryRequest, primaryDirectory);
    let savedRuleID;
    await expect
      .poll(async () => {
        const saved = await api.permission.saved.list({ projectID: primarySession.projectID });
        const rule = saved.find(
          (candidate) => candidate.action === primaryAction && candidate.resource === savedPattern,
        );
        savedRuleID = rule?.id;
        return rule === undefined ? "" : `${rule.action}\u0000${rule.resource}`;
      })
      .toBe(`${primaryAction}\u0000${savedPattern}`);
    expect(await api.permission.saved.list({ projectID: secondarySession.projectID })).toEqual([]);

    const emptyLauncher = page.getByRole("button", {
      name: /^Permissions, 0 pending permission requests/u,
    });
    await emptyLauncher.click();
    dialog = page.getByRole("dialog", { name: "Permissions", exact: true });
    await dialog.getByRole("tab", { name: "Saved approvals", exact: true }).click();
    let savedRule = dialog
      .getByRole("group")
      .filter({ hasText: primaryAction })
      .filter({ hasText: savedPattern });
    await savedRule.waitFor();
    await expect.poll(() => dialog.textContent()).toContain(primaryDirectory);
    await expect.poll(() => dialog.textContent()).toContain(primarySession.projectID);
    const revokeLabel = `Revoke saved approval for ${primaryAction} and ${savedPattern}`;

    await savedRule.getByRole("button", { name: revokeLabel, exact: true }).click();
    const escapeCancel = savedRule.getByRole("button", { name: "Cancel", exact: true });
    await escapeCancel.focus();
    await page.keyboard.press("Escape");
    await savedRule.getByRole("button", { name: revokeLabel, exact: true }).waitFor();
    expect(
      (await api.permission.saved.list({ projectID: primarySession.projectID })).some(
        (rule) => rule.id === savedRuleID,
      ),
    ).toBe(true);

    await savedRule.getByRole("button", { name: revokeLabel, exact: true }).click();
    await savedRule.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(
      (await api.permission.saved.list({ projectID: primarySession.projectID })).some(
        (rule) => rule.id === savedRuleID,
      ),
    ).toBe(true);

    await savedRule.getByRole("button", { name: revokeLabel, exact: true }).click();
    const confirmRevoke = savedRule.getByRole("button", {
      name: "Confirm revoke",
      exact: true,
    });
    await confirmRevoke.focus();
    await page.keyboard.press("Enter");
    await expect
      .poll(async () =>
        (await api.permission.saved.list({ projectID: primarySession.projectID })).some(
          (rule) => rule.id === savedRuleID,
        ),
      )
      .toBe(false);
    await savedRule.waitFor({ state: "hidden" });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const active = document.activeElement;
          if (!(active instanceof HTMLElement)) return false;
          if (active.getAttribute("aria-label") === "Saved approvals") return true;
          if (active.textContent?.trim() === "Refresh saved approvals") return true;
          return (
            active.getAttribute("aria-label")?.startsWith("Revoke saved approval for ") ?? false
          );
        }),
      )
      .toBe(true);

    await dialog.getByLabel("Close permissions dialog", { exact: true }).click();
    await expect
      .poll(() => emptyLauncher.evaluate((node) => node === document.activeElement))
      .toBe(true);
    await emptyLauncher.click();
    dialog = page.getByRole("dialog", { name: "Permissions", exact: true });
    await dialog.getByRole("tab", { name: "Saved approvals", exact: true }).click();
    await dialog.getByRole("button", { name: "Refresh saved approvals", exact: true }).click();
    await dialog
      .getByText("Loading saved approvals…", { exact: true })
      .waitFor({ state: "hidden" });
    savedRule = dialog
      .getByRole("group")
      .filter({ hasText: primaryAction })
      .filter({ hasText: savedPattern });
    await expect.poll(() => savedRule.count()).toBe(0);
    expect(
      (await api.permission.saved.list({ projectID: primarySession.projectID })).some(
        (rule) => rule.id === savedRuleID,
      ),
    ).toBe(false);
    await dialog.getByLabel("Close permissions dialog", { exact: true }).click();
    expect(errors).toEqual([]);
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
