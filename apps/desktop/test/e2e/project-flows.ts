/// <reference types="node" />

import { OpenCode } from "@opencode/client";
import assert from "node:assert/strict";
import { access, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { $, browser } from "@wdio/globals";
import type { SessionsResponse, VcsDiffOutput } from "@opencode/client";

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
  // Exercise the packaged renderer draft, native locks, preparation and first Send.
  const connection = await browser.execute(() => window.desktop.localOpenCode.connect());
  if (connection.status !== "connected") throw new Error(connection.message);
  const api = OpenCode.make({
    baseUrl: connection.connection.serverUrl,
    headers: {
      Authorization: `Basic ${Buffer.from(`opencode:${connection.connection.password}`).toString("base64")}`,
    },
  });
  await $('[aria-label="Create session"]').click();
  await $(".new-session-screen").waitForDisplayed({ timeout: TIMEOUT });
  await $('[aria-label^="Project:"]').click();
  await $(".selection-option-detail=" + canonicalProject).click();
  await $('[aria-label^="Location:"]').click();
  await $(".selection-option*=New worktree").click();
  await $('[aria-label^="Branch:"]').click();
  await $(".selection-option=main").click();
  const modelTrigger = $('[aria-label^="Model:"]');
  await modelTrigger.waitForClickable({ timeout: TIMEOUT });
  await modelTrigger.click();
  const modelOption = $(".composer-model-option=Acceptance Stream");
  await modelOption.waitForClickable({ timeout: TIMEOUT });
  await modelOption.click();
  await $('[aria-label^="Agent:"]').click();
  await $('[role="option"]=Build').click();
  await $('[aria-label="Prompt"]').setValue("Native new-session worktree admission");
  await $('[aria-label="Send"]').waitForClickable({ timeout: TIMEOUT });
  await $('[aria-label="Send"]').click();
  await $(".new-session-screen").waitForExist({ reverse: true, timeout: TIMEOUT });
  const created = (await api.session.list({ limit: 100 })).data.find(
    (session) => !initialSessions.some((initial) => initial.id === session.id),
  );
  assert.ok(created, "First Send must create the worktree session");
  const admitted = (await api.message.list({ sessionID: created.id })).data.find(
    (message) => message.type === "user",
  );
  assert.equal(
    admitted?.type === "user" ? admitted.text : undefined,
    "Native new-session worktree admission",
  );
  await api.session.rename({ sessionID: created.id, title: "Worktree diff fixture" });
  const worktree = created.location.directory;
  assert.notEqual(worktree, canonicalProject);
  const dataHome = process.env.XDG_DATA_HOME;
  assert.ok(dataHome, "The E2E runner must isolate XDG_DATA_HOME");
  assert.ok(worktree.startsWith(`${await realpath(dataHome)}/opencode/worktree/`));
  assert.equal(
    await git(worktree, "rev-parse", "HEAD"),
    await git(projectDirectory, "rev-parse", "refs/heads/main"),
  );
  assert.ok((await git(projectDirectory, "worktree", "list", "--porcelain")).includes(worktree));
  // A newly created session starts with the context panel closed.
  if (await $('[aria-label="Show context"]').isExisting()) {
    await $('[aria-label="Show context"]').click();
  }
  await $("p=No working tree changes").waitForDisplayed({ timeout: TIMEOUT });
  // A session worktree is detached, so it reports no current branch. The Diff
  // panel must still offer the comparison against the default branch. Commit a
  // file in the worktree so the branch diff has a unique result to show; the
  // working tree stays clean.
  assert.equal(await git(worktree, "rev-parse", "--abbrev-ref", "HEAD"), "HEAD");
  await writeFile(join(worktree, "worktree-commit.txt"), "Committed in the worktree\n");
  await git(worktree, "add", "worktree-commit.txt");
  await git(
    worktree,
    "-c",
    "user.name=oc-ui-e2e",
    "-c",
    "user.email=oc-ui-e2e@invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "Worktree commit",
  );
  try {
    await browser.waitUntil(() => $(".diff-comparison-select").isExisting(), {
      timeout: TIMEOUT,
      timeoutMsg: "The detached worktree did not offer a diff comparison",
    });
  } catch (cause) {
    const vcs = await api.vcs.get({ location: { directory: worktree } });
    throw new Error(
      `Missing worktree comparison: ${JSON.stringify(vcs.data)}; ${(await $("body").getText()).slice(-1800)}`,
      { cause },
    );
  }
  await $(".diff-comparison-select").click();
  const branchOption = '[data-slot="menu-v2-item-content"]=Changes vs main';
  await $(branchOption).waitForClickable({ timeout: TIMEOUT });
  await $(branchOption).click();
  await expectFiles(["worktree-commit.txt"]);
  await $(".diff-comparison-select").click();
  await $('[data-slot="menu-v2-item-content"]=Working changes').waitForClickable({
    timeout: TIMEOUT,
  });
  await $('[data-slot="menu-v2-item-content"]=Working changes').click();
  await $("p=No working tree changes").waitForDisplayed({ timeout: TIMEOUT });
  await expectFiles([]);

  const deleteButton = ".shell-session-row.selected .shell-session-delete";
  await $(".shell-session-row.selected").moveTo();
  await $(deleteButton).waitForClickable({ timeout: TIMEOUT });
  await $(deleteButton).click();
  await $('.delete-session-dialog button[type="submit"]').click();
  await $(".delete-session-dialog").waitForExist({ reverse: true, timeout: TIMEOUT });
  await browser.waitUntil(async () => (await sessions()).length === 2, { timeout: TIMEOUT });
  assert.ok(!(await sessions()).some((session) => session.id === created.id));
  // Session deletion keeps the worktree, matching OpenCode Desktop v2.
  assert.ok((await git(projectDirectory, "worktree", "list", "--porcelain")).includes(worktree));
  await access(worktree);
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
        Array.from(document.querySelectorAll(".diff-file-path"), (node) => node.textContent ?? ""),
      );
      return actual.length === files.length && files.every((file) => actual.includes(file));
    },
    { timeout: TIMEOUT, timeoutMsg: `Expected rendered diff files: ${files.join(", ")}` },
  );
  assert.equal(await $(".diff-file-unavailable").isExisting(), false);
}

async function verifyReviewReload(): Promise<void> {
  const renderedDiff = $(".diff-code-view diffs-container");
  const editor = '[aria-label="Comment on working.txt"]';
  // As in browser acceptance, worker highlighting can detach the hovered button.
  await browser.waitUntil(
    async () => {
      if (await $(editor).isExisting()) return true;
      try {
        const gutter = renderedDiff.shadow$(
          '[data-column-number="1"][data-line-type="change-addition"]',
        );
        if (!(await gutter.isDisplayed())) return false;
        await gutter.moveTo();
        const utility = renderedDiff.shadow$("[data-utility-button]");
        if (!(await utility.isExisting())) return false;
        await utility.click();
      } catch {
        return false;
      }
      return $(editor).isExisting();
    },
    { timeout: TIMEOUT, timeoutMsg: "The diff review editor did not open" },
  );
  const comment = "Keep this review through panel remount.";
  await $(editor).setValue(comment);
  await browser.keys("Escape");
  await $(".diff-review-text").waitForDisplayed();
  const completedBefore = await browser.execute(
    () => document.querySelectorAll(".transcript-assistant-complete").length,
  );
  await $('[aria-label="Prompt"]').setValue("E2E_REVIEW: address this code review.");
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
  await $(
    ".transcript-user-message .attachment-pill-review .attachment-pill-trigger",
  ).waitForDisplayed({ timeout: TIMEOUT });
  await $(".transcript-user-message .attachment-pill-review .attachment-pill-trigger").click();
  await $(".attachment-detail-popover").waitForDisplayed({ timeout: TIMEOUT });
  assert.ok((await $(".attachment-detail-popover").getText()).includes(comment));
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
  await $('[aria-label="Select server, Local server, Connected"]').waitForDisplayed({
    timeout: TIMEOUT,
  });
  if (await $('[aria-label="Show sessions"]').isExisting()) {
    await $('[aria-label="Show sessions"]').click();
  }
  await $(selectedSession).waitForClickable({ timeout: TIMEOUT });
  await $(selectedSession).click();
  await $(
    ".transcript-user-message .attachment-pill-review .attachment-pill-trigger",
  ).waitForDisplayed({ timeout: TIMEOUT });
  await $(".transcript-user-message .attachment-pill-review .attachment-pill-trigger").click();
  await $(".attachment-detail-popover").waitForDisplayed({ timeout: TIMEOUT });
  assert.ok((await $(".attachment-detail-popover").getText()).includes(comment));
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
