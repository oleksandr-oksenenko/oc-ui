import assert from "node:assert/strict";
import { realpath, readFile } from "node:fs/promises";
import { join } from "node:path";
import { OpenCode } from "@opencode/client";
import { $, browser } from "@wdio/globals";

import { git } from "./project-fixture.ts";

export async function verifyOpenCodeTools(project: string): Promise<void> {
  const connection = await browser.execute(async () => {
    const result = await window.desktop.localOpenCode.connect();
    if (result.status !== "connected") throw new Error(result.message);
    return result.connection;
  });
  const api = OpenCode.make({
    baseUrl: connection.serverUrl,
    headers: {
      Authorization: `Basic ${Buffer.from(`opencode:${connection.password}`).toString("base64")}`,
    },
  });
  const directory = await realpath(project);
  const plugins = await api.plugin.list({ location: { directory } });
  assert.ok(
    plugins.data.some((plugin) => plugin.id === "oc-ui.tools" && plugin.state.status === "active"),
    JSON.stringify(plugins.data.filter((plugin) => plugin.source.type !== "builtin")),
  );
  assert.ok(
    plugins.data.some(
      (plugin) => plugin.id === "oc-ui.image-tools" && plugin.state.status === "active",
    ),
  );
  const caller = await api.session.create({
    title: "Packaged session tool caller",
    location: { directory },
    agent: "build",
    model: { providerID: "acceptance", id: "stream", variant: "high" },
  });
  await $(".shell-session-main*=Packaged session tool caller").waitForClickable({
    timeout: 30_000,
  });
  await $(".shell-session-main*=Packaged session tool caller").click();
  await $('[aria-label="Prompt"]').setValue("E2E_CREATE_SESSION packaged");
  await $('button[aria-label="Send"]').click();
  await browser.waitUntil(
    async () => (await $(".transcript-view").getText()).includes("Acceptance session created:"),
    { timeout: 30_000 },
  );
  await browser.waitUntil(
    async () =>
      (await api.session.list({ limit: 100 })).data.some(
        (session) =>
          session.title === "Independent acceptance task" && session.outcome === "succeeded",
      ),
    { timeout: 30_000 },
  );
  const created = (await api.session.list({ limit: 100 })).data.find(
    (session) => session.title === "Independent acceptance task",
  );
  assert.ok(created);
  assert.equal(created.parentID, undefined);
  assert.equal(created.projectID, caller.projectID);
  assert.notEqual(created.location.directory, caller.location.directory);
  assert.equal(created.agent, caller.agent);
  assert.deepEqual(created.model, caller.model);
  assert.equal(
    await git(created.location.directory, "rev-parse", "HEAD"),
    await git(directory, "rev-parse", "HEAD"),
  );
  assert.equal(
    await readFile(join(created.location.directory, "working.txt"), "utf8"),
    "Original working content\n",
  );
  await $(".shell-session-main*=Independent acceptance task").click();
  await browser.waitUntil(
    async () =>
      (await $(".transcript-view").getText()).includes("Acceptance completed with stream."),
    { timeout: 30_000 },
  );
  assert.equal(
    (await $(".transcript-view").getText()).includes("E2E_CREATE_SESSION packaged"),
    false,
  );
  // Exercise the public plugin operations inside the packaged worker, using the
  // independent worktree session so deletion also proves its files are retained.
  await $(".shell-session-main*=Packaged session tool caller").click();
  await $('[aria-label="Prompt"]').setValue(`E2E_SESSION_NATIVE ${created.id}`);
  await $('button[aria-label="Send"]').click();
  await browser.waitUntil(
    async () => (await $(".transcript-view").getText()).includes("native-session-management"),
    { timeout: 30_000 },
  );
  const execution = (await api.message.list({ sessionID: caller.id })).data
    .filter((message) => message.type === "assistant")
    .flatMap((message) => message.content)
    .find(
      (part) =>
        part.type === "tool" &&
        part.name === "execute" &&
        part.state.status === "completed" &&
        part.state.content.some(
          (content) =>
            content.type === "text" && content.text.includes("native-session-management"),
        ),
    );
  assert.ok(execution?.type === "tool" && execution.state.status === "completed");
  const text = execution.state.content.find((content) => content.type === "text");
  assert.ok(text?.type === "text");
  const result = JSON.parse(text.text);
  assert.equal(result.admission.accepted, true);
  assert.equal(result.settled.settled, true);
  assert.equal(result.settled.session.outcome, "succeeded");
  assert.equal(result.interrupted.interrupted, false);
  assert.deepEqual(result.deleted, { sessionID: created.id, deleted: true });
  await assert.rejects(api.session.get({ sessionID: created.id }));
  assert.equal(
    await readFile(join(created.location.directory, "working.txt"), "utf8"),
    "Original working content\n",
  );
}
