import assert from "node:assert/strict";
import { copyFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Schema } from "effect";
import { $, $$, browser } from "@wdio/globals";

const TIMEOUT = 60_000;

// DOM interaction drives the feature; Electron inspection establishes native ownership/visibility.
export async function verifyBrowserFlows(artifacts: string): Promise<void> {
  const provider = process.env.OCUI_E2E_PROVIDER_URL;
  assert.ok(provider);
  await browser.electron.execute((electron) => {
    const win = electron.BrowserWindow.getAllWindows()[0];
    win?.show();
    win?.focus();
    electron.app.focus({ steal: true });
  });
  // No Browser-tab click or enable action: the agent must be ready in the conversation.
  await $('[aria-label="Prompt"]').setValue(`E2E_BROWSER: exercise ${provider}/browser-test`);
  await $('[aria-label="Send"]').click();
  let reply = "";
  await browser.waitUntil(
    async () => {
      const response = await fetch(`${provider}/_state`);
      const state = await response.json();
      const record = state.requests.find(
        (request: { prompt: string; toolReply?: unknown }) =>
          request.prompt.includes("E2E_BROWSER") && Schema.is(Schema.String)(request.toolReply),
      );
      if (!record) return false;
      reply = record.toolReply;
      return true;
    },
    { timeout: 120_000, timeoutMsg: "Agent browser operations did not complete successfully" },
  );
  await $('[aria-label="Send"]').waitForDisplayed({ timeout: TIMEOUT });
  await $('[aria-label="Browser address"]').waitForDisplayed({ timeout: TIMEOUT });
  await $(".browser-tab-select=Browser acceptance").waitForDisplayed({ timeout: TIMEOUT });
  try {
    await browser.waitUntil(async () => (await nativePages()).some((page) => page.visible), {
      timeout: TIMEOUT,
    });
  } catch (cause) {
    const viewport = await browser.execute(() => {
      const element = document.querySelector(".browser-viewport");
      const rect = element?.getBoundingClientRect();
      return {
        visibility: document.visibilityState,
        bounds: rect?.toJSON(),
        hit: rect
          ? document.elementFromPoint(rect.x + 1, rect.y + 1)?.outerHTML.slice(0, 200)
          : null,
        dialogs: Array.from(document.querySelectorAll('[role="dialog"]'), (dialog) => ({
          bounds: dialog.getBoundingClientRect().toJSON(),
          hidden: getComputedStyle(dialog).visibility,
        })),
      };
    });
    throw new Error(
      `Native viewport failed: ${JSON.stringify({ viewport, pages: await nativePages() })}`,
      { cause },
    );
  }
  const [page] = await nativePages();
  assert.ok(page);
  assert.match(page.proxy, /^PROXY /);
  assert.ok(page.bounds.width > 100 && page.bounds.height > 100);

  // A native title event replaces the browser snapshot without committing a URL.
  // Keep the renderer-owned draft/selection, then submit through the real owner.
  const address = $('[aria-label="Browser address"]');
  const draftUrl = `${provider}/browser-test#address-draft-preserved`;
  await address.setValue(draftUrl);
  await browser.execute(() => {
    const input = document.querySelector<HTMLInputElement>('[aria-label="Browser address"]');
    if (!input) throw new Error("Browser address missing");
    input.setSelectionRange(7, 16, "backward");
  });
  await browser.electron.execute(async (electron, pageID: number) => {
    const contents = electron.webContents.fromId(pageID);
    if (!contents) throw new Error("Native browser page missing");
    await contents.executeJavaScript('document.title = "Address update acceptance"');
  }, page.id);
  await $(".browser-tab-select=Address update acceptance").waitForDisplayed({ timeout: TIMEOUT });
  assert.equal(await address.getValue(), draftUrl);
  assert.deepEqual(
    await browser.execute(() => {
      const input = document.querySelector<HTMLInputElement>('[aria-label="Browser address"]');
      return [input?.selectionStart, input?.selectionEnd, input?.selectionDirection];
    }),
    [7, 16, "backward"],
  );
  await $("button=Go").click();
  await browser.waitUntil(
    async () =>
      (await browser.electron.execute(
        (electron, pageID: number) => electron.webContents.fromId(pageID)?.getURL(),
        page.id,
      )) === draftUrl,
    { timeout: TIMEOUT, timeoutMsg: "Preserved address draft did not navigate the native page" },
  );
  await $('[aria-label="Reload browser page"]').click();
  await $(".browser-tab-select=Browser acceptance").waitForDisplayed({ timeout: TIMEOUT });
  assert.equal(await address.getValue(), draftUrl);

  await $('[aria-label="Hide context panel"]').click();
  await browser.waitUntil(async () => (await nativePages()).every((item) => !item.visible));
  await $('[aria-label="Show context"]').click();
  await browser.waitUntil(async () => (await nativePages()).some((item) => item.visible));
  assert.equal((await nativePages())[0]?.id, page.id);
  const previousSession = await $('.shell-session-main[aria-current="page"]').getAttribute(
    "aria-label",
  );
  await $('[aria-label="Create session"]').click();
  await $(".new-session-screen").waitForDisplayed();
  await browser.waitUntil(async () => (await nativePages()).every((item) => !item.visible));
  assert.ok(previousSession);
  await $(`.shell-session-main[aria-label=${JSON.stringify(previousSession)}]`).click();
  await browser.waitUntil(async () => (await nativePages()).some((item) => item.visible));

  // This fixture is text-only: OpenCode appends an image-input notice after the JSON result.
  assert.ok(reply.startsWith("{"), `Agent browser operation failed: ${reply}`);
  const result = JSON.parse(reply.slice(0, reply.lastIndexOf("}") + 1));
  assert.equal(result.verified, "browser-roundtrip");
  assert.equal(result.data.value.source, "connected-server");
  assert.ok(
    result.logs.messages.some((entry: { text: string }) => entry.text === "Browser acceptance log"),
  );
  assert.equal(JSON.parse(result.network.responseBody.text).source, "connected-server");
  const capture = result.screenshot.files[0];
  const bytes = await readFile(capture.path);
  assert.equal(bytes.length, capture.bytes);
  assert.equal(result.uploaded.value, capture.bytes);
  assert.deepEqual(await readFile(result.exported.files[0].path), bytes);
  assert.ok(result.cpuAnalysis.durationMs >= 0);
  assert.ok(
    result.traceAnalysis.metrics.some(
      (metric: { name: string }) => metric.name === "recordedEvents",
    ),
  );
  assert.equal(bytes.subarray(1, 4).toString(), "PNG");
  await copyFile(capture.path, join(artifacts, "browser-server-capture.png"));
  const report = result.audit.files.find(
    (file: { name: string }) => file.name === "lighthouse.json",
  );
  assert.ok(report);
  const audit = JSON.parse(await readFile(report.path, "utf8"));
  assert.ok(Number.isFinite(audit.categories.accessibility.score));
  await copyFile(report.path, join(artifacts, "browser-lighthouse.json"));
  await $(".transcript-view").waitForDisplayed({ timeout: TIMEOUT });
  const activity = $('.transcript-activity-trigger[aria-expanded="false"]');
  if (await activity.isExisting()) await activity.click();
  await $("button*=execute").waitForClickable({ timeout: TIMEOUT });
  await $("button*=execute").click();
  await $(".transcript-tool-image").waitForDisplayed({ timeout: TIMEOUT });
  await $(".transcript-tool-image").scrollIntoView();
  await browser.waitUntil(
    () =>
      browser.execute(() => {
        const image = document.querySelector<HTMLImageElement>(".transcript-tool-image");
        return image?.complete === true && image.naturalWidth > 0;
      }),
    { timeout: TIMEOUT, timeoutMsg: "The restored tool image did not load" },
  );
  await browser.saveScreenshot(join(artifacts, "browser-agent-roundtrip.png"));

  // User annotation: pick the heading in the native view, comment in the in-page
  // popover, and deliver it with the screenshot.
  await $("button=Annotate").click();
  await $("button=Cancel selection").waitForDisplayed({ timeout: TIMEOUT });
  const annotation = $('[aria-label="Annotation 1 comment"]');
  await browser.waitUntil(
    async () => {
      const failure = await annotationError();
      if (failure) throw new Error(`Annotation pick rejected: ${failure}`);
      if (await annotationPopoverOpen()) return true;
      await clickNativeHeading();
      // Give the capture and popover a moment before clicking the page again.
      await browser.pause(700);
      return annotationPopoverOpen();
    },
    {
      timeout: TIMEOUT,
      interval: 250,
      timeoutMsg: "Native element pick did not open the comment popover",
    },
  );
  await typeAnnotationComment("E2E_ANNOTATION: make this heading bolder");
  await annotation.waitForDisplayed({ timeout: TIMEOUT });
  assert.match(await annotation.getValue(), /E2E_ANNOTATION/);
  const preview = $('[aria-label="Enlarge Browser annotation 1"]');
  await preview.click();
  await $('[role="dialog"][aria-modal="true"]').waitForDisplayed({ timeout: TIMEOUT });
  await browser.waitUntil(async () => (await nativePages()).every((item) => !item.visible), {
    timeout: TIMEOUT,
    timeoutMsg: "Native browser remained above the capture preview",
  });
  await browser.saveScreenshot(join(artifacts, "browser-capture-preview.png"));
  await browser.keys("Escape");
  await browser.waitUntil(async () => (await nativePages()).some((item) => item.visible), {
    timeout: TIMEOUT,
    timeoutMsg: "Native browser did not return after dismissing the capture preview",
  });
  assert.equal((await nativePages())[0]?.id, page.id);
  await browser.waitUntil(() => preview.isFocused(), { timeout: TIMEOUT });
  assert.match(await annotation.getValue(), /E2E_ANNOTATION/);
  await browser.saveScreenshot(join(artifacts, "browser-capture-card.png"));
  const instruction = "Please fix the captured heading.";
  await $('[aria-label="Prompt"]').setValue(instruction);
  await $("button=Add to composer").click();
  const draftPill = $(".composer .attachment-pill-browser .attachment-pill-trigger");
  try {
    await browser.waitUntil(
      async () => {
        const failure = await annotationError();
        if (failure) throw new Error(`Annotation batch rejected: ${failure}`);
        return draftPill.isDisplayed();
      },
      { timeout: TIMEOUT, timeoutMsg: "Annotations were not added to the composer" },
    );
  } catch (cause) {
    throw new Error(
      `Annotations were not added to the composer. Error region: ${JSON.stringify(await annotationError())}. Composer: ${JSON.stringify(await composerText()).slice(0, 200)}`,
      { cause },
    );
  }
  assert.equal(await composerText(), instruction);
  assert.equal(await draftPill.getText(), "Browser · 1");
  await draftPill.click();
  assert.match(
    await $(".attachment-detail-popover").getText(),
    /E2E_ANNOTATION: make this heading bolder/,
  );
  await browser.saveScreenshot(join(artifacts, "browser-annotation-draft.png"));
  await $('.attachment-detail-popover [aria-label="Enlarge Browser annotation 1"]').click();
  await $('[role="dialog"][aria-modal="true"] .image-preview-image').waitForDisplayed({
    timeout: TIMEOUT,
  });
  await browser.waitUntil(
    () =>
      browser.execute(() => {
        const image = document.querySelector<HTMLImageElement>(".image-preview-image");
        return image?.complete === true && image.naturalWidth > 0;
      }),
    { timeout: TIMEOUT, timeoutMsg: "Draft annotation screenshot did not load" },
  );
  await browser.saveScreenshot(join(artifacts, "browser-annotation-preview.png"));
  await browser.keys("Escape");
  await browser.keys("Escape");
  assert.equal(await composerText(), instruction);
  await $('[aria-label="Send"]').click();
  await browser.waitUntil(
    async () => {
      const state = await (await fetch(`${provider}/_state`)).json();
      return state.requests.some(
        (request: { prompt: string }) =>
          request.prompt.includes("E2E_ANNOTATION: make this heading bolder") &&
          request.prompt.includes(instruction) &&
          request.prompt.includes('"tag": "h1"') &&
          request.prompt.includes("untrusted page data"),
      );
    },
    { timeout: TIMEOUT, timeoutMsg: "Annotated message did not reach the provider" },
  );
  await $('[aria-label="Send"]').waitForDisplayed({ timeout: TIMEOUT });
  // Files are absent from optimistic rows. This specific, completed user row
  // establishes the durable attachment boundary before opening its popover.
  const messageID = await browser.execute((text) => {
    const messages = Array.from(document.querySelectorAll(".transcript-user-message"));
    return messages
      .filter((message) => message.textContent?.includes(text))
      .at(-1)
      ?.getAttribute("data-message-id");
  }, instruction);
  assert.ok(messageID);
  const pillSelector = `.transcript-user-message[data-message-id=${JSON.stringify(messageID)}] .attachment-pill-browser .attachment-pill-trigger`;
  const browserPill = $(pillSelector);
  try {
    await browserPill.waitForClickable({ timeout: TIMEOUT });
    await browserPill.click();
    await browser.waitUntil(
      () => browserPill.getAttribute("aria-expanded").then((value) => value === "true"),
      {
        timeout: TIMEOUT,
        timeoutMsg: "Sent browser attachment popover did not open",
      },
    );
    const controls = await browserPill.getAttribute("aria-controls");
    assert.ok(controls);
    const imageSelector = `[id=${JSON.stringify(controls)}] [aria-label="Enlarge Browser annotation 1"] img`;
    await $(`[id=${JSON.stringify(controls)}]`).waitForDisplayed({ timeout: TIMEOUT });
    const userImage = $(imageSelector);
    await userImage.waitForExist({ timeout: TIMEOUT });
    await userImage.scrollIntoView();
    await browser.waitUntil(
      () =>
        browser.execute((selector) => {
          const image = document.querySelector<HTMLImageElement>(selector);
          return image?.complete === true && image.naturalWidth > 0;
        }, imageSelector),
      { timeout: TIMEOUT, timeoutMsg: "Annotated screenshot did not render in the transcript" },
    );
  } catch (cause) {
    const state = await browser.execute((selector) => {
      const trigger = document.querySelector(selector);
      const controls = trigger?.getAttribute("aria-controls");
      const content = controls ? document.getElementById(controls) : undefined;
      const active = document.activeElement;
      return {
        connected: trigger?.isConnected === true,
        expanded: trigger?.getAttribute("aria-expanded"),
        controls,
        contentPresent: content?.isConnected === true,
        images: content?.querySelectorAll("img").length ?? 0,
        imageSourcePresent:
          content?.querySelector("img")?.getAttribute("src")?.startsWith("data:image/") === true,
        focus: { tag: active?.tagName, role: active?.getAttribute("role") },
      };
    }, pillSelector);
    const native = (await nativePages()).map(({ id, visible }) => ({ id, visible }));
    throw new Error(
      `Sent browser attachment failed: ${JSON.stringify({ messageID, state, native })}`,
      { cause },
    );
  }
  await browser.saveScreenshot(join(artifacts, "browser-annotation-sent.png"));
  await browser.keys("Escape");

  await $('.shell-session-main:not([aria-current="page"])').click();
  // The context panel is remembered per session: a session that has never
  // shown the browser starts closed on Diff, so open its Browser view first.
  const showContext = $('[aria-label="Show context"]');
  if (await showContext.isExisting()) await showContext.click();
  await $("button=Browser").click();
  await $('[aria-label="Browser address"]').waitForDisplayed({ timeout: TIMEOUT });
  await $(".browser-empty").waitForDisplayed();
  assert.equal((await nativePages())[0]?.id, page.id);
  await browser.waitUntil(async () => (await nativePages()).every((item) => !item.visible));
  await $('.shell-session-main:not([aria-current="page"])').click();
  await browser.waitUntil(async () => (await nativePages()).some((item) => item.visible));
  await $('[aria-label="New browser tab"]').click();
  await browser.waitUntil(async () => (await nativePages()).length === 2);
  const tabs = $$(".browser-tab");
  await tabs[1].$('button[aria-label^="Close "]').click();
  await browser.waitUntil(async () => (await nativePages()).length === 1);
  assert.equal((await nativePages())[0]?.id, page.id);
  await $('.browser-tab button[aria-label^="Close "]').click();
  await browser.waitUntil(async () => (await nativePages()).length === 0);

  // Reload closes automatic attachments and all native tabs.
  const title = await $(".titlebar-session-title").getText();
  await $('[aria-label="New browser tab"]').waitForClickable({ timeout: TIMEOUT });
  await $('[aria-label="New browser tab"]').click();
  await browser.waitUntil(async () => (await nativePages()).length === 1);
  await browser.refresh();
  await browser.waitUntil(async () => (await nativePages()).length === 0);
  await $('[aria-label="Select server, Local server, Connected"]').waitForDisplayed({
    timeout: TIMEOUT,
  });
  const session = $(`.shell-session-main*=${title}`);
  await session.waitForClickable({ timeout: TIMEOUT });
  await session.click();
  await $('[aria-label="Prompt"]').waitForDisplayed({ timeout: TIMEOUT });
}

async function nativePages() {
  return browser.electron.execute(async (electron) => {
    const win = electron.BrowserWindow.getAllWindows()[0];
    if (!win) throw new Error("Acceptance window missing");
    const pages = win.contentView.children.filter(
      (view): view is Electron.WebContentsView =>
        view instanceof electron.WebContentsView && view.webContents !== win.webContents,
    );
    return Promise.all(
      pages.map(async (page) => {
        return {
          id: page.webContents.id,
          visible: page.getVisible(),
          bounds: page.getBounds(),
          proxy: await page.webContents.session.resolveProxy(page.webContents.getURL()),
        };
      }),
    );
  });
}

const composerText = () =>
  browser.execute(() => document.querySelector('[aria-label="Prompt"]')?.textContent ?? "");

const annotationError = () =>
  browser.execute(
    () => document.querySelector(".browser-annotation-error")?.textContent?.trim() ?? "",
  );

/** Native WebContentsView input cannot be driven through the renderer DOM. */
async function clickNativeHeading() {
  await browser.electron.execute(async (electron) => {
    const win = electron.BrowserWindow.getAllWindows()[0];
    if (!win) throw new Error("Acceptance window missing");
    const view = win.contentView.children.find(
      (candidate): candidate is Electron.WebContentsView =>
        candidate instanceof electron.WebContentsView &&
        candidate.getVisible() &&
        candidate.webContents !== win.webContents,
    );
    if (!view) throw new Error("Visible browser view missing");
    // The page script validates its own geometry; this callback only runs inside Electron, not the app modules.
    const point = await view.webContents.executeJavaScript(`(() => {
      const heading = document.querySelector("h1");
      if (!heading) throw new Error("Acceptance heading missing");
      const rect = heading.getBoundingClientRect();
      const center = { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
      if (!Number.isFinite(center.x) || !Number.isFinite(center.y))
        throw new Error("Acceptance heading has no usable center");
      return center;
    })()`);
    view.webContents.focus();
    view.webContents.sendInputEvent({ type: "mouseMove", ...point });
    view.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...point });
    view.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...point });
  });
}

/** True while the annotation popover is open in the visible page. */
async function annotationPopoverOpen() {
  return browser.electron.execute(async (electron) => {
    const win = electron.BrowserWindow.getAllWindows()[0];
    if (!win) return false;
    const view = win.contentView.children.find(
      (candidate): candidate is Electron.WebContentsView =>
        candidate instanceof electron.WebContentsView &&
        candidate.getVisible() &&
        candidate.webContents !== win.webContents,
    );
    if (!view) return false;
    const open = await view.webContents.executeJavaScript(
      "document.querySelector('[data-ocui-annotator][data-open]') !== null",
    );
    return open === true;
  });
}

/** Clicks and types into the focused in-page comment box, then saves it with Enter. */
async function typeAnnotationComment(text: string) {
  await browser.electron.execute(async (electron, comment: string) => {
    const win = electron.BrowserWindow.getAllWindows()[0];
    if (!win) throw new Error("Acceptance window missing");
    const view = win.contentView.children.find(
      (candidate): candidate is Electron.WebContentsView =>
        candidate instanceof electron.WebContentsView &&
        candidate.getVisible() &&
        candidate.webContents !== win.webContents,
    );
    if (!view) throw new Error("Visible browser view missing");
    const rect = await view.webContents.executeJavaScript(`(() => {
      const host = document.querySelector("[data-ocui-annotator]");
      const raw = host?.getAttribute("data-ocui-annotator-rect");
      if (!raw) return null;
      const [x, y, width, height] = raw.split(",").map(Number);
      if (![x, y, width, height].every(Number.isFinite)) return null;
      return { x, y, width, height };
    })()`);
    if (!rect) throw new Error("Annotation comment box has no geometry");
    electron.app.focus({ steal: true });
    win.focus();
    view.webContents.focus();
    // Click the textarea like a user so focus does not depend on the autofocus race.
    const point = { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + 16) };
    view.webContents.sendInputEvent({ type: "mouseMove", ...point });
    view.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...point });
    view.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...point });
    await new Promise((resolve) => setTimeout(resolve, 100));
    await view.webContents.insertText(comment);
    view.webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
    view.webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
  }, text);
}
