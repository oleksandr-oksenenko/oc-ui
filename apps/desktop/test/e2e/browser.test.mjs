import { createProfile } from "./profile.mjs";
import { OpenCode } from "@opencode/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";
import { build, preview } from "vite-plus";
import { chromium } from "playwright";
import { access, mkdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
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
let addedProject;
let page;
let uiUrl;
let api;
let acceptanceConfig;
let failed = false;
let permissionRequestNumber = 0;
const errors = [];
const artifacts = new URL("../../dist/web-artifacts/", import.meta.url).pathname;

// A 1×1 PNG so the resolved server file decodes as a real image.
const acceptancePng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=",
  "base64",
);

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
  addedProject = join(profile.paths.app, "added-project");
  await Promise.all([
    prepareProjectFixture(project),
    preparePermissionProject(secondaryProject, "Secondary permission project"),
    mkdir(addedProject, { recursive: true }),
  ]);
  for (const name of ["review", "testing"]) {
    const directory = join(project, ".agents", "skills", name);
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "SKILL.md"),
      `---\nname: ${name}\ndescription: Acceptance ${name} skill\n---\nAcceptance ${name} instructions.\n`,
    );
  }
  await git(project, "add", ".agents/skills");
  await git(project, "commit", "-m", "Add acceptance skill fixtures");
  acceptanceConfig = JSON.stringify({
    ...provider.config,
    providers: {
      ...provider.config.providers,
      acceptance: {
        ...provider.config.providers.acceptance,
        models: {
          ...provider.config.providers.acceptance.models,
          alternate: {
            ...provider.config.providers.acceptance.models.alternate,
            variants: [{ id: "high", settings: { reasoningEffort: "high" } }],
          },
        },
      },
    },
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
  const globalConfig = join(profile.paths.config, "opencode");
  await mkdir(globalConfig, { recursive: true });
  await writeFile(
    join(globalConfig, "opencode.json"),
    JSON.stringify({
      ...provider.config,
      plugins: [
        {
          package: new URL("../../../../packages/opencode-session-tools/dist/", import.meta.url)
            .href,
        },
      ],
    }),
  );
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
  await expect.poll(() => page.getByLabel("Prompt", { exact: true }).textContent()).toBe("");
}

async function providerState() {
  return (await fetch(`${provider.url}/_state`)).json();
}

async function sendCompleted(text) {
  const selectedSession = await page
    .locator('.shell-session-main[aria-current="page"]')
    .elementHandle();
  expect(selectedSession).not.toBeNull();
  const title = await selectedSession.$eval(".shell-session-title", (node) => node.textContent);
  const matchingSessions = (await api.session.list({ limit: 100 })).data.filter(
    (session) => session.title === title,
  );
  expect(matchingSessions).toHaveLength(1);
  const completed = page.locator(".transcript-assistant-complete");
  const before = await completed.count();
  const requestsBefore = (await providerState()).requests.length;
  const admitted = page.waitForResponse(
    (response) =>
      /\/session\/[^/]+\/prompt$/u.test(new URL(response.url()).pathname) &&
      response.request().method() === "POST",
  );
  await send(text);
  const response = await admitted;
  expect(response.ok(), await response.text()).toBe(true);
  const sessionID = decodeURIComponent(new URL(response.url()).pathname.split("/").at(-2));
  expect(sessionID).toBe(matchingSessions[0].id);
  await expect.poll(() => completed.count()).toBeGreaterThan(before);
  await expect.poll(() => completed.last().textContent()).toContain("Acceptance completed with");
  await expect
    .poll(async () =>
      (await providerState()).requests
        .slice(requestsBefore)
        .some((request) => request.model !== "title" && request.prompt.includes(text)),
    )
    .toBe(true);
  expect(await selectedSession.getAttribute("aria-current")).toBe("page");
  const messageID = await completed.last().getAttribute("data-message-id");
  await expect
    .poll(async () =>
      (await api.message.list({ sessionID })).data.some(
        (message) =>
          message.id === messageID &&
          message.type === "assistant" &&
          message.time.completed !== undefined,
      ),
    )
    .toBe(true);
  await idle();
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

async function addAnnotation(body) {
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
  await page.getByPlaceholder("Write a question or note…").fill(body);
  await page.keyboard.press("Enter");
  await page.locator(".annotation-inline-editor").waitFor({ state: "hidden" });
  await page.getByLabel("Prompt", { exact: true }).click();
  await page.locator(".annotation-popover").waitFor({ state: "hidden" });
  await page.getByLabel("Discard 1 annotations").waitFor();
}

async function selectSession(title, target = page) {
  const session = target.getByRole("button", { name: new RegExp(`^${title},`, "u") });
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
    const directory = page.locator(".server-directory-browser-path");
    await expect.poll(() => directory.textContent()).toBe(await realpath(project));
    await page.getByRole("button", { name: "Browse directory folder-00/", exact: true }).click();
    await page.getByText("No child directories.", { exact: true }).waitFor();
    await page.getByLabel("Go to parent directory").click();
    await expect.poll(() => directory.textContent()).toBe(await realpath(project));
    await page.setViewportSize({ width: 430, height: 600 });
    await page.locator('[aria-label="Directories"]').evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    expect(
      await page.locator('[aria-label="Directories"]').evaluate((node) => node.scrollTop),
    ).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: join(artifacts, "browser-directory-narrow.png") });
    await page.keyboard.press("Escape");
    await expect
      .poll(() =>
        page
          .getByRole("button", { name: "Add project", exact: true })
          .evaluate((node) => node === document.activeElement),
      )
      .toBe(true);
    await page.getByRole("button", { name: "Add project", exact: true }).click();
    await expect.poll(() => directory.textContent()).toBe(await realpath(project));
    await page.locator('.server-flow-dialog button[type="submit"]').click();
    const projectPicker = page.locator(".new-session-project-trigger");
    await projectPicker.click();
    await page.getByPlaceholder("Search projects").waitFor();
    await page.keyboard.press("Escape");
    await expect
      .poll(() => projectPicker.evaluate((node) => node === document.activeElement))
      .toBe(true);
    await page.locator('.server-flow-dialog button[type="submit"]').click();
    await page.getByLabel("Prompt", { exact: true }).waitFor();
    await page.locator(".transcript-empty-state").waitFor();
    expect(await page.getByRole("button", { name: "Send", exact: true }).isDisabled()).toBe(true);
    expect(await page.locator(".titlebar-session-title").textContent()).toBe("Untitled session");
    await page.getByLabel("Prompt", { exact: true }).fill("Independent draft");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.getByRole("button", { name: "Show sessions", exact: true }).click();
    await opener.click();
    await page.locator('.server-flow-dialog button[type="submit"]').click();
    await expect.poll(() => page.getByLabel("Prompt", { exact: true }).textContent()).toBe("");
    expect(await page.locator(".shell-session-main").count()).toBe(2);
    await page.locator('.shell-session-main:not([aria-current="page"])').click();
    await expect
      .poll(() => page.getByLabel("Prompt", { exact: true }).textContent())
      .toBe("Independent draft");
    expect(await page.evaluate(() => document.documentElement.dataset.host)).toBe("browser");
  });

  it("switches palettes without replacing the workspace and restores the choice after reload", async () => {
    const prompt = await page.getByLabel("Prompt", { exact: true }).elementHandle();
    await page.getByRole("button", { name: "Switch to dark theme" }).click();
    await expect.poll(() => page.locator("html").getAttribute("data-color-scheme")).toBe("dark");
    expect(
      await page.locator("html").evaluate((node) => getComputedStyle(node).backgroundColor),
    ).toBe("rgb(0, 0, 0)");
    expect(await prompt.evaluate((node) => node.isConnected)).toBe(true);
    expect(await page.getByLabel("Prompt", { exact: true }).textContent()).toBe(
      "Independent draft",
    );
    const second = await context.newPage();
    try {
      await second.goto(uiUrl);
      await second.getByRole("button", { name: "Switch to light theme" }).waitFor();
      await second.reload();
      await second.getByRole("button", { name: "Switch to light theme" }).click();
      await second.reload();
      await second.getByRole("button", { name: "Switch to dark theme" }).waitFor();
      expect(await second.locator("html").getAttribute("data-color-scheme")).toBe("light");
    } finally {
      await second.close();
    }
    const toggle = page.getByRole("button", { name: "Switch to light theme" });
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => page.locator("html").getAttribute("data-color-scheme")).toBe("light");
    expect(await prompt.evaluate((node) => node.isConnected)).toBe(true);
  });

  it("streams prompts, resolves questions, stops real provider work, and reconnects after transport loss", async () => {
    await send("E2E_STREAM browser");
    await transcript("Acceptance first streamed fragment.");
    await page.getByRole("button", { name: "Stop", exact: true }).waitFor();
    await transcript("Acceptance completed with stream.");
    await idle();
    await send("E2E_QUESTION browser");
    await page.locator(".question-form").waitFor();
    await expect
      .poll(() => page.locator('.shell-session-row.selected [data-status="question"]').count())
      .toBe(1);
    await page.locator(".question-form label").filter({ hasText: "Alpha" }).click();
    await page.locator('.question-form button[type="submit"]').click();
    await transcript("Acceptance question resolved:");
    await expect
      .poll(() => page.locator(".shell-session-row.selected .shell-session-attention-dot").count())
      .toBe(0);
    await idle();
    const answeredTool = page.locator(".transcript-tool-completed").last();
    expect(await answeredTool.locator('[data-slot="collapsible-content"]').count()).toBe(0);
    await answeredTool.locator(".transcript-tool-header").click();
    await expect
      .poll(() => answeredTool.locator(".transcript-tool-details").textContent())
      .toContain("Alpha");
    await answeredTool.locator(".transcript-tool-header").click();
    await expect
      .poll(() => answeredTool.locator('[data-slot="collapsible-content"]').count())
      .toBe(0);
    expect(
      (await providerState()).requests.some(
        (request) =>
          request.prompt.includes("E2E_QUESTION browser") &&
          (JSON.stringify(request.toolReply) ?? "").includes("Alpha"),
      ),
    ).toBe(true);
    await send("E2E_QUESTION_CANCEL browser");
    await page.locator(".question-form").waitFor();
    await page
      .locator(".question-form")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await page.locator(".question-form").waitFor({ state: "hidden" });
    await idle();
    await page.locator(".transcript-tool-error .transcript-tool-header").last().click();
    await transcript("The user dismissed this question");
    await send("E2E_PROVIDER_ERROR browser");
    await transcript("Acceptance provider rejected this prompt");
    await idle();
    expect(await page.locator(".transcript-assistant-failed").count()).toBeGreaterThan(0);
    const previousCancelled = (await providerState()).cancelledStreams;
    await send("E2E_STOP browser");
    await transcript("Acceptance stream is waiting for cancellation.");
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await idle();
    await expect
      .poll(async () => (await (await fetch(`${provider.url}/_state`)).json()).cancelledStreams)
      .toBeGreaterThan(previousCancelled);
    proxy.disconnect();
    await page.getByRole("button", { name: /Select server, .*Reconnecting/u }).waitFor();
    proxy.reconnect();
    await page.getByRole("button", { name: /Select server, .*Connected/u }).waitFor();
    await sendCompleted("E2E_RECOVER browser");
    expect(errors).toEqual([]);
  });

  it("queues, cancels, steers and restores server-owned pending messages after reload", async () => {
    const before = (await providerState()).requests.length;
    const admitted = page.waitForResponse(
      (response) =>
        /\/session\/[^/]+\/prompt$/u.test(new URL(response.url()).pathname) &&
        response.request().method() === "POST",
    );
    await send("E2E_QUEUE_HOLD browser");
    const sessionID = decodeURIComponent(
      new URL((await admitted).url()).pathname.split("/").at(-2),
    );
    await page.getByRole("button", { name: "Stop", exact: true }).waitFor();
    const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
    const pending = page.getByRole("region", { name: "Pending messages" });
    for (const text of [
      "First queued review",
      "Remove this task",
      "Middle queued task",
      "Last queued task",
    ]) {
      if (text === "First queued review") {
        await prompt.fill("First queued ");
        await prompt.press("End");
        await prompt.pressSequentially("/rev");
        await page.getByRole("button", { name: /\/review Acceptance review/ }).waitFor();
        await prompt.press("Enter");
        await prompt.press("Backspace");
      } else await prompt.fill(text);
      await prompt.press("Meta+Enter");
      await expect.poll(() => prompt.textContent()).toBe("");
      await pending.getByText(text, { exact: true }).waitFor();
    }
    expect(
      (await api.session.inbox.list({ sessionID })).filter((item) => item.type === "user"),
    ).toHaveLength(4);
    expect(await page.locator(".transcript-view").textContent()).not.toContain(
      "First queued review",
    );
    await pending
      .getByRole("button", { name: "Cancel message: Remove this task", exact: true })
      .click();
    await pending.getByText("Remove this task", { exact: true }).waitFor({ state: "hidden" });
    await page.reload();
    await connect();
    await page.getByRole("button", { name: "Stop", exact: true }).waitFor();
    await pending.getByText("First queued review", { exact: true }).waitFor();
    await pending
      .locator("li")
      .filter({ hasText: "First queued review" })
      .getByRole("button", { name: "Steer now" })
      .click();
    await expect
      .poll(
        async () =>
          (await api.session.inbox.list({ sessionID })).find(
            (item) => item.type === "user" && item.payload.text === "First queued review",
          )?.delivery,
      )
      .toBe("steer");
    await prompt.fill("Direct steering task");
    await prompt.press("Enter");
    await expect.poll(() => prompt.textContent()).toBe("");
    await pending.getByText("Direct steering task", { exact: true }).waitFor();
    provider.releaseHeld();
    await pending.waitFor({ state: "hidden" });
    await idle();
    await transcript("First queued review");
    await transcript("Direct steering task");
    await transcript("Last queued task");
    const requests = (await providerState()).requests
      .slice(before)
      .filter((item) => item.model !== "title");
    expect(requests.some((item) => item.prompt.includes("Remove this task"))).toBe(false);
    const steerIndex = requests.findIndex((item) => item.prompt.includes("Direct steering task"));
    const middleIndex = requests.findIndex((item) => item.prompt.includes("Middle queued task"));
    const queueIndex = requests.findIndex((item) => item.prompt.includes("Last queued task"));
    const messages = await api.message.list({ sessionID });
    const selected = messages.data.find(
      (message) => message.type === "user" && message.text === "First queued review",
    );
    expect(selected.skills).toEqual([
      expect.objectContaining({
        name: "review",
        mention: { start: 13, end: 19, text: "review" },
        text: expect.stringContaining("Acceptance review instructions."),
      }),
    ]);
    expect(steerIndex).toBeGreaterThan(0);
    expect(middleIndex).toBeGreaterThan(steerIndex);
    expect(queueIndex).toBeGreaterThan(middleIndex);
  });

  it("marks completed background turns until their session is opened", async () => {
    const previousTitle = await page.locator(".titlebar-session-title").textContent();
    const background = await createPermissionSession("Attention background");
    const navigation = await createPermissionSession("Attention navigation");
    await selectSession("Attention background");
    await send("E2E_STREAM attention");
    await transcript("Acceptance first streamed fragment.");
    await selectSession("Attention navigation");
    const finished = page.getByRole("button", {
      name: "Attention background, Turn completed",
      exact: true,
    });
    await finished.waitFor();
    await finished.click();
    await expect
      .poll(() => page.locator(".shell-session-row.selected .shell-session-attention-dot").count())
      .toBe(0);
    await transcript("Acceptance completed with stream.");
    await idle();
    await selectSession(previousTitle);
    await api.session.remove({ sessionID: background.id });
    await api.session.remove({ sessionID: navigation.id });
    await expect
      .poll(() =>
        page.getByRole("button", { name: /^Attention (background|navigation),/u }).count(),
      )
      .toBe(0);
  });

  it("records the viewed idle watermark when the selected session finishes a turn", async () => {
    await ensureConnected();
    const session = await api.session.create({
      title: "View acknowledgement",
      location: { directory: await realpath(project) },
    });
    await selectSession(session.title);
    await send("E2E_STREAM browser view");
    await transcript("Acceptance completed with stream.");
    await idle();
    await expect
      .poll(async () => {
        const info = await api.session.get({ sessionID: session.id });
        return (
          info.time.idle !== undefined &&
          info.time.viewed !== undefined &&
          info.time.viewed >= info.time.idle
        );
      })
      .toBe(true);
    await api.session.remove({ sessionID: session.id });
    await expect
      .poll(() => page.getByRole("button", { name: /^View acknowledgement,/u }).count())
      .toBe(0);
  });

  it("submits annotations and reviews through the same server-backed workspace", async () => {
    await page.getByLabel(/^Model:/u).click();
    await page.getByPlaceholder("Search models").fill("Acceptance Alternate");
    await page
      .locator(".composer-model-option")
      .filter({ hasText: "Acceptance Alternate" })
      .click();
    await page.getByLabel("Model: Acceptance Alternate", { exact: true }).waitFor();
    await transcript("Model switched");
    await sendCompleted("E2E_ALTERNATE browser picker");
    expect(
      (await providerState()).requests.some(
        (request) =>
          request.model === "alternate" && request.prompt.includes("E2E_ALTERNATE browser picker"),
      ),
    ).toBe(true);
    await page.getByLabel(/^Agent:/u).click();
    await page.getByRole("option").filter({ hasText: "acceptance-agent" }).click();
    await page.getByLabel("Agent: acceptance-agent", { exact: true }).waitFor();
    await transcript("Agent switched");
    await page.getByLabel(/^Agent:/u).click();
    await page.getByRole("option", { name: "Build", exact: true }).click();
    await page.getByLabel("Agent: Build", { exact: true }).waitFor();
    await page.getByLabel(/^Model:/u).click();
    await page.getByPlaceholder("Search models").fill("Acceptance Stream");
    await page.locator(".composer-model-option").filter({ hasText: "Acceptance Stream" }).click();
    await transcript("acceptance/alternate → acceptance/stream");
    await expect
      .poll(() =>
        page
          .getByLabel("Model: Acceptance Stream", { exact: true })
          .evaluate((node) => node === document.activeElement),
      )
      .toBe(true);
    await addAnnotation("Browser note to discard.");
    await page.getByLabel("Discard 1 annotations").click();
    await page.getByLabel("Discard 1 annotations").waitFor({ state: "hidden" });
    const annotation = "Browser annotation reaches the provider.";
    await addAnnotation(annotation);
    await sendCompleted("E2E_ANNOTATION browser");
    await page.locator(".transcript-annotation-trigger").click();
    await transcript(annotation);
    await page.locator(".transcript-annotation-quote").click();
    await page.locator(".annotation-popover").waitFor();
    expect(await page.getByLabel("Remove comment", { exact: true }).count()).toBe(0);
    await page.locator(".titlebar-session-title").click();
    await page.locator(".annotation-popover").waitFor({ state: "hidden" });
    const selectedLabel = await page
      .locator('.shell-session-main[aria-current="page"]')
      .getAttribute("aria-label");
    await page.locator('.shell-session-main:not([aria-current="page"])').first().click();
    await page.locator(".transcript-empty-state").waitFor();
    await page.getByRole("button", { name: selectedLabel, exact: true }).click();
    await transcript("E2E_STREAM browser");
    await page.locator(".transcript-annotation-trigger").waitFor();
    if (await page.getByLabel("Show context", { exact: true }).count())
      await page.getByLabel("Show context", { exact: true }).click();
    const diff = page.locator(".diff-code-view diffs-container").first();
    // Worker highlighting re-renders the item, which can detach the gutter
    // button between hover and click. Retry until the editor is open.
    const editor = page.getByLabel("Comment on working.txt");
    await expect
      .poll(
        async () => {
          if ((await editor.count()) > 0) return true;
          await diff
            .locator('[data-column-number="1"][data-line-type="change-addition"]')
            .hover()
            .catch(() => undefined);
          const utility = diff.locator("[data-utility-button]");
          if ((await utility.count()) === 0) return false;
          await utility.click({ timeout: 1_000 }).catch(() => undefined);
          return (await editor.count()) > 0;
        },
        { timeout: 20_000, interval: 200 },
      )
      .toBe(true);
    const review = "Browser review survives panel remount.";
    await page.getByLabel("Comment on working.txt").fill(review);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Switch to dark theme" }).click();
    await expect
      .poll(() => diff.evaluate((node) => getComputedStyle(node).colorScheme))
      .toBe("dark");
    await expect.poll(() => page.locator(".diff-review-text").textContent()).toBe(review);
    await page.getByRole("button", { name: "Switch to light theme" }).click();
    await expect
      .poll(() => diff.evaluate((node) => getComputedStyle(node).colorScheme))
      .toBe("light");
    await page.getByLabel("Hide context panel").click();
    await page.getByLabel("Show context").click();
    await expect.poll(() => page.locator(".diff-review-text").textContent()).toBe(review);
    await sendCompleted("E2E_REVIEW browser");
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
    await page.locator(".diff-comparison-select").click();
    await page.getByText("Changes vs main", { exact: true }).click();
    await page.locator(".diff-file-path", { hasText: /^branch\.txt$/ }).waitFor();
    await page.locator(".diff-file-path", { hasText: /^working\.txt$/ }).waitFor();
    await page.locator(".diff-comparison-select").click();
    await page.getByText("Working changes", { exact: true }).click();
    await page
      .locator(".diff-file-path", { hasText: /^branch\.txt$/ })
      .waitFor({ state: "hidden" });
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
      const row = page
        .locator(".diff-file")
        .filter({ has: page.locator(".diff-file-path", { hasText: /^polling\.txt$/ }) });
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

  it("restores inline skills across sessions and sends server-resolved attachments with mention offsets", async () => {
    await ensureConnected();
    const location = { directory: await realpath(project) };
    const available = await api.skill.list({ location });
    expect(available.data.map((skill) => skill.name)).toEqual(
      expect.arrayContaining(["review", "testing"]),
    );
    const session = await api.session.create({ title: "Skill attachments", location });
    const other = await api.session.create({ title: "Skill other", location });
    await selectSession(session.title);
    const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
    await prompt.fill("Use ");
    await prompt.press("End");
    await prompt.pressSequentially("/rev");
    await page.getByRole("button", { name: /\/review Acceptance review/ }).waitFor();
    await prompt.press("Enter");
    await page.getByRole("button", { name: "Remove review skill" }).waitFor();
    await prompt.pressSequentially("and /test");
    await page.getByRole("button", { name: /\/testing Acceptance testing/ }).waitFor();
    await prompt.press("Enter");
    await selectSession(other.title);
    expect(await page.locator(".prompt-skill-chip").count()).toBe(0);
    await selectSession(session.title);
    await page.getByRole("button", { name: "Remove testing skill" }).waitFor();
    expect(await page.locator(".prompt-skill-chip").count()).toBe(2);
    const admitted = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/session/${session.id}/prompt`) &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const response = await admitted;
    expect(response.ok(), await response.text()).toBe(true);
    await expect.poll(() => prompt.textContent()).toBe("");
    await idle();
    const messages = await api.message.list({ sessionID: session.id });
    const message = messages.data.find((item) => item.type === "user");
    expect(message.text).toBe("Use review and testing ");
    expect(message.skills.map((skill) => ({ name: skill.name, mention: skill.mention }))).toEqual([
      { name: "review", mention: { start: 4, end: 10, text: "review" } },
      { name: "testing", mention: { start: 15, end: 22, text: "testing" } },
    ]);
    expect(message.skills[0].text).toContain("Acceptance review instructions.");
    expect(message.skills[1].text).toContain("Acceptance testing instructions.");
    await expect
      .poll(() => page.locator(".transcript-skill-chip").allTextContents())
      .toEqual(["review", "testing"]);
    expect(await page.getByRole("list", { name: "Attachments", exact: true }).count()).toBe(0);
  });

  it("runs a built-in slash command from the composer suggestions and clears the draft", async () => {
    await ensureConnected();
    const location = { directory: await realpath(project) };
    const available = await api.command.list({ location });
    expect(available.data.map((command) => command.name)).toEqual(
      expect.arrayContaining(["init", "review"]),
    );
    const session = await api.session.create({ title: "Slash commands", location });
    await selectSession(session.title);
    const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
    await prompt.click();
    await prompt.pressSequentially("/ini");
    await page.getByText("Commands", { exact: true }).waitFor();
    await page.getByRole("button", { name: /\/init/ }).waitFor();
    await prompt.press("Enter");
    await expect.poll(() => prompt.textContent()).toBe("/init ");
    await prompt.pressSequentially("focus on scripts");

    const admitted = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/session/${session.id}/command`) &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const response = await admitted;
    expect(response.ok()).toBe(true);
    await expect.poll(() => prompt.textContent()).toBe("");
    await idle();

    const messages = await api.message.list({ sessionID: session.id });
    const user = messages.data.filter((item) => item.type === "user").at(-1);
    expect(user.text).toContain("focus on scripts");
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
    await expect
      .poll(() =>
        page
          .locator(".composer-file-preview img")
          .evaluate((image) => (image instanceof HTMLImageElement ? image.naturalWidth : 0)),
      )
      .toBeGreaterThan(0);
    await selectSession(other.title);
    expect(await page.getByRole("list", { name: "Images and files", exact: true }).count()).toBe(0);
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
      .getByRole("list", { name: "Images and files", exact: true })
      .waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Enlarge screenshot.png", exact: true }).waitFor();
    await transcript("notes.txt");
    await expect
      .poll(() =>
        page
          .locator(".transcript-user-image img")
          .evaluate((image) => (image instanceof HTMLImageElement ? image.naturalWidth : 0)),
      )
      .toBeGreaterThan(0);

    // The modal preview dismisses on a backdrop click but not an image click,
    // and returns focus to the thumbnail.
    const enlarge = page.getByRole("button", { name: "Enlarge screenshot.png", exact: true });
    const previewDialog = page.getByRole("dialog", { name: "Preview of screenshot.png" });
    await enlarge.click();
    await previewDialog.waitFor();
    await page.mouse.click(20, 300);
    await previewDialog.waitFor({ state: "hidden" });
    await expect
      .poll(() => enlarge.evaluate((element) => element === document.activeElement))
      .toBe(true);

    await enlarge.click();
    await previewDialog.waitFor();
    await page.locator(".image-preview-image").click();
    await expect.poll(() => previewDialog.isVisible()).toBe(true);
    await page.keyboard.press("Escape");
    await previewDialog.waitFor({ state: "hidden" });

    await idle();
    const messages = await api.message.list({ sessionID: session.id });
    const message = messages.data.find((item) => item.type === "user");
    expect(message.files.map((file) => ({ name: file.name, mime: file.mime }))).toEqual([
      { name: "screenshot.png", mime: "image/png" },
      { name: "notes.txt", mime: "text/plain" },
    ]);
    expect(message.files.every((file) => file.source.type === "inline")).toBe(true);
    expect(Buffer.from(message.files[1].data, "base64").toString()).toBe(
      "Clipboard document contents",
    );
  });

  it("attaches files chosen through the picker button and sends their bytes", async () => {
    await ensureConnected();
    const session = await api.session.create({
      title: "Picker attachments",
      location: { directory: await realpath(project) },
    });
    await selectSession(session.title);
    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Add images and files", exact: true }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles([
      {
        name: "picked.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Picked document contents"),
      },
    ]);
    await page.getByRole("button", { name: "Remove picked.txt", exact: true }).waitFor();
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page
      .getByRole("list", { name: "Images and files", exact: true })
      .waitFor({ state: "hidden" });
    await transcript("picked.txt");
    await idle();
    const messages = await api.message.list({ sessionID: session.id });
    const message = messages.data.find((item) => item.type === "user");
    expect(message.files.map((file) => ({ name: file.name, mime: file.mime }))).toEqual([
      { name: "picked.txt", mime: "text/plain" },
    ]);
    expect(message.files[0].source).toEqual({ type: "inline" });
    expect(Buffer.from(message.files[0].data, "base64").toString()).toBe(
      "Picked document contents",
    );
  });

  it("creates and removes an isolated server worktree with cancel and reopen", async () => {
    await git(project, "commit", "--allow-empty", "-m", "local worktree base");
    await git(project, "branch", "-f", "main", "HEAD");
    const localMain = await git(project, "rev-parse", "refs/heads/main");
    expect(localMain).not.toBe(await git(project, "rev-parse", "origin/main"));
    await page.screenshot({ path: join(artifacts, "browser-connected.png") });
    const before = await git(project, "worktree", "list", "--porcelain");
    await page.getByLabel("Create session", { exact: true }).click();
    await page.getByRole("button", { name: "Start in worktree", exact: true }).click();
    // A newly created session starts with the context panel closed.
    if (await page.getByLabel("Show context", { exact: true }).count())
      await page.getByLabel("Show context", { exact: true }).click();
    await page.getByText("No working tree changes", { exact: true }).waitFor();
    const after = await git(project, "worktree", "list", "--porcelain");
    const worktree = after
      .split("\n")
      .find((line) => line.startsWith("worktree ") && !before.includes(line))
      .slice(9);
    expect(worktree.startsWith(`${await realpath(profile.paths.data)}/opencode/worktree/`)).toBe(
      true,
    );
    expect(await git(worktree, "rev-parse", "HEAD")).toBe(localMain);
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

  it("inherits the latest session's agent, model, and variant after viewing an older session", async () => {
    const opener = page.getByLabel("Create session", { exact: true });
    await opener.click();
    await page.locator('.server-flow-dialog button[type="submit"]').click();
    await page.locator(".transcript-empty-state").waitFor();
    await expect.poll(() => opener.evaluate((node) => node === document.activeElement)).toBe(true);
    await page.getByRole("button", { name: /^Agent:/u }).click();
    await page.getByRole("option", { name: "acceptance-agent", exact: true }).click();
    await page.getByLabel("Agent: acceptance-agent", { exact: true }).waitFor();
    await page.getByRole("button", { name: /^Model:/u }).click();
    await page.getByPlaceholder("Search models").fill("Acceptance Alternate");
    await page
      .locator(".composer-model-option")
      .filter({ hasText: "Acceptance Alternate" })
      .click();
    await page.getByLabel("Model: Acceptance Alternate", { exact: true }).waitFor();
    await page.getByRole("button", { name: /^Variant:/u }).click();
    await page.getByRole("option", { name: "high", exact: true }).click();
    await page.getByLabel("Variant: high", { exact: true }).waitFor();
    await send("E2E_ALTERNATE inherited choices");
    await transcript("Acceptance completed with alternate.");
    await idle();
    await page.locator('.shell-session-main:not([aria-current="page"])').first().click();
    await page.getByLabel("Create session", { exact: true }).click();
    await page.locator('.server-flow-dialog button[type="submit"]').click();
    await page.locator(".transcript-empty-state").waitFor();
    for (const label of [
      "Agent: acceptance-agent",
      "Model: Acceptance Alternate",
      "Variant: high",
    ]) {
      await page.getByLabel(label, { exact: true }).waitFor();
    }
    const latest = (await api.session.list({ order: "desc", limit: 100 })).data
      .filter((session) => !session.parentID)
      .toSorted((left, right) => right.time.created - left.time.created)[0];
    expect(latest).toMatchObject({
      agent: "acceptance-agent",
      model: { providerID: "acceptance", id: "alternate", variant: "high" },
    });
    await page.locator('.shell-session-main:not([aria-current="page"])').first().click();
    await page.getByRole("button", { name: /^Create session$/u }).waitFor();
    await page.locator(".shell-session-main").first().click();
    await page.getByLabel("Variant: high", { exact: true }).waitFor();
    await send("E2E_ALTERNATE copied choices");
    await transcript("Acceptance completed with alternate.");
    await idle();
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
    const attentionRow = page.locator(".shell-session-row").filter({
      has: page.getByRole("button", { name: `${title}, Permission required`, exact: true }),
    });
    await expect.poll(() => attentionRow.locator(".shell-session-attention-dot").count()).toBe(1);
    await expect.poll(() => preexistingCard.textContent()).toContain("acceptance.preexisting");
    await expect.poll(() => preexistingCard.textContent()).toContain("/acceptance/preexisting/one");
    await expect.poll(() => preexistingCard.textContent()).toContain("/acceptance/preexisting/two");
    await expect.poll(() => preexistingCard.textContent()).toContain("call_acceptance");

    await selectSession(navigationTitle);
    expect(await preexistingCard.count()).toBe(0);
    expect(await attentionRow.locator(".shell-session-attention-dot").count()).toBe(1);
    await selectSession(title);
    const allowOnce = preexistingCard.getByRole("button", { name: "Allow once", exact: true });
    await allowOnce.focus();
    await page.keyboard.press("Enter");
    await expectPermissionSettled(permissionSession.id, beforeConnect);
    await expect
      .poll(() =>
        page.getByRole("button", { name: `${title}, Permission required`, exact: true }).count(),
      )
      .toBe(0);
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

  it("keeps background permission dots across locations and answers requests inside sessions", async () => {
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
    const primaryTitle = "Primary pending permission";
    const secondaryTitle = "Secondary pending permission";
    const primarySession = await createPermissionSession(primaryTitle, primaryDirectory);
    const secondarySession = await createPermissionSession(secondaryTitle, secondaryDirectory);
    const savedPattern = "/acceptance/session-permissions/**";
    const primaryAction = "acceptance.session.saved";
    const primaryRequest = await createPermission(primarySession.id, primaryAction, {
      directory: primaryDirectory,
      resources: ["/acceptance/session-permissions/primary"],
      save: [savedPattern],
    });
    const secondaryRequest = await createPermission(
      secondarySession.id,
      "acceptance.session.once",
      {
        directory: secondaryDirectory,
        resources: ["/acceptance/session-permissions/secondary"],
      },
    );
    await changeServer();
    await connect();
    await page.getByRole("button", { name: new RegExp(`^${historicalTitle},`, "u") }).waitFor();
    expect(await page.getByRole("button", { name: /^Permissions,/u }).count()).toBe(0);
    await page
      .getByRole("button", { name: `${primaryTitle}, Permission required`, exact: true })
      .waitFor();
    const secondaryRow = page.getByRole("button", {
      name: `${secondaryTitle}, Permission required`,
      exact: true,
    });
    await secondaryRow.waitFor();
    await secondaryRow.click();
    await permissionCard(secondaryRequest)
      .getByRole("button", { name: "Allow once", exact: true })
      .click();
    await expectPermissionSettled(secondarySession.id, secondaryRequest, secondaryDirectory);
    await page.getByRole("button", { name: `${secondaryTitle}, Idle`, exact: true }).waitFor();
    await page
      .getByRole("button", { name: `${primaryTitle}, Permission required`, exact: true })
      .click();
    await permissionCard(primaryRequest)
      .getByRole("button", { name: "Always allow", exact: true })
      .click();
    await expectPermissionSettled(primarySession.id, primaryRequest, primaryDirectory);
    await page.getByRole("button", { name: `${primaryTitle}, Idle`, exact: true }).waitFor();
    await expect
      .poll(async () =>
        (await api.permission.saved.list({ projectID: primarySession.projectID })).some(
          (rule) => rule.action === primaryAction && rule.resource === savedPattern,
        ),
      )
      .toBe(true);
    // Cold-cache hydration must not reopen the evicted, unavailable historical location.
    expect(
      (await api.debug.location.list()).some(
        (location) => location.directory === historicalDirectory,
      ),
    ).toBe(false);
    expect(errors).toEqual([]);
  });

  it("creates an independent session through the plugin and admits it to the session catalog", async () => {
    const directory = await realpath(project);
    const caller = await api.session.create({
      title: "Session tool caller",
      location: { directory },
      agent: "build",
      model: { providerID: "acceptance", id: "stream", variant: "high" },
    });
    await page.locator(".shell-session-main").filter({ hasText: "Session tool caller" }).click();
    await send("E2E_CREATE_SESSION browser");
    await transcript("Acceptance session created:");
    await idle();
    await expect
      .poll(
        async () =>
          (await api.session.list({ limit: 100 })).data.find(
            (session) => session.title === "Independent acceptance task",
          )?.outcome,
      )
      .toBe("succeeded");
    const created = (await api.session.list({ limit: 100 })).data.find(
      (session) => session.title === "Independent acceptance task",
    );
    expect(created).toBeDefined();
    expect(created.parentID).toBeUndefined();
    expect(created.projectID).toBe(caller.projectID);
    expect(created.location.directory).not.toBe(caller.location.directory);
    expect(created.agent).toBe("build");
    expect(created.model).toEqual(caller.model);
    expect(await git(created.location.directory, "rev-parse", "HEAD")).toBe(
      await git(directory, "rev-parse", "HEAD"),
    );
    expect(await readFile(join(created.location.directory, "working.txt"), "utf8")).toBe(
      "Original working content\n",
    );
    await page
      .locator(".shell-session-main")
      .filter({ hasText: "Independent acceptance task" })
      .click();
    await transcript("Independent acceptance task");
    await transcript("Acceptance completed with stream.");
    expect(await page.locator(".transcript-view").textContent()).not.toContain(
      "E2E_CREATE_SESSION browser",
    );
    expect(errors).toEqual([]);
  });

  it("renders assistant Markdown images that name a file on the connected server", async () => {
    await ensureConnected();
    const directory = await realpath(project);
    // Stored beside Git metadata so the disposable project's change lists are
    // unaffected; the server still resolves it inside the session location.
    const imagePath = join(directory, ".git", "acceptance-capture.png");
    await writeFile(imagePath, acceptancePng);
    const session = await api.session.create({
      title: "Server file image",
      location: { directory },
    });
    await selectSession(session.title);
    await send(`E2E_FILE_IMAGE ${pathToFileURL(imagePath).href}`);
    await idle();

    const image = page.locator(".transcript-assistant-complete img[data-file-src]").last();
    await expect.poll(() => image.getAttribute("alt")).toBe("Tool states");
    await expect.poll(() => image.evaluate((node) => node.src.startsWith("blob:"))).toBe(true);
    await expect.poll(() => image.evaluate((node) => node.naturalWidth)).toBeGreaterThan(0);
    // The sanitized markup never gives the browser a loadable file: source.
    expect(await image.getAttribute("src")).toMatch(/^blob:/u);
    expect(errors).toEqual([]);
  });

  it("remembers the context panel per session across reloads", async () => {
    await ensureConnected();
    const location = { directory: await realpath(project) };
    const previousTitle = await page.locator(".titlebar-session-title").textContent();
    let alpha;
    let beta;
    try {
      alpha = await api.session.create({ title: "Panel memory alpha", location });
      beta = await api.session.create({ title: "Panel memory beta", location });
      await selectSession(alpha.title);
      // First visit: the context panel starts closed.
      await page.getByLabel("Show context", { exact: true }).waitFor();
      await page.getByLabel("Show context", { exact: true }).click();
      await page.getByLabel("Hide context panel").waitFor();

      await selectSession(beta.title);
      await page.getByLabel("Show context", { exact: true }).waitFor();

      await selectSession(alpha.title);
      await page.getByLabel("Hide context panel").waitFor();

      // The per-session layout survives a reload and reconnect.
      await page.reload();
      await page.getByRole("heading", { name: "Connect to OpenCode" }).waitFor();
      await connect();
      await selectSession(alpha.title);
      await page.getByLabel("Hide context panel").waitFor();
      await selectSession(beta.title);
      await page.getByLabel("Show context", { exact: true }).waitFor();
    } finally {
      if (alpha) await api.session.remove({ sessionID: alpha.id });
      if (beta) await api.session.remove({ sessionID: beta.id });
      if (previousTitle) await selectSession(previousTitle);
    }
  });

  it("keeps per-session panel layouts isolated between browser tabs", async () => {
    await ensureConnected();
    const location = { directory: await realpath(project) };
    const previousTitle = await page.locator(".titlebar-session-title").textContent();
    let alpha;
    let beta;
    let second;
    try {
      alpha = await api.session.create({ title: "Tab isolation alpha", location });
      beta = await api.session.create({ title: "Tab isolation beta", location });

      // Both tabs load before any panel write. Isolation is proven by the
      // event-free unit test; this scenario covers the integrated behavior.
      second = await context.newPage();
      await second.goto(uiUrl);
      await connect(second);
      await selectSession(beta.title, second);
      await second.getByLabel("Show context", { exact: true }).click();
      await second.getByLabel("Hide context panel").waitFor();

      await selectSession(alpha.title);
      await page.getByLabel("Show context", { exact: true }).click();
      await page.getByLabel("Hide context panel").waitFor();

      // The first tab sees the other tab's change without reloading.
      await selectSession(beta.title);
      await expect.poll(() => page.getByLabel("Hide context panel").count()).toBe(1);
      await selectSession(alpha.title);
      await page.getByLabel("Hide context panel").waitFor();

      // A reload keeps both sessions' layouts: the first tab's write of alpha
      // did not erase the second tab's write of beta.
      await page.reload();
      await page.getByRole("heading", { name: "Connect to OpenCode" }).waitFor();
      await connect();
      await selectSession(alpha.title);
      await page.getByLabel("Hide context panel").waitFor();
      await selectSession(beta.title);
      await page.getByLabel("Hide context panel").waitFor();
    } finally {
      await second?.close();
      if (alpha) await api.session.remove({ sessionID: alpha.id });
      if (beta) await api.session.remove({ sessionID: beta.id });
      if (previousTitle) await selectSession(previousTitle);
    }
  });

  it("adds a previously unseen server directory as a selectable project", async () => {
    const addedDirectory = await realpath(addedProject);
    const existing = await api.project.list();
    expect(existing.some((candidate) => candidate.canonical === addedDirectory)).toBe(false);

    await ensureConnected();
    const selectedRow = page.locator('.shell-session-main[aria-current="page"]');
    const previousTitle =
      (await selectedRow.count()) === 1
        ? await selectedRow.locator(".shell-session-title").textContent()
        : undefined;
    let created;
    try {
      await page.getByRole("button", { name: "Create session", exact: true }).click();
      await page.getByRole("button", { name: "Add project", exact: true }).click();
      const directory = page.locator(".server-directory-browser-path");
      await expect.poll(() => directory.textContent()).toBe(await realpath(project));
      await page.getByLabel("Go to parent directory").click();
      await expect.poll(() => directory.textContent()).toBe(dirname(await realpath(project)));
      await page
        .getByRole("button", { name: "Browse directory added-project/", exact: true })
        .click();
      await expect.poll(() => directory.textContent()).toBe(addedDirectory);
      await page.locator('.server-flow-dialog button[type="submit"]').click();

      // The refreshed server-backed list must publish the resolved project, not
      // fall back to the picker's empty selection.
      const projectPicker = page.locator(".new-session-project-trigger");
      await expect
        .poll(() => projectPicker.getAttribute("aria-label"))
        .toBe("Project: added-project");
      await expect.poll(() => projectPicker.textContent()).toContain(addedDirectory);

      await page.locator('.server-flow-dialog button[type="submit"]').click();
      await page.getByLabel("Prompt", { exact: true }).waitFor();
      const added = await api.project.current({ location: { directory: addedDirectory } });
      await expect
        .poll(async () =>
          (await api.session.list({ limit: 100, directory: addedDirectory })).data.some(
            (session) =>
              session.projectID === added.id && session.location.directory === addedDirectory,
          ),
        )
        .toBe(true);
      created = (await api.session.list({ limit: 100, directory: addedDirectory })).data.find(
        (session) => session.projectID === added.id,
      );
    } finally {
      if (created) {
        await api.session.remove({ sessionID: created.id });
        if (previousTitle) await selectSession(previousTitle);
      }
    }
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
