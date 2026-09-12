/// <reference types="node" />

import assert from "node:assert/strict";
import { access, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { $, browser } from "@wdio/globals";
import type { SessionsResponse, VcsDiffOutput } from "@opencode-ai/client";

import { git } from "./project-fixture.ts";
const TIMEOUT = 45_000;

/** Called with two real direct sessions already created and the sidebar open. */
export async function verifyProjectFlows(projectDirectory: string): Promise<void> {
  await browser.keys("Escape");
  const initialSessions = await sessions();
  assert.equal(initialSessions.length, 2);
  const canonicalProject = await realpath(projectDirectory);
  assert.ok(initialSessions.every((session) => session.location.directory === canonicalProject));

  if (await $('[aria-label="Show context"]').isExisting()) {
    await $('[aria-label="Show context"]').click();
  }
  await expectFiles(["working.txt"]);
  await verifyReviewReload();

  // This pinned server watches Git HEAD, not arbitrary workspace edits.
  await writeFile(join(projectDirectory, "watcher.txt"), "Watcher invalidation evidence\n");
  const serverFiles = await browser.execute(async (directory) => {
    const result = await window.desktop.localOpenCode.connect();
    if (result.status !== "connected") throw new Error(result.message);
    const url = new URL("/api/vcs/diff", result.connection.serverUrl);
    url.searchParams.set("location[directory]", directory);
    url.searchParams.set("mode", "working");
    const response = await fetch(url, {
      headers: { Authorization: `Basic ${btoa(`opencode:${result.connection.password}`)}` },
    });
    if (!response.ok) throw new Error(`Server diff returned ${response.status}`);
    const body: VcsDiffOutput = await response.json();
    return body.data.map((file) => file.file);
  }, canonicalProject);
  assert.ok(serverFiles.includes("watcher.txt"));
  await changeBranchAndObserveEvent(projectDirectory);
  await expectFiles(["watcher.txt", "working.txt"]);
  await $('[aria-label="Create session"]').click();
  await $(".new-session-project-trigger").waitForClickable({ timeout: TIMEOUT });
  await $("button=Start in worktree").click();
  await browser.waitUntil(async () => (await sessions()).length === 3, {
    timeout: TIMEOUT,
    timeoutMsg: "The UI did not create a real worktree session",
  });
  await $(".server-flow-dialog").waitForExist({ reverse: true, timeout: TIMEOUT });
  const created = (await sessions()).find(
    (session) => !initialSessions.some((previous) => previous.id === session.id),
  );
  assert.ok(created);
  const worktree = created.location.directory;
  assert.notEqual(worktree, canonicalProject);
  const dataHome = process.env.XDG_DATA_HOME;
  assert.ok(dataHome, "The E2E runner must isolate XDG_DATA_HOME");
  assert.ok(worktree.startsWith(`${await realpath(dataHome)}/opencode/worktree/`));
  assert.equal(
    await git(worktree, "rev-parse", "HEAD"),
    await git(projectDirectory, "rev-parse", "origin/main"),
  );
  assert.ok((await git(projectDirectory, "worktree", "list", "--porcelain")).includes(worktree));
  await $("p=No working tree changes").waitForDisplayed({ timeout: TIMEOUT });

  const deleteButton = ".shell-session-row.selected .shell-session-delete";
  await $(".shell-session-row.selected").moveTo();
  await $(deleteButton).waitForClickable({ timeout: TIMEOUT });
  await $(deleteButton).click();
  await $('.delete-session-dialog button[type="submit"]').click();
  await $(".delete-session-dialog").waitForExist({ reverse: true, timeout: TIMEOUT });
  await browser.waitUntil(async () => (await sessions()).length === 2, { timeout: TIMEOUT });
  assert.ok(!(await sessions()).some((session) => session.id === created.id));
  assert.ok(!(await git(projectDirectory, "worktree", "list", "--porcelain")).includes(worktree));
  await assert.rejects(access(worktree), { code: "ENOENT" });
  await access(join(projectDirectory, "working.txt"));
  await expectFiles(["watcher.txt", "working.txt"]);
}

async function changeBranchAndObserveEvent(projectDirectory: string): Promise<void> {
  const connection = await browser.execute(async () => {
    const result = await window.desktop.localOpenCode.connect();
    if (result.status !== "connected") throw new Error(result.message);
    return result.connection;
  });
  const response = await fetch(`${connection.serverUrl}/api/event`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`opencode:${connection.password}`).toString("base64")}`,
    },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  assert.equal(response.status, 200);
  assert.ok(response.body);
  const reader = response.body.getReader();
  try {
    await git(projectDirectory, "checkout", "-b", "acceptance-refresh");
    const decoder = new TextDecoder();
    let received = "";
    while (!received.includes('"filesystem.changed"') || !received.includes("HEAD")) {
      const chunk = await reader.read();
      assert.equal(chunk.done, false, "Server events closed before the Git HEAD update");
      received += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    await reader.cancel();
  }
}

async function expectFiles(files: readonly string[]): Promise<void> {
  await browser.waitUntil(
    async () => {
      const actual = await browser.execute(() =>
        Array.from(
          document.querySelectorAll(".diff-file-name [title]"),
          (node) => node.getAttribute("title") ?? "",
        ),
      );
      return actual.length === files.length && files.every((file) => actual.includes(file));
    },
    { timeout: TIMEOUT, timeoutMsg: `Expected rendered diff files: ${files.join(", ")}` },
  );
  assert.equal(await $(".diff-file-unavailable").isExisting(), false);
}

async function verifyReviewReload(): Promise<void> {
  const renderedDiff = $(".pierre-diff-host diffs-container");
  const gutter = renderedDiff.shadow$('[data-column-number="1"][data-line-type="change-addition"]');
  await gutter.waitForDisplayed({ timeout: TIMEOUT });
  await gutter.moveTo();
  await renderedDiff.shadow$("[data-utility-button]").waitForClickable();
  await renderedDiff.shadow$("[data-utility-button]").click();
  const editor = '[aria-label="Comment on working.txt"]';
  await $(editor).waitForDisplayed();
  const comment = "Keep this review through panel remount.";
  await $(editor).setValue(comment);
  await browser.keys("Escape");
  await $(".diff-review-text").waitForDisplayed();
  const completedBefore = await browser.execute(
    () => document.querySelectorAll(".transcript-assistant-complete").length,
  );
  await $('textarea[aria-label="Prompt"]').setValue("E2E_REVIEW: address this code review.");
  await $('[aria-label="Send"]').waitForClickable({ timeout: TIMEOUT });
  await $('[aria-label="Send"]').click();
  await browser.waitUntil(
    async () =>
      (await browser.execute(
        () => document.querySelectorAll(".transcript-assistant-complete").length,
      )) > completedBefore,
    { timeout: TIMEOUT, timeoutMsg: "Review submission did not receive a completed answer" },
  );
  await $('[aria-label="Send"]').waitForDisplayed({ timeout: TIMEOUT });
  // Wait for the durable response before opening a card from the optimistic transcript.
  await $(".transcript-code-review-trigger").waitForDisplayed({ timeout: TIMEOUT });
  await $(".transcript-code-review-trigger").click();
  await $(".transcript-code-review-content").waitForDisplayed({ timeout: TIMEOUT });
  assert.ok((await $(".transcript-code-review-content").getText()).includes(comment));
  assert.equal(await $(".composer-review-row").isExisting(), false);
  assert.equal(await $(".diff-review-text").isExisting(), false);
  const providerUrl = process.env.OCUI_E2E_PROVIDER_URL;
  assert.ok(providerUrl);
  const response = await fetch(`${providerUrl}/_state`);
  assert.equal(response.status, 200);
  const state: { requests: { prompt: string }[] } = await response.json();
  assert.ok(
    state.requests.some(
      (request) =>
        request.prompt.includes("E2E_REVIEW") &&
        request.prompt.includes(comment) &&
        request.prompt.includes("working.txt"),
    ),
  );

  // A renderer reload destroys the draft owner and SDK cache; the review must reload from server metadata.
  const selectedLabel = await $('.shell-session-main[aria-current="page"]').getAttribute(
    "aria-label",
  );
  assert.ok(selectedLabel);
  const selectedSession = `.shell-session-main[aria-label=${JSON.stringify(selectedLabel)}]`;
  assert.equal(
    await browser.execute(
      (selector) => document.querySelectorAll(selector).length,
      selectedSession,
    ),
    1,
    "The reviewed session must have a unique title before testing persistence",
  );
  await browser.refresh();
  await $("button*=Start built-in server").waitForClickable({ timeout: TIMEOUT });
  await $("button*=Start built-in server").click();
  await $('[aria-label="Select server, Local server, Connected"]').waitForDisplayed({
    timeout: TIMEOUT,
  });
  if (await $('[aria-label="Show sessions"]').isExisting()) {
    await $('[aria-label="Show sessions"]').click();
  }
  await $(selectedSession).waitForClickable({ timeout: TIMEOUT });
  await $(selectedSession).click();
  await $(".transcript-code-review-trigger").waitForDisplayed({ timeout: TIMEOUT });
  await $(".transcript-code-review-trigger").click();
  await $(".transcript-code-review-content").waitForDisplayed({ timeout: TIMEOUT });
  assert.ok((await $(".transcript-code-review-content").getText()).includes(comment));
  assert.equal(await $(".composer-review-row").isExisting(), false);
  if (await $('[aria-label="Show context"]').isExisting()) {
    await $('[aria-label="Show context"]').click();
  }
  await expectFiles(["working.txt"]);
  assert.equal(await $(".diff-review-text").isExisting(), false);
}

async function sessions() {
  return browser.execute(async () => {
    const result = await window.desktop.localOpenCode.connect();
    if (result.status !== "connected") throw new Error(result.message);
    const catalog: SessionsResponse["data"] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const url = new URL("/api/session", result.connection.serverUrl);
      url.searchParams.set("limit", "100");
      url.searchParams.set("order", "desc");
      if (cursor !== undefined) url.searchParams.set("cursor", cursor);
      const response = await fetch(url, {
        headers: { Authorization: `Basic ${btoa(`opencode:${result.connection.password}`)}` },
      });
      if (!response.ok) throw new Error(`Session catalog returned ${response.status}`);
      const body: SessionsResponse = await response.json();
      catalog.push(...body.data);
      cursor = body.cursor.next ?? undefined;
      if (cursor !== undefined) {
        if (cursors.has(cursor)) throw new Error("Session catalog repeated its next cursor");
        cursors.add(cursor);
      }
    } while (cursor !== undefined);
    return catalog;
  });
}
