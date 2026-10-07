import { browserAnnotationMetadata } from "../../src/renderer/opencode/browser-annotation-metadata.ts";
import { createProfile } from "./profile.mjs";
import { OpenCode } from "@opencode/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";
import { build, preview } from "vite-plus";
import { chromium } from "playwright";
import { access, mkdir, readFile, realpath, rename, rm, unlink, writeFile } from "node:fs/promises";
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
const modelRoute = (url) => url.pathname === "/api/model";
const modelDefaultRoute = (url) => url.pathname === "/api/model/default";
const agentRoute = (url) => url.pathname === "/api/agent";
const failCatalog = (route) =>
  route.fulfill({ status: 503, json: { message: "Catalog unavailable" } });
const failFont = (route) => route.fulfill({ status: 503, body: "Temporary font failure" });

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
  await git(project, "add", "-f", "opencode.json");
  await git(project, "commit", "-m", "Track branch configuration fixture");
  await git(project, "checkout", "-b", "config-hidden-build");
  await writeFile(
    join(project, "opencode.json"),
    JSON.stringify({
      ...JSON.parse(acceptanceConfig),
      agents: { ...JSON.parse(acceptanceConfig).agents, build: { hidden: true } },
    }),
  );
  await git(project, "add", "opencode.json");
  await git(project, "commit", "-m", "Hide build on alternate branch");
  await git(project, "checkout", "acceptance");
  for (const directory of ["agent", "agents", "mode", "modes"]) {
    await git(project, "checkout", "-b", "markdown-hidden-build-" + directory);
    const source = join(project, ".opencode", directory);
    await mkdir(source, { recursive: true });
    await writeFile(
      join(source, "build.md"),
      "---\nhidden: true\nmode: primary\n---\nHidden branch agent.\n",
    );
    await git(project, "add", "-f", ".opencode");
    await git(project, "commit", "-m", "Hide build through " + directory + " Markdown");
    await git(project, "checkout", "acceptance");
  }
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
  // Cold production and pinned-server builds share the machine with other test projects.
}, 180_000);

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

  it("opens session drafts from both empty states and browses a hidden sidebar", async () => {
    const empty = page.getByRole("region", { name: "Session", exact: true });
    await empty.getByRole("heading", { name: "No session selected" }).waitFor();
    const sidebar = page.getByRole("complementary", { name: "Sessions", exact: true });
    await sidebar.getByText("No sessions yet.", { exact: true }).waitFor();
    expect((await api.session.list({ limit: 100 })).data).toHaveLength(0);
    await page.getByRole("button", { name: "Hide sessions", exact: true }).click();
    await empty.getByRole("button", { name: "Browse sessions" }).click();
    await sidebar.getByRole("button", { name: "New session", exact: true }).waitFor();
    await empty.getByRole("button", { name: "New session", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("region", { name: "New session", exact: true }).waitFor();
    await page.reload();
    await connect();
    await empty.getByRole("heading", { name: "No session selected" }).waitFor();
    await page.setViewportSize({ width: 430, height: 760 });
    await empty.getByRole("button", { name: "Browse sessions" }).click();
    await sidebar.getByRole("button", { name: "New session", exact: true }).click();
    await page.getByRole("region", { name: "New session", exact: true }).waitFor();
    expect((await api.session.list({ limit: 100 })).data).toHaveLength(0);
    await page.setViewportSize({ width: 1280, height: 860 });
  });

  it("uses the centered composer, directory dialog and independent persistent drafts", async () => {
    const opener = page.getByRole("button", { name: "Create session", exact: true });
    await opener.click();
    await page.getByRole("region", { name: "New session", exact: true }).waitFor();
    expect(await page.getByLabel("Close new session dialog").count()).toBe(0);
    const projectPicker = page.getByRole("button", { name: /^Project:/u });
    await projectPicker.click();
    await page.getByRole("button", { name: "Add project…", exact: true }).click();
    const directory = page.locator(".server-directory-browser-path");
    await expect.poll(() => directory.textContent()).toBe(await realpath(project));
    const failedTarget = join(await realpath(project), "folder-00");
    const listingRoute = /\/api\/fs\/list(?:\?|$)/u;
    const failedListings = [];
    await page.route(listingRoute, async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("path") !== failedTarget) return route.continue();
      failedListings.push({
        directory: url.searchParams.get("location[directory]"),
        workspace: url.searchParams.get("location[workspace]"),
      });
      return route.abort("failed");
    });
    try {
      await page.getByRole("button", { name: "Browse directory folder-00/", exact: true }).click();
      await page.getByText("Not listed", { exact: true }).waitFor();
      expect(await directory.textContent()).toBe(failedTarget);
      expect(await page.getByRole("alert").textContent()).toContain(
        `Could not list ${failedTarget}.`,
      );
      expect(
        await page.getByRole("button", { name: "Add project", exact: true }).isDisabled(),
      ).toBe(true);
      const retry = page.getByRole("button", { name: "Retry", exact: true });
      await expect.poll(() => retry.evaluate((node) => node === document.activeElement)).toBe(true);
      await page.keyboard.press("Enter");
      await expect.poll(() => failedListings.length).toBe(2);
      await page.getByText("Not listed", { exact: true }).waitFor();
      expect(failedListings[0].directory).toBe(await realpath(project));
      expect(failedListings[1]).toEqual(failedListings[0]);
      const restored = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/fs/list" &&
          new URL(response.url()).searchParams.get("path") !== failedTarget &&
          response.request().method() === "GET",
      );
      await page
        .getByRole("button", { name: "Back to previous successfully listed directory" })
        .click();
      const restoredResponse = await restored;
      expect(restoredResponse.ok()).toBe(true);
      const restoredUrl = new URL(restoredResponse.url());
      expect({
        directory: restoredUrl.searchParams.get("location[directory]"),
        workspace: restoredUrl.searchParams.get("location[workspace]"),
      }).toEqual(failedListings[0]);
      await page
        .getByRole("button", { name: "Browse directory folder-00/", exact: true })
        .waitFor();
      expect(await directory.textContent()).toBe(await realpath(project));
      expect(await page.getByRole("alert").count()).toBe(0);
      expect(await page.getByRole("button", { name: "Add project", exact: true }).isEnabled()).toBe(
        true,
      );
    } finally {
      await page.unroute(listingRoute);
    }
    await page.getByRole("button", { name: "Browse directory folder-00/", exact: true }).click();
    await page.getByText("No child directories.", { exact: true }).waitFor();
    await page.getByLabel("Go to parent directory").click();
    await expect.poll(() => directory.textContent()).toBe(await realpath(project));
    await page.getByRole("button", { name: "Browse directory folder-00/", exact: true }).waitFor();
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
      .poll(() => projectPicker.evaluate((node) => node === document.activeElement))
      .toBe(true);
    await page.setViewportSize({ width: 1280, height: 860 });
    const prompt = page.getByLabel("Prompt", { exact: true });
    await prompt.fill("hello,");
    await prompt.press("End");
    await prompt.pressSequentially(" ");
    await expect
      .poll(() => page.locator(".session-drafts .shell-session-title").allTextContents())
      .toContain("hello,");
    expect(await prompt.textContent()).toBe("hello, ");
    await prompt.fill("Persistent first draft");
    await prompt.press("End");
    await prompt.pressSequentially(" /rev");
    await page.getByRole("button", { name: /\/review Acceptance review/ }).waitFor();
    await prompt.press("Enter");
    const firstText = await prompt.textContent();
    await prompt.evaluate((input) => {
      const clipboardData = new DataTransfer();
      clipboardData.items.add(
        new File(["Durable document contents"], "durable.txt", { type: "text/plain" }),
      );
      input.dispatchEvent(
        new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }),
      );
    });
    await page.getByRole("button", { name: "Remove durable.txt", exact: true }).waitFor();
    await page
      .locator(".session-drafts .shell-session-title")
      .filter({ hasText: "Persistent first draft" })
      .waitFor();
    await opener.click();
    await expect.poll(() => page.getByLabel("Prompt", { exact: true }).textContent()).toBe("");
    await page.getByLabel("Prompt", { exact: true }).fill("Persistent second draft");
    await page
      .locator(".session-drafts .shell-session-title")
      .filter({ hasText: "Persistent first draft" })
      .click();
    await expect
      .poll(() => page.getByLabel("Prompt", { exact: true }).textContent())
      .toBe(firstText);
    await expect
      .poll(() => page.getByRole("button", { name: "Send", exact: true }).isEnabled())
      .toBe(true);
    await page.reload();
    await connect();
    await page
      .locator(".session-drafts .shell-session-title")
      .filter({ hasText: "Persistent first draft" })
      .click();
    await expect
      .poll(() => page.getByLabel("Prompt", { exact: true }).textContent())
      .toBe(firstText);
    await page.getByRole("button", { name: "Remove review skill" }).waitFor();
    await page.getByRole("button", { name: "Remove durable.txt", exact: true }).waitFor();
    // Read durable bytes through the native database after the UI reload.
    expect(
      await page.evaluate(async () => {
        const database = await new Promise((resolve, reject) => {
          const request = indexedDB.open("ocui");
          request.addEventListener("success", () => resolve(request.result));
          request.addEventListener("error", () => reject(request.error));
        });
        const rows = await new Promise((resolve, reject) => {
          const request = database.transaction("attachments").objectStore("attachments").getAll();
          request.addEventListener("success", () => resolve(request.result));
          request.addEventListener("error", () => reject(request.error));
        });
        database.close();
        return rows.find((row) => row.name === "durable.txt").blob.text();
      }),
    ).toBe("Durable document contents");
    const secondWindow = await context.newPage();
    await secondWindow.goto(uiUrl);
    await connect(secondWindow);
    await secondWindow
      .locator(".session-drafts .shell-session-title")
      .filter({ hasText: "Persistent first draft" })
      .click();
    await secondWindow.getByRole("button", { name: "Remove durable.txt", exact: true }).waitFor();
    await prompt.fill("Persistent first draft edited elsewhere");
    await expect
      .poll(() => secondWindow.getByLabel("Prompt", { exact: true }).textContent())
      .toBe("Persistent first draft edited elsewhere");
    await secondWindow.close();
    expect(await page.locator(".session-drafts .shell-session-main").count()).toBe(2);
    await page.getByLabel("Filter sessions", { exact: true }).fill("second draft");
    expect(await page.locator(".session-drafts .shell-session-main").count()).toBe(1);
    await page.getByLabel("Filter sessions", { exact: true }).fill("");
    await page.screenshot({ path: join(artifacts, "browser-new-session-drafts.png") });
    for (const title of ["Persistent first draft", "Persistent second draft"]) {
      const row = page.locator(".session-drafts .shell-session-row").filter({ hasText: title });
      await row.hover();
      await row.getByRole("button", { name: /^Delete draft:/u }).click();
      await row.waitFor({ state: "hidden" });
    }
    // Seed named conversations for the independent transcript scenarios below.
    await api.session.create({ title: "Browser fixture one" });
    await api.session.create({ title: "Browser fixture two" });
    await selectSession("Browser fixture one");
    await page.getByLabel("Prompt", { exact: true }).fill("Independent draft");
    expect(await page.evaluate(() => document.documentElement.dataset.host)).toBe("browser");
  });

  it("recovers the session model catalog without losing the draft", async () => {
    // Controlled catalog responses exercise rare failure/empty states; recovery
    // returns to the authenticated pinned server's real catalog.
    let catalogState = "failed";
    const routeCatalog = async (route) => {
      if (catalogState === "failed") {
        await route.fulfill({ status: 503, json: { message: "Catalog unavailable" } });
        return;
      }
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...(await response.json()), data: [] } });
    };
    await page.route(modelRoute, routeCatalog);
    try {
      await page.reload();
      await connect();
      await selectSession("Browser fixture two");
      await page.getByRole("button", { name: "Retry models" }).waitFor();
      await page.getByLabel("Prompt", { exact: true }).fill("Catalog recovery draft");
      expect(await page.getByText("No models", { exact: true }).count()).toBe(0);
      catalogState = "empty";
      await page.getByRole("button", { name: "Retry models" }).click();
      await page.getByRole("status").filter({ hasText: "No enabled models" }).waitFor();
      await page.unroute(modelRoute, routeCatalog);
      await page.getByRole("button", { name: "Refresh models" }).click();
      await page.getByRole("button", { name: /^Model: Acceptance/u }).waitFor();
      expect(await page.getByLabel("Prompt", { exact: true }).textContent()).toBe(
        "Catalog recovery draft",
      );
      await selectSession("Browser fixture one");
      await page.getByLabel("Prompt", { exact: true }).fill("Independent draft");
    } finally {
      await page.unroute(modelRoute, routeCatalog);
    }
  });

  it("retries session agents and shared draft choices while retaining selections and text", async () => {
    const directory = await realpath(secondaryProject);
    const source = await api.session.create({
      title: "Catalog recovery source",
      agent: "acceptance-agent",
      model: { providerID: "acceptance", id: "alternate", variant: "high" },
      location: { directory },
    });
    await page.route(agentRoute, failCatalog);
    try {
      await selectSession("Catalog recovery source");
      await page.getByRole("button", { name: "Retry agents" }).waitFor();
      const prompt = page.getByLabel("Prompt", { exact: true });
      await prompt.fill("Retained session draft");
      await page.unroute(agentRoute, failCatalog);
      await page.getByRole("button", { name: "Retry agents" }).click();
      await page.getByLabel("Agent: acceptance-agent", { exact: true }).waitFor();
      expect(await prompt.textContent()).toBe("Retained session draft");
      expect((await api.session.get({ sessionID: source.id })).agent).toBe("acceptance-agent");
      await page.route(modelDefaultRoute, failCatalog);
      await page.getByLabel("Create session", { exact: true }).click();
      await page.getByRole("button", { name: "Retry models" }).waitFor();
      await prompt.fill("Retained new-session draft");
      await page.unroute(modelDefaultRoute, failCatalog);
      // Draft model/agent choices share one existing catalog owner: either
      // recovery action reloads that location's choices without editing them.
      await page.getByRole("button", { name: "Retry agents" }).click();
      for (const label of [
        "Agent: acceptance-agent",
        "Model: Acceptance Alternate",
        "Variant: high",
      ])
        await page.getByLabel(label, { exact: true }).waitFor();
      expect(await prompt.textContent()).toBe("Retained new-session draft");
      const draft = page
        .locator(".session-drafts .shell-session-row")
        .filter({ hasText: "Retained new-session draft" });
      await draft.hover();
      await draft.getByRole("button", { name: "Delete draft: Retained new-session draft" }).click();
      await selectSession("Catalog recovery source");
      expect(await prompt.textContent()).toBe("Retained session draft");
      await selectSession("Browser fixture one");
    } finally {
      await page.unroute(agentRoute, failCatalog);
      await page.unroute(modelDefaultRoute, failCatalog);
      await api.session.remove({ sessionID: source.id });
    }
  });

  it("switches palettes without replacing the workspace and restores the choice after reload", async () => {
    const expectNeutralComposerFocus = async (color) => {
      await page.getByLabel("Prompt", { exact: true }).click();
      await expect
        .poll(() =>
          page.getByRole("form", { name: "Message composer" }).evaluate((node) => {
            const style = getComputedStyle(node);
            return [
              style.outlineColor,
              style.outlineStyle,
              style.outlineWidth,
              style.outlineOffset,
            ];
          }),
        )
        .toEqual([color, "solid", "1px", "0px"]);
    };
    await expectNeutralComposerFocus("rgb(119, 119, 117)");
    const prompt = await page.getByLabel("Prompt", { exact: true }).elementHandle();
    await page.getByRole("button", { name: "Switch to dark theme" }).click();
    await expect.poll(() => page.locator("html").getAttribute("data-color-scheme")).toBe("dark");
    expect(
      await page.locator("html").evaluate((node) => getComputedStyle(node).backgroundColor),
    ).toBe("rgb(16, 15, 15)");
    expect(await prompt.evaluate((node) => node.isConnected)).toBe(true);
    expect(await page.getByLabel("Prompt", { exact: true }).textContent()).toBe(
      "Independent draft",
    );
    await expectNeutralComposerFocus("rgb(135, 133, 128)");
    const second = await context.newPage();
    try {
      await second.goto(uiUrl);
      await second.getByRole("button", { name: "Switch to light theme" }).waitFor();
      await second.reload();
      await second.getByRole("button", { name: "Switch to light theme" }).click();
      await second.reload();
      await second.getByRole("button", { name: "Switch to dark theme" }).waitFor();
      expect(await second.locator("html").getAttribute("data-color-scheme")).toBe("light");
      expect(
        await second.locator("html").evaluate((node) => getComputedStyle(node).backgroundColor),
      ).toBe("rgb(255, 254, 253)");
    } finally {
      await second.close();
    }
    const toggle = page.getByRole("button", { name: "Switch to light theme" });
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => page.locator("html").getAttribute("data-color-scheme")).toBe("light");
    expect(await prompt.evaluate((node) => node.isConnected)).toBe(true);
    await expectNeutralComposerFocus("rgb(119, 119, 117)");
  });

  it("streams prompts, resolves questions, stops real provider work, and reconnects after transport loss", async () => {
    await send("E2E_STREAM browser");
    await transcript("Acceptance first streamed fragment.");
    await page.getByRole("button", { name: "Stop", exact: true }).waitFor();
    await transcript("Acceptance completed with stream.");
    await idle();
    await send("E2E_QUESTION browser");
    await page.locator(".question-form").waitFor();
    const questionActivity = page.locator(".transcript-activity-trigger").last();
    await expect.poll(() => questionActivity.locator(".transcript-activity-pulse").count()).toBe(1);
    expect(await questionActivity.textContent()).toBe("Running");
    await expect
      .poll(() => page.locator('.shell-session-row.selected [data-status="question"]').count())
      .toBe(1);
    await page.locator(".question-form label").filter({ hasText: "Alpha" }).click();
    await selectSession("Browser fixture two");
    await page.locator(".question-form").waitFor({ state: "hidden" });
    await selectSession("Browser fixture one");
    await expect
      .poll(() => page.locator('.question-form input[value="option:0"]').isChecked())
      .toBe(true);
    await page.route(
      "**/api/session/*/form/*/reply",
      (route) => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
      { times: 1 },
    );
    await page.locator('.question-form button[type="submit"]').click();
    await page.getByRole("alert").filter({ hasText: "The form could not be submitted" }).waitFor();
    await selectSession("Browser fixture two");
    await selectSession("Browser fixture one");
    await expect
      .poll(() => page.locator('.question-form input[value="option:0"]').isChecked())
      .toBe(true);
    await page.locator('.question-form button[type="submit"]').click();
    await transcript("Acceptance question resolved:");
    await expect.poll(() => questionActivity.locator(".transcript-activity-pulse").count()).toBe(0);
    await expect
      .poll(() => page.locator(".shell-session-row.selected .shell-session-attention-dot").count())
      .toBe(0);
    await idle();
    await page.locator('.transcript-activity-trigger[aria-expanded="false"]').last().click();
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
    const failedActivity = page.locator(".transcript-activity-trigger").last();
    await expect.poll(() => failedActivity.getAttribute("aria-expanded")).toBe("false");
    await failedActivity.click();
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
      // The queue chord follows the renderer's platform marker: Cmd on macOS,
      // Ctrl elsewhere.
      await prompt.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
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
    await page
      .locator(".transcript-user-message .attachment-pill-annotations .attachment-pill-trigger")
      .click();
    await expect
      .poll(() => page.locator(".transcript-annotation-content").textContent())
      .toContain(annotation);
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
    await page
      .locator(".transcript-user-message .attachment-pill-annotations .attachment-pill-trigger")
      .waitFor();
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
    await page
      .locator(".transcript-user-message .attachment-pill-review .attachment-pill-trigger")
      .click();
    await expect
      .poll(() => page.locator(".attachment-detail-popover").textContent())
      .toContain(review);
    const requests = (await (await fetch(`${provider.url}/_state`)).json()).requests;
    expect(requests.some((request) => request.prompt.includes(annotation))).toBe(true);
    expect(
      requests.some(
        (request) => request.prompt.includes(review) && request.prompt.includes("working.txt"),
      ),
    ).toBe(true);
    const deletedReview = "Delete this unsent review comment.";
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
    await editor.fill(deletedReview);
    await page.keyboard.press("Escape");
    await expect
      .poll(() =>
        page
          .getByRole("form", { name: "Message composer" })
          .locator(".attachment-pill-review .attachment-pill-trigger")
          .textContent(),
      )
      .toContain("Review · 1");
    await page.getByRole("button", { name: "Delete review comment" }).click();
    await page.locator(".diff-review-annotation").waitFor({ state: "hidden" });
    expect(
      await page
        .getByRole("form", { name: "Message composer" })
        .locator(".attachment-pill-review")
        .count(),
    ).toBe(0);
    expect(await page.getByRole("dialog").count()).toBe(0);
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
    // The trailing space is written as a character reference so the draft
    // still holds it when parsed again.
    expect(message.text).toBe("Use review and testing&#x20;");
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

  // Clipboard acceptance: these tests synthesize ClipboardEvent payloads inside
  // the renderer. They prove the application's routing, admission, and byte
  // delivery; they do not prove integration with the native macOS/Chromium
  // clipboard, which packaged acceptance covers.
  it("reloads structured browser annotations from the server as read-only pills", async () => {
    await ensureConnected();
    const session = await api.session.create({
      title: "Saved browser annotations",
      location: { directory: await realpath(project) },
    });
    const text = "E2E_STREAM saved browser metadata\n\nCaptured browser context";
    const metadata = browserAnnotationMetadata("E2E_STREAM saved browser metadata", [
      {
        number: 1,
        mode: "element",
        body: "Give the heading more room",
        url: "https://example.com",
        title: "Example",
        capturedAt: "2026-09-29T10:00:00Z",
        fileIndex: 0,
        selection: {
          frameUrl: "https://example.com",
          selector: "h1",
          tag: "h1",
          text: "Heading",
          role: "heading",
          label: "Heading",
          topFrame: true,
          bounds: { x: 0, y: 0, width: 100, height: 30 },
        },
      },
    ]);
    const screenshot = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 8;
      canvas.height = 8;
      canvas.getContext("2d").fillRect(0, 0, 8, 8);
      return canvas.toDataURL("image/png");
    });
    // Native capture is covered by its controller tests; this checks the real server's stored representation.
    await api.session.prompt({
      sessionID: session.id,
      text,
      metadata,
      files: [{ uri: screenshot, name: "capture.png" }],
    });
    await selectSession(session.title);
    await page.getByRole("button", { name: "Browser · 1", exact: true }).waitFor();
    await idle();
    await page.reload();
    await ensureConnected();
    await selectSession(session.title);
    const pill = page.getByRole("button", { name: "Browser · 1", exact: true });
    await pill.click();
    await page.getByText("1. Give the heading more room", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Enlarge Browser annotation 1" }).click();
    await page.getByRole("dialog", { name: "Preview of Browser annotation 1" }).waitFor();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    expect(await page.locator(".transcript-user-bubble").textContent()).not.toContain(
      "Captured browser context",
    );
    const messages = await api.message.list({ sessionID: session.id });
    expect(messages.data.find((item) => item.type === "user").metadata).toEqual(metadata);
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
    expect(
      await page.getByRole("button", { name: "Remove screenshot.png", exact: true }).count(),
    ).toBe(0);
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

  it("attaches oversized pasted text and sends its bytes", async () => {
    await ensureConnected();
    const location = { directory: await realpath(project) };
    const session = await api.session.create({ title: "Pasted text attachments", location });
    await selectSession(session.title);
    const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });

    const text = `BEGIN-ACCEPTANCE\n${"The composer keeps module contracts explicit.\n".repeat(400)}END-ACCEPTANCE`;
    expect(text.length).toBeGreaterThan(16_384);
    await prompt.evaluate((input, payload) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", payload);
      input.dispatchEvent(
        new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }),
      );
    }, text);

    // The paste became an attachment: a chip appears and the draft stays empty.
    await page.getByRole("button", { name: "Remove pasted-text.txt", exact: true }).waitFor();
    expect(await prompt.textContent()).toBe("");

    const admitted = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/session/${session.id}/prompt`) &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const response = await admitted;
    expect(response.ok(), await response.text()).toBe(true);
    await idle();
    const messages = await api.message.list({ sessionID: session.id });
    const message = messages.data.find((item) => item.type === "user");
    expect(message.files.map((file) => ({ name: file.name, mime: file.mime }))).toEqual([
      { name: "pasted-text.txt", mime: "text/plain" },
    ]);
    expect(Buffer.from(message.files[0].data, "base64").toString()).toBe(text);
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

  it("inherits the newest conversation's choices into a draft without mutating that conversation", async () => {
    const created = await api.session.create({
      title: "Draft selection source",
      agent: "acceptance-agent",
      model: { providerID: "acceptance", id: "alternate", variant: "high" },
    });
    await selectSession("Browser fixture one");
    await page.getByLabel("Create session", { exact: true }).click();
    for (const label of ["Agent: acceptance-agent", "Model: Acceptance Alternate", "Variant: high"])
      await page.getByLabel(label, { exact: true }).waitFor();
    await page.getByLabel("Prompt", { exact: true }).fill("Inherited draft choices");
    await expect
      .poll(() => page.getByRole("button", { name: "Send", exact: true }).isEnabled())
      .toBe(true);
    await page.getByRole("button", { name: /^Model:/u }).click();
    await page.getByPlaceholder("Search models").fill("Acceptance Stream");
    await page.locator(".composer-model-option").filter({ hasText: "Acceptance Stream" }).click();
    expect((await api.session.get({ sessionID: created.id })).model).toMatchObject({
      providerID: "acceptance",
      id: "alternate",
      variant: "high",
    });
    const row = page
      .locator(".session-drafts .shell-session-row")
      .filter({ hasText: "Inherited draft choices" });
    await row.hover();
    await row.getByRole("button", { name: "Delete draft: Inherited draft choices" }).click();
    await selectSession("Draft selection source");
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

  it("bubbles a running subagent's permission request into the selected parent", async () => {
    await ensureConnected();
    const title = "Subagent bubble acceptance";
    const directory = await realpath(project);
    const parent = await api.session.create(
      {
        title,
        agent: "build",
        model: { providerID: "acceptance", id: "stream" },
        location: { directory },
      },
      locationRequestOptions(directory),
    );
    await selectSession(title);
    await send("E2E_SUBAGENT_BUBBLE browser");

    await expect
      .poll(async () =>
        (await api.session.list({ limit: 100 })).data.some(
          (session) => session.parentID === parent.id && session.title === "Bubble probe",
        ),
      )
      .toBe(true);
    const child = (await api.session.list({ limit: 100 })).data.find(
      (session) => session.parentID === parent.id,
    );
    expect(child).toBeTruthy();

    const group = page.locator(`[data-subagent-session-id="${child.id}"]`);
    await group.getByRole("heading", { name: "Subagent: Bubble probe", exact: true }).waitFor();
    const card = group.locator("[data-permission-request-id]");
    await card.waitFor();
    await expect.poll(() => card.textContent()).toContain("external_directory");
    await expect.poll(() => card.textContent()).toContain("/acceptance-external/*");
    await page
      .getByRole("button", { name: `${title}, Subagent permission required`, exact: true })
      .waitFor();

    const navigationTitle = "Bubble navigation target";
    await createPermissionSession(navigationTitle);
    await selectSession(navigationTitle);
    expect(await card.count()).toBe(0);
    await selectSession(title);
    await card.waitFor();

    await card.getByRole("button", { name: "Allow once", exact: true }).click();
    await expect.poll(() => card.count()).toBe(0);
    await transcript("Acceptance bubbling verified:");
    await idle();
    await expect
      .poll(
        async () =>
          (await api.session.list({ limit: 100 })).data.find((session) => session.id === child.id)
            ?.outcome,
      )
      .toBe("succeeded");
    await page.getByRole("button", { name: `${title}, Idle`, exact: true }).waitFor();
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

  it("highlights streamed code and restores highlighting after session navigation", async () => {
    await ensureConnected();
    const location = { directory: await realpath(project) };
    const session = await api.session.create({ title: "Highlighted snippets", location });
    await selectSession(session.title);
    await send("E2E_SYNTAX");
    await idle();
    const code = page.locator(".transcript-markdown pre code").last();
    await expect.poll(() => code.locator("span[style]").count()).toBeGreaterThan(1);
    expect(await code.textContent()).toBe("const answer = 42;\n\nconsole.log(answer);\n");
    const other = await api.session.create({ title: "Away from snippets", location });
    await selectSession(other.title);
    await selectSession(session.title);
    await expect.poll(() => code.locator("span[style]").count()).toBeGreaterThan(1);
    expect(await code.textContent()).toBe("const answer = 42;\n\nconsole.log(answer);\n");
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

  it("adds a previously unseen server directory to the draft without creating a session", async () => {
    const addedDirectory = await realpath(addedProject);
    expect(
      (await api.project.list()).some((candidate) => candidate.canonical === addedDirectory),
    ).toBe(false);
    await ensureConnected();
    const existing = await api.project.list();
    await page.getByRole("button", { name: "Create session", exact: true }).click();
    const picker = page.getByRole("button", { name: /^Project:/u });
    await picker.click();
    await page.getByRole("button", { name: "Add project…", exact: true }).click();
    const directory = page.locator(".server-directory-browser-path");
    await expect.poll(() => directory.textContent()).toBe(await realpath(project));
    await page.getByLabel("Go to parent directory").click();
    await expect.poll(() => directory.textContent()).toBe(dirname(await realpath(project)));
    await page
      .getByRole("button", { name: "Browse directory acceptance-project/", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Browse directory added-project/", exact: true })
      .click();
    await expect.poll(() => directory.textContent()).toBe(addedDirectory);
    expect((await api.project.list()).map((candidate) => candidate.id).toSorted()).toEqual(
      existing.map((candidate) => candidate.id).toSorted(),
    );
    await page.locator('.server-flow-dialog button[type="submit"]').click();
    await expect.poll(() => picker.getAttribute("aria-label")).toBe("Project: added-project");
    await picker.click();
    await page.getByText(addedDirectory, { exact: true }).waitFor();
    await page.keyboard.press("Escape");
    const added = await api.project.current({ location: { directory: addedDirectory } });
    expect(
      (await api.session.list({ limit: 100, directory: addedDirectory })).data.some(
        (session) => session.projectID === added.id,
      ),
    ).toBe(false);
    await selectSession("Permission acceptance");
  });

  it("explains an unavailable saved project and preserves the prompt when choosing another", async () => {
    const canonical = await realpath(addedProject);
    const moved = addedProject + "-unavailable";
    try {
      await page.getByRole("button", { name: "Create session", exact: true }).click();
      await page.getByRole("button", { name: /^Project:/u }).click();
      await page.locator(".selection-option-detail").filter({ hasText: canonical }).click();
      await page.getByLabel(/^Model:/u).waitFor();
      await page.getByLabel("Prompt", { exact: true }).fill("Preserve missing-project draft");
      await selectSession("Permission acceptance");
      await rename(addedProject, moved);
      await page
        .locator(".session-drafts .shell-session-title")
        .filter({ hasText: "Preserve missing-project draft" })
        .click();
      await page
        .getByText(
          `The project directory could not be opened: ${canonical}. Choose another project or retry.`,
          { exact: true },
        )
        .waitFor();
      expect(await page.getByRole("button", { name: "Send", exact: true }).isDisabled()).toBe(true);
      await page.getByRole("button", { name: /^Project:/u }).click();
      await page
        .locator(".selection-option-detail")
        .filter({ hasText: await realpath(project) })
        .click();
      await page.getByLabel(/^Model:/u).waitFor();
      expect(await page.getByLabel("Prompt", { exact: true }).innerText()).toBe(
        "Preserve missing-project draft",
      );
      expect(await page.getByText(/The project directory could not be opened:/u).count()).toBe(0);
      await selectSession("Permission acceptance");
    } finally {
      await rename(moved, addedProject);
    }
  });

  it("submits new drafts through local branch creation and detached worktree preparation", async () => {
    const canonical = await realpath(project);
    const previousBranch = await git(project, "branch", "--show-current");
    const start = async (mode, branch) => {
      await page.getByRole("button", { name: "Create session", exact: true }).click();
      await page.getByRole("button", { name: /^Project:/u }).click();
      await page.locator(".selection-option-detail").filter({ hasText: canonical }).click();
      await page.getByRole("button", { name: /^Location:/u }).click();
      await page
        .locator(".selection-option > span:first-child")
        .getByText(mode === "local" ? "Local" : "New worktree", { exact: true })
        .click();
      await page.getByRole("button", { name: /^Branch:/u }).click();
      if (branch === "new-session-local") {
        await page.getByRole("button", { name: "Create new branch…", exact: true }).click();
        await page.getByLabel("New branch name", { exact: true }).fill(branch);
      } else {
        await page
          .locator(".selection-option > span:first-child")
          .getByText(branch, { exact: true })
          .click();
      }
      await page.getByLabel(/^Model:/u).click();
      await page.getByPlaceholder("Search models").fill("Acceptance Stream");
      await page.locator(".composer-model-option").filter({ hasText: "Acceptance Stream" }).click();
      await page.getByLabel(/^Agent:/u).click();
      await page.getByRole("option", { name: "Build", exact: true }).click();
    };
    const submit = async (text, background) => {
      const admitted = page.waitForResponse(
        (response) =>
          /\/session\/[^/]+\/prompt$/u.test(new URL(response.url()).pathname) &&
          response.request().method() === "POST",
      );
      await page.getByLabel("Prompt", { exact: true }).fill(text);
      await page.getByRole("button", { name: "Send", exact: true }).click();
      if (background) await background();
      const response = await admitted;
      expect(response.ok(), await response.text()).toBe(true);
      const id = decodeURIComponent(new URL(response.url()).pathname.split("/").at(-2));
      if (background) {
        await page
          .locator(".session-drafts .shell-session-row")
          .filter({ hasText: text })
          .waitFor({ state: "hidden" });
        expect(
          await page
            .getByRole("button", { name: /^Browser fixture one,/u })
            .getAttribute("aria-current"),
        ).toBe("page");
        await api.session.rename({ sessionID: id, title: "Background worktree admission" });
        await selectSession("Background worktree admission");
      }
      await page.locator(".new-session-screen").waitFor({ state: "hidden" });
      await transcript(text);
      await idle();
      return api.session.get({ sessionID: id });
    };
    try {
      await start("local", "new-session-local");
      const local = await submit("New session local branch admission");
      expect(local.location.directory).toBe(canonical);
      expect(await git(project, "branch", "--show-current")).toBe("new-session-local");
      expect(await git(project, "rev-parse", "HEAD")).toBe(await git(project, "rev-parse", "main"));
      expect(await readFile(join(project, "working.txt"), "utf8")).toBe(
        "Uncommitted working content\n",
      );
      await git(project, "switch", previousBranch);
      await expect
        .poll(
          async () =>
            (await api.agent.get({ agentID: "build", location: { directory: canonical } })).data
              .hidden,
        )
        .toBe(false);
      await start("worktree", "acceptance");
      let release;
      const held = new Promise((resolve) => {
        release = resolve;
      });
      const route = async (request) => {
        if (request.request().method() === "POST") await held;
        await request.continue();
      };
      await page.route("**/api/worktree**", route);
      let worktree;
      try {
        worktree = await submit("New session detached worktree admission", async () => {
          await page.getByText("Preparing worktree…", { exact: true }).waitFor();
          expect(
            await page.getByLabel("Prompt", { exact: true }).getAttribute("contenteditable"),
          ).toBe("false");
          await page.screenshot({ path: join(artifacts, "browser-new-session-preparing.png") });
          await selectSession("Browser fixture one");
          release();
        });
      } finally {
        release();
        await page.unroute("**/api/worktree**", route);
      }
      expect(worktree.location.directory).not.toBe(canonical);
      expect(await git(worktree.location.directory, "branch", "--show-current")).toBe("");
      expect(await git(worktree.location.directory, "rev-parse", "HEAD")).toBe(
        await git(project, "rev-parse", "acceptance"),
      );
      expect(await readFile(join(worktree.location.directory, "branch.txt"), "utf8")).toBe(
        "Committed branch content\n",
      );
      await api.session.remove({ sessionID: worktree.id });
      await api.worktree.remove({
        directory: worktree.location.directory,
        force: true,
        location: { directory: canonical },
      });
      for (const branch of [
        "config-hidden-build",
        ...["agent", "agents", "mode", "modes"].map(
          (directory) => "markdown-hidden-build-" + directory,
        ),
      ]) {
        await git(project, "switch", previousBranch);
        await expect
          .poll(
            async () =>
              (await api.agent.get({ agentID: "build", location: { directory: canonical } })).data
                .hidden,
          )
          .toBe(false);
        await start("local", branch);
        const count = (await api.session.list({ limit: 1000 })).data.length;
        await page
          .getByLabel("Prompt", { exact: true })
          .fill("Branch config must be fresh before Send: " + branch);
        await page.getByRole("button", { name: "Send", exact: true }).click();
        await page
          .getByText("The saved agent is unavailable at this location.", { exact: true })
          .waitFor();
        expect((await api.session.list({ limit: 1000 })).data.length).toBe(count);
        expect(await git(project, "branch", "--show-current")).toBe(branch);
        await page.getByRole("button", { name: "Copy to edit", exact: true }).waitFor();
        expect(await page.getByRole("alert").count()).toBe(1);
        expect(
          await page
            .locator(".composer")
            .getByRole("button", { name: "Copy to edit", exact: true })
            .count(),
        ).toBe(1);
        if (branch === "config-hidden-build")
          await page.screenshot({ path: join(artifacts, "browser-new-session-failed.png") });
        await page.getByRole("button", { name: "Edit draft", exact: true }).click();
        await expect
          .poll(() => page.getByLabel("Prompt", { exact: true }).getAttribute("contenteditable"))
          .toBe("true");
        expect((await api.session.list({ limit: 1000 })).data.length).toBe(count);
        const row = page
          .locator(".session-drafts .shell-session-row")
          .filter({ hasText: "Branch config must be fresh before Send" });
        await row.hover();
        await row.getByRole("button", { name: /^Delete draft:/u }).click();
      }
      await api.session.remove({ sessionID: local.id });
    } finally {
      await git(project, "switch", previousBranch);
    }
  });

  it("shows a deleted project as unavailable in the picker without a global warning", async () => {
    const directory = join(profile.paths.app, "deleted-project");
    await mkdir(directory);
    const registered = await api.project.current({ location: { directory } });
    await rm(directory, { recursive: true });
    // Load the externally arranged registry row into a fresh SDK workspace.
    await page.reload();
    await ensureConnected();
    await page.getByRole("button", { name: "Create session", exact: true }).click();
    const warning = page.getByRole("alert").filter({ hasText: "saved project folder" });
    expect(await warning.count()).toBe(0);
    expect(await page.locator(".composer").getByRole("button", { name: "Retry" }).count()).toBe(0);
    await page.getByRole("button", { name: /^Project:/u }).click();
    const options = page.locator(".selection-option-detail");
    await expect.poll(() => options.count()).toBeGreaterThan(0);
    const unavailable = page.locator('.selection-list [data-slot="list-item"]').filter({
      has: page.getByText(registered.canonical, { exact: true }),
    });
    await expect.poll(() => unavailable.isDisabled()).toBe(true);
    await page.getByPlaceholder("Search project").fill("deleted-project");
    await page.keyboard.press("Enter");
    expect(
      await page.getByRole("button", { name: /^Project:/u }).getAttribute("aria-expanded"),
    ).toBe("true");
    expect((await api.project.list()).some((candidate) => candidate.id === registered.id)).toBe(
      true,
    );
    await page.screenshot({ path: join(artifacts, "browser-unavailable-project.png") });
    await mkdir(directory);
    await page.getByRole("button", { name: "Retry unavailable projects", exact: true }).click();
    const picker = page.getByRole("button", { name: /^Project:/u });
    await expect.poll(() => picker.isEnabled()).toBe(true);
    await picker.click();
    await page.getByText(registered.canonical, { exact: true }).waitFor();
    await expect.poll(() => unavailable.isEnabled()).toBe(true);
    await page.keyboard.press("Escape");
    await selectSession("Permission acceptance");
  });

  it("retains real terminal processes across hiding, session navigation and WSS recovery", async () => {
    await ensureConnected();
    const location = { directory: await realpath(project) };
    const session = await api.session.create({ title: "Terminal acceptance", location });
    const neighbor = await api.session.create({ title: "Terminal same location", location });
    const elsewhere = await api.session.create({
      title: "Terminal other location",
      location: { directory: await realpath(secondaryProject) },
    });
    await selectSession(session.title);
    // A small real input application exercises alternate-screen and composed
    // text without depending on the user's shell configuration or installed TUI.
    await writeFile(
      join(project, ".git", "terminal-acceptance.sh"),
      `printf 'TERMINAL_READY\\n'
while IFS= read -r line; do
  case "$line" in
    SIZE) stty size > .git/terminal-size.txt ;;
    CLIPBOARD) printf '\\033]52;c;'; sleep 0.05; printf '?\\007'; printf '\\033\\033]52;c;?\\007]52;c;?\\007'; printf '\\302\\2350;title\\033]52;c;?\\007CLIPBOARD_DONE\\n' ;;
    FLOOD) for ((i=0; i<2000; i++)); do printf 'flood-%04d abcdefghijklmnopqrstuvwxyz\\n' "$i"; done; printf 'FLOOD_DONE\\n' ;;
    ALT) printf '\\033[?1049h\\033[2J\\033[HALTERNATE_READY\\n'; IFS= read -r line; printf '%s' "$line" > .git/terminal-alt.txt; printf '\\033[?1049lALTERNATE_DONE\\n' ;;
    *) printf '%s' "$line" > .git/terminal-input.txt; printf 'REPLY:%s\\n' "$line" ;;
  esac
done
`,
    );
    const sockets = [];
    const output = [];
    const sent = [];
    const resizes = [];
    const observeResize = (request) => {
      if (request.method() === "PUT" && /\/api\/pty\//u.test(request.url()))
        resizes.push({ url: request.url(), size: request.postDataJSON()?.size });
    };
    page.on("request", observeResize);
    const observeSocket = (socket) => {
      if (!/\/api\/pty\/[^/]+\/connect/u.test(socket.url())) return;
      sockets.push(socket.url());
      socket.on("framesent", ({ payload }) => sent.push(payload.toString()));
      socket.on("framereceived", ({ payload }) => {
        const text = payload.toString();
        if (!text.startsWith("\0")) output.push(text);
      });
    };
    page.on("websocket", observeSocket);
    const disk = (name) => readFile(join(project, ".git", name), "utf8").catch(() => "");
    const surface = () => page.locator(".terminal-surface[data-terminal-id]:visible");
    const input = () => surface().getByLabel("Terminal input", { exact: true });
    const type = async (text) => {
      await input().focus();
      await page.keyboard.type(text);
      await page.keyboard.press("Enter");
    };
    const fontPattern = "**/assets/JetBrainsMonoNerdFontMono-Regular*.ttf";
    await page.route(fontPattern, failFont);
    let retryFont = true;
    const create = async () => {
      const existing = new Set((await api.pty.list({ location })).data.map((pty) => pty.id));
      await page.getByRole("button", { name: "New terminal", exact: true }).click();
      if (retryFont) {
        const retry = page.getByRole("button", { name: "Retry terminal renderer", exact: true });
        await retry.waitFor();
        const id = await surface().getAttribute("data-terminal-id");
        await page.unroute(fontPattern, failFont);
        let releaseFont;
        const heldFont = new Promise((resolve) => {
          releaseFont = resolve;
        });
        const holdFont = async (route) => {
          await heldFont;
          await route.continue();
        };
        await page.route(fontPattern, holdFont);
        try {
          const requested = page.waitForRequest(fontPattern);
          await retry.click();
          await requested;
          await page.getByRole("button", { name: "Hide terminal", exact: true }).click();
          releaseFont();
          const hidden = page.locator(`.terminal-surface[data-terminal-id="${id}"]`);
          await expect.poll(() => hidden.getAttribute("data-ready")).toBe("true");
          expect(sockets).toHaveLength(0);
          expect(resizes.filter((request) => request.url.includes(id))).toEqual([]);
          await page.getByRole("button", { name: "Show terminal", exact: true }).click();
        } finally {
          releaseFont();
          await page.unroute(fontPattern, holdFont);
        }
        await expect.poll(() => surface().getAttribute("data-ready")).toBe("true");
        expect(await surface().getAttribute("data-terminal-id")).toBe(id);
        expect(
          (await api.pty.list({ location })).data.filter((pty) => !existing.has(pty.id)),
        ).toHaveLength(1);
        retryFont = false;
      }
      await expect
        .poll(async () => {
          if ((await surface().count()) !== 1) return "No single visible surface";
          const id = await surface().getAttribute("data-terminal-id");
          const ready =
            id !== null &&
            !existing.has(id) &&
            (await surface().getAttribute("data-ready")) === "true";
          return ready
            ? true
            : page.locator(".terminal-surface").evaluateAll((nodes) =>
                nodes.map((node) => ({
                  id: node.getAttribute("data-terminal-id"),
                  ready: node.getAttribute("data-ready"),
                  hidden: node.hidden,
                })),
              );
        })
        .toBe(true);
      await expect
        .poll(() => page.getByRole("tab", { selected: true }).getAttribute("data-status"))
        .toBe("connected");
      const id = await surface().getAttribute("data-terminal-id");
      const info = (await api.pty.get({ ptyID: id, location })).data;
      expect(info.cwd).toBe(location.directory);
      expect(info.status).toBe("running");
      const title = await page.getByRole("tab", { selected: true }).getAttribute("aria-label");
      return { id, title, node: await surface().elementHandle() };
    };
    const close = async (terminal) => {
      // Use the public tab title rather than the server's opaque PTY title.
      await page
        .getByRole("button", { name: `Close terminal ${terminal.title}`, exact: true })
        .click();
      await expect
        .poll(async () =>
          (await api.pty.list({ location })).data.some((pty) => pty.id === terminal.id),
        )
        .toBe(false);
      await expect.poll(() => terminal.node.evaluate((node) => node.isConnected)).toBe(false);
    };
    try {
      await page.getByRole("button", { name: "Show terminal", exact: true }).click();
      const first = await create();
      await expect.poll(() => resizes.some((request) => request.url.includes(first.id))).toBe(true);
      expect(
        resizes
          .filter((request) => request.url.includes(first.id))
          .every(({ size }) => size.cols > 1 && size.rows > 1),
      ).toBe(true);
      expect(
        await surface().getByLabel("Terminal output", { exact: true }).getAttribute("tabindex"),
      ).toBe("0");
      await type("exec /bin/bash .git/terminal-acceptance.sh");
      await expect.poll(() => output.join("")).toContain("TERMINAL_READY\r\n");
      const unicode = "👩🏽‍💻 e\u0301 中文";
      await input().focus();
      // Chromium's IME path generates real composition/input events; do not call
      // the widget's write/input implementation or synthesize DOM events.
      const ime = await context.newCDPSession(page);
      try {
        await ime.send("Input.imeSetComposition", {
          text: unicode,
          selectionStart: unicode.length,
          selectionEnd: unicode.length,
        });
        await ime.send("Input.insertText", { text: unicode });
      } finally {
        await ime.detach();
      }
      await page.keyboard.press("Enter");
      await expect.poll(() => disk("terminal-input.txt")).toBe(unicode);
      await expect.poll(() => output.join("")).toContain(`REPLY:${unicode}\r\n`);
      await page.getByRole("button", { name: "Switch to dark theme" }).click();
      await expect
        .poll(() =>
          page
            .getByRole("button", { name: "Switch to light theme" })
            .evaluate((node) => node === document.activeElement),
        )
        .toBe(true);
      expect(await first.node.evaluate((node) => node.isConnected)).toBe(true);
      await page.screenshot({ path: join(artifacts, "browser-terminal-dark.png") });
      await page.getByRole("button", { name: "Switch to light theme" }).click();
      await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: uiUrl });
      await page.evaluate(() => {
        const read = navigator.clipboard.readText.bind(navigator.clipboard);
        document.documentElement.dataset.terminalClipboardReads = "0";
        navigator.clipboard.readText = () => {
          const node = document.documentElement;
          node.dataset.terminalClipboardReads = String(
            Number(node.dataset.terminalClipboardReads) + 1,
          );
          return read();
        };
        return navigator.clipboard.writeText("host clipboard private sentinel");
      });
      await type("CLIPBOARD");
      await expect.poll(() => output.join("")).toContain("CLIPBOARD_DONE\r\n");
      expect(
        await page.evaluate(() => document.documentElement.dataset.terminalClipboardReads),
      ).toBe("0");
      expect(sent.join("")).not.toContain(
        Buffer.from("host clipboard private sentinel").toString("base64"),
      );
      await page.evaluate(() => navigator.clipboard.writeText("clipboard terminal input"));
      await surface().getByLabel("Terminal output", { exact: true }).click({ button: "right" });
      const clipboardMenu = page.locator(".pane-context-menu:visible");
      expect(await clipboardMenu.getByRole("button").allTextContents()).toEqual(["Copy", "Paste"]);
      await clipboardMenu.getByRole("button", { name: "Paste", exact: true }).click();
      await expect.poll(() => output.join("")).toContain("clipboard terminal input");
      await input().focus();
      await page.keyboard.press("Enter");
      await expect.poll(() => disk("terminal-input.txt")).toBe("clipboard terminal input");
      await page.getByRole("button", { name: "Hide terminal", exact: true }).click();
      expect(await first.node.evaluate((node) => node.isConnected)).toBe(true);
      expect((await api.pty.get({ ptyID: first.id, location })).data.status).toBe("running");
      await selectSession(neighbor.title);
      expect(await first.node.evaluate((node) => node.isConnected)).toBe(true);
      await selectSession(session.title);
      await page.getByRole("button", { name: "Show terminal", exact: true }).click();
      await expect.poll(() => surface().getAttribute("data-terminal-id")).toBe(first.id);
      await selectSession(neighbor.title);
      await expect.poll(() => surface().getAttribute("data-terminal-id")).toBe(first.id);
      await selectSession(elsewhere.title);
      expect(await first.node.evaluate((node) => node.isConnected)).toBe(true);
      await expect
        .poll(() => page.locator(`.terminal-surface[data-terminal-id="${first.id}"]`).isVisible())
        .toBe(false);
      await selectSession(session.title);
      await expect.poll(() => surface().getAttribute("data-terminal-id")).toBe(first.id);
      const second = await create();
      expect(second.id).not.toBe(first.id);
      expect(await first.node.evaluate((node) => node.isConnected)).toBe(true);
      expect(
        await page.locator(`.terminal-surface[data-terminal-id="${first.id}"]`).isVisible(),
      ).toBe(false);
      const third = await create();
      await page.getByRole("tab", { name: first.title, exact: true }).focus();
      for (const terminal of [second, third]) {
        await page.keyboard.press("ArrowRight");
        await expect.poll(() => surface().getAttribute("data-terminal-id")).toBe(terminal.id);
        expect(
          await page
            .getByRole("tab", { name: terminal.title, exact: true })
            .evaluate((node) => node === document.activeElement),
        ).toBe(true);
      }
      await close(third);
      await close(second);
      await page.getByRole("tab", { name: first.title, exact: true }).click();
      await expect.poll(() => surface().getAttribute("data-terminal-id")).toBe(first.id);

      await type("SIZE");
      await expect.poll(() => disk("terminal-size.txt")).toMatch(/^\d+ \d+\n$/u);
      const before = (await disk("terminal-size.txt")).trim().split(" ").map(Number);
      const taller = page.waitForResponse((response) => {
        if (
          !response.url().includes(`/api/pty/${first.id}`) ||
          response.request().method() !== "PUT"
        )
          return false;
        return response.request().postDataJSON()?.size?.rows > before[0] && response.ok();
      });
      await page.getByRole("separator", { name: "Resize terminal panel" }).focus();
      for (let index = 0; index < 4; index += 1) await page.keyboard.press("ArrowUp");
      await taller;
      await type("SIZE");
      await expect
        .poll(async () => Number((await disk("terminal-size.txt")).trim().split(" ")[0]))
        .toBeGreaterThan(before[0]);
      const resized = page.waitForResponse((response) => {
        if (
          !response.url().includes(`/api/pty/${first.id}`) ||
          response.request().method() !== "PUT"
        )
          return false;
        return response.request().postDataJSON()?.size?.cols < before[1] && response.ok();
      });
      await page.setViewportSize({ width: 1000, height: 760 });
      await resized;
      await type("SIZE");
      await expect
        .poll(async () => Number((await disk("terminal-size.txt")).trim().split(" ")[1]))
        .toBeLessThan(before[1]);
      await type("ALT");
      await expect.poll(() => output.join("")).toContain("ALTERNATE_READY\r\n");
      await type("alternate keyboard input");
      await expect.poll(() => disk("terminal-alt.txt")).toBe("alternate keyboard input");
      await expect.poll(() => output.join("")).toContain("ALTERNATE_DONE\r\n");
      await type("FLOOD");
      await expect
        .poll(() => output.join(""))
        .toContain("flood-1999 abcdefghijklmnopqrstuvwxyz\r\n");
      await expect.poll(() => output.join("")).toContain("FLOOD_DONE\r\n");

      const attachments = sockets.length;
      proxy.disconnect();
      try {
        await page.getByRole("button", { name: /Select server, .*Reconnecting/u }).waitFor();
      } finally {
        proxy.reconnect();
      }
      await page.getByRole("button", { name: /Select server, .*Connected/u }).waitFor();
      await expect
        .poll(() => page.getByRole("tab", { selected: true }).getAttribute("data-status"))
        .toBe("connected");
      await expect.poll(() => sockets.length).toBeGreaterThan(attachments);
      expect(sockets.every((url) => url.startsWith("wss:"))).toBe(true);
      expect((await api.pty.get({ ptyID: first.id, location })).data.status).toBe("running");
      await type("after-reconnect");
      await expect.poll(() => disk("terminal-input.txt")).toBe("after-reconnect");
      await input().focus();
      const finalUnicode = `final ${unicode}`;
      await page.keyboard.insertText(finalUnicode);
      await page.keyboard.press("Enter");
      await expect.poll(() => disk("terminal-input.txt")).toBe(finalUnicode);
      await expect.poll(() => output.join("")).toContain(`REPLY:${finalUnicode}\r\n`);
      await close(first);

      // Closing after rendering combining/ZWJ output must leave a fresh emulator
      // usable; protect against the close/recreate grapheme-state regression.
      const recreated = await create();
      await type("printf 'recreated\\n' > .git/terminal-recreated.txt");
      await expect.poll(() => disk("terminal-recreated.txt")).toBe("recreated\n");
      await type(`printf 'recreated ${unicode}\\n'`);
      await expect.poll(() => output.join("")).toContain(`recreated ${unicode}\r\n`);
      await page.screenshot({ path: join(artifacts, "browser-terminal.png") });
      await close(recreated);
      expect(errors).toEqual([]);
    } finally {
      proxy.reconnect();
      await page.unroute(fontPattern, failFont);
      await page.evaluate(() => {
        delete navigator.clipboard.readText;
      });
      page.off("websocket", observeSocket);
      page.off("request", observeResize);
      await page.setViewportSize({ width: 1280, height: 860 });
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
