/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="@wdio/electron-service" />

import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { $, browser } from "@wdio/globals";
import type { OpenCodeClient, SessionMessageAssistant, SessionMessageInfo } from "@opencode/client";

import { OPENCODE_VERSION } from "../../src/shared/desktop-api.ts";
import { withLocalOpenCodeClient } from "./support/local-opencode-client.ts";
import {
  quitAndWaitForOwnedWorkers,
  startBuiltInServer,
} from "./support/packaged-app-lifecycle.ts";
import {
  CHAT_PROMPT,
  CHAT_SENTINEL,
  chatRunConfig,
  writeChatRunState,
} from "./support/chat-run-state.ts";

const STARTUP_TIMEOUT_MS = 45_000;
const CHAT_TIMEOUT_MS = 90_000;
const CLEANUP_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 100;
const SESSION_TITLE_PREFIX = "OCUI E2E Chat";

const config = chatRunConfig();

describe("packaged chat create", () => {
  it("API-seeds one isolated session and completes its chat through the UI", async () => {
    await assertPackagedRuntime();
    await assertDirectory(config.fixtureDirectory);

    await startBuiltInServer(config.userDataPath, config.fixtureDirectory, STARTUP_TIMEOUT_MS);
    await withLocalOpenCodeClient(async (api) => {
      const health = await api.health.get();
      assert.equal(health.version, OPENCODE_VERSION);
      const fixtureLocation = { directory: config.fixtureDirectory };

      let models: Awaited<ReturnType<typeof api.model.list>>;
      await browser.waitUntil(
        async () => {
          models = await api.model.list({ location: fixtureLocation });
          return models.data.some(
            (model) => model.providerID === config.providerID && model.id === config.modelID,
          );
        },
        {
          timeout: STARTUP_TIMEOUT_MS,
          interval: 500,
          timeoutMsg: "Configured chat model did not become available",
        },
      );
      const matchingModels = models!.data.filter(
        (model) => model.providerID === config.providerID && model.id === config.modelID,
      );
      assert.equal(matchingModels.length, 1, "configured model must exist exactly once");
      const model = matchingModels[0];
      assert.equal(model.enabled, true, "configured model must be enabled");
      const variant = config.variant
        ? model.variants.find((candidate) => candidate.id === config.variant)
        : undefined;
      if (config.variant) assert.ok(variant, "configured variant must exist");

      let visibleAgents: Awaited<ReturnType<typeof api.agent.list>>["data"] = [];
      await browser.waitUntil(
        async () => {
          const agents = await api.agent.list({ location: fixtureLocation });
          visibleAgents = agents.data.filter((agent) => !agent.hidden && agent.mode !== "subagent");
          return visibleAgents.some((agent) => agent.id === config.agentID);
        },
        { timeout: STARTUP_TIMEOUT_MS, interval: POLL_INTERVAL_MS },
      );
      const matchingAgents = visibleAgents.filter((agent) => agent.id === config.agentID);
      assert.equal(
        matchingAgents.length,
        1,
        `configured agent must be visible exactly once; available IDs: ${visibleAgents.map((agent) => agent.id).join(", ")}`,
      );

      const before = await api.session.list({ directory: config.fixtureDirectory });
      const beforeIDs = new Set(before.data.map((session) => session.id));
      const project = await api.project.current({ location: fixtureLocation });
      assert.equal(project.directory, config.fixtureDirectory);
      const sessionTitle = `${SESSION_TITLE_PREFIX} ${basename(dirname(config.fixtureDirectory))}`;
      const requestedModel =
        config.variant === undefined
          ? { providerID: config.providerID, id: config.modelID }
          : { providerID: config.providerID, id: config.modelID, variant: config.variant };
      const created = await api.session.create({
        title: sessionTitle,
        agent: config.agentID,
        model: requestedModel,
        location: fixtureLocation,
      });
      assert.equal(beforeIDs.has(created.id), false);
      assert.equal(created.title, sessionTitle);
      assert.equal(created.location.directory, config.fixtureDirectory);
      assert.equal(created.agent, config.agentID);
      assert.equal(created.model?.providerID, config.providerID);
      assert.equal(created.model?.id, config.modelID);
      assert.equal(created.model?.variant, config.variant);
      assert.equal(created.cost, 0);
      const sessionID = created.id;

      const session = $(`button[aria-label='${sessionTitle}, Idle']`);
      await session.waitForClickable({ timeout: STARTUP_TIMEOUT_MS });
      await session.click();
      await browser.waitUntil(async () => (await session.getAttribute("aria-current")) === "page", {
        timeout: STARTUP_TIMEOUT_MS,
        interval: POLL_INTERVAL_MS,
      });
      await $(".transcript-empty-state").waitForDisplayed({ timeout: STARTUP_TIMEOUT_MS });

      let messageIDs: Awaited<ReturnType<typeof waitForChatMessageIDs>>;
      try {
        const prompt = $("[aria-label=Prompt]");
        await prompt.setValue(CHAT_PROMPT.split("\n")[0]);
        await browser.keys(["Shift", "Enter"]);
        await prompt.addValue(CHAT_PROMPT.split("\n")[1]);
        assert.equal(await prompt.getText(), CHAT_PROMPT);
        await $("button[aria-label=Send]").waitForClickable({ timeout: STARTUP_TIMEOUT_MS });
        await $("button[aria-label=Send]").click();
        await browser.waitUntil(async () => (await prompt.getText()) === "", {
          timeout: STARTUP_TIMEOUT_MS,
          interval: POLL_INTERVAL_MS,
        });
        messageIDs = await waitForChatMessageIDs(api, sessionID);
        await browser.waitUntil(
          async () => {
            if ((await transcriptElementCount(".transcript-tool-call")) > 0) {
              throw new Error("The configured acceptance agent used a tool despite the prompt");
            }
            const assistant = await findTranscriptMessage(messageIDs.assistantMessageID);
            if (assistant === undefined) return false;
            if ((await assistant.getAttribute("data-state")) !== "complete") return false;
            return (
              (await messageText(messageIDs.assistantMessageID, ".transcript-markdown")) ===
              CHAT_SENTINEL
            );
          },
          { timeout: CHAT_TIMEOUT_MS, interval: POLL_INTERVAL_MS },
        );
      } catch (cause) {
        await stopAndInterrupt(api, sessionID);
        throw cause;
      }

      assert.equal(await transcriptElementCount(".transcript-user-message"), 1);
      assert.equal(await messageText(messageIDs.userMessageID), CHAT_PROMPT);
      assert.equal(await transcriptElementCount(".transcript-assistant-message[data-state]"), 1);
      await assertNoChatFailures();
      await assertIdleAndComposerReady(sessionTitle);

      const messages = await api.message.list({ sessionID, order: "asc" });
      assert.equal(
        messages.data.length,
        2,
        "API must contain exactly one user and assistant message",
      );
      const [user, assistant] = messages.data;
      assert.equal(user?.id, messageIDs.userMessageID);
      assert.equal(assistant?.id, messageIDs.assistantMessageID);
      assert.equal(user?.type, "user");
      assert.equal(user?.text, CHAT_PROMPT);
      assert.ok(assistant && isMatchingAssistant(assistant));
      assert.equal(assistant.agent, config.agentID);
      assert.equal(assistant.model.providerID, config.providerID);
      assert.equal(assistant.model.id, config.modelID);
      assert.equal(assistant.model.variant, config.variant);
      assert.equal(assistant.finish, "stop");
      assert.equal(assistant.error, undefined);
      assert.equal(assistant.retry, undefined);
      assert.equal(
        assistant.content.some((part) => part.type === "tool"),
        false,
      );
      assert.equal(Number.isFinite(assistant.time.completed), true);
      const finished = await api.session.get({ sessionID });
      assert.equal(finished.outcome, "succeeded");
      assert.equal(Number.isFinite(finished.cost), true);
      assert.ok(finished.cost >= 0);
      assert.ok(finished.cost <= config.acceptanceCostCeilingUSD);
      console.log(`Packaged chat cost: $${finished.cost.toFixed(6)}`);

      await writeChatRunState(config.chatStatePath, {
        sessionTitle,
        sessionID,
        userMessageID: user.id,
        assistantMessageID: assistant.id,
        fixtureDirectory: config.fixtureDirectory,
      });
    });
  });

  after(async () => {
    await quitAndWaitForOwnedWorkers(config.userDataPath, CLEANUP_TIMEOUT_MS);
  });
});

async function assertPackagedRuntime(): Promise<void> {
  const runtime = await browser.electron.execute((electron) => ({
    isPackaged: electron.app.isPackaged,
    userData: electron.app.getPath("userData"),
  }));
  assert.equal(runtime.isPackaged, true);
  assert.equal(runtime.userData, config.userDataPath);
}

async function assertDirectory(path: string): Promise<void> {
  const details = await stat(path);
  assert.equal(details.isDirectory(), true);
}

async function waitForChatMessageIDs(
  api: OpenCodeClient,
  sessionID: string,
): Promise<{ readonly userMessageID: string; readonly assistantMessageID: string }> {
  let userMessageID: string | undefined;
  let assistantMessageID: string | undefined;
  await browser.waitUntil(
    async () => {
      const messages = await api.message.list({ sessionID, order: "asc" });
      userMessageID ??= messages.data.find(
        (message) => message.type === "user" && message.text === CHAT_PROMPT,
      )?.id;
      assistantMessageID ??= messages.data.find((message) => message.type === "assistant")?.id;
      return userMessageID !== undefined && assistantMessageID !== undefined;
    },
    { timeout: STARTUP_TIMEOUT_MS, interval: POLL_INTERVAL_MS },
  );
  assert.ok(userMessageID);
  assert.ok(assistantMessageID);
  return { userMessageID, assistantMessageID };
}

function isMatchingAssistant(message: SessionMessageInfo): message is SessionMessageAssistant {
  return (
    message.type === "assistant" &&
    message.time.completed !== undefined &&
    message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("") === CHAT_SENTINEL
  );
}

async function stopAndInterrupt(api: OpenCodeClient, sessionID: string): Promise<void> {
  const stop = $("button[aria-label=Stop]");
  if (await stop.isExisting().catch(() => false)) {
    await stop.click().catch(() => undefined);
    await browser
      .waitUntil(async () => !(await stop.isExisting()), {
        timeout: 5_000,
        interval: POLL_INTERVAL_MS,
      })
      .catch(() => undefined);
  }
  await api.session
    .interrupt({ sessionID }, { signal: AbortSignal.timeout(5_000) })
    .catch(() => undefined);
}

async function assertNoChatFailures(): Promise<void> {
  assert.equal(await transcriptElementCount("[role=alert]"), 0);
}

async function assertIdleAndComposerReady(sessionTitle: string): Promise<void> {
  const selected = $("[aria-current=page]");
  await browser.waitUntil(
    async () => (await selected.getAttribute("aria-label")) === `${sessionTitle}, Idle`,
    { timeout: STARTUP_TIMEOUT_MS, interval: POLL_INTERVAL_MS },
  );
  assert.equal(await transcriptElementCount(".transcript-pending-interaction"), 0);
  assert.equal(await transcriptElementCount(".transcript-tool-call"), 0);
  assert.equal(await transcriptElementCount(".transcript-message-failure"), 0);
  const prompt = $("[aria-label=Prompt]");
  assert.equal(await prompt.getText(), "");
  await prompt.setValue("Unsent composer readiness check");
  try {
    await $("button[aria-label=Send]").waitForClickable({ timeout: STARTUP_TIMEOUT_MS });
  } finally {
    await prompt.clearValue();
  }
  assert.equal(await prompt.getText(), "");
}

async function findTranscriptMessage(id: string) {
  const elements = await $(".transcript-view").$$("[data-message-id]").getElements();
  for (const element of elements) {
    if ((await element.getAttribute("data-message-id")) === id) return element;
  }
  return undefined;
}

async function transcriptElementCount(selector: string): Promise<number> {
  return (await $(".transcript-view").$$(selector).getElements()).length;
}

async function messageText(id: string, childSelector?: string): Promise<string> {
  return await browser.execute(
    (messageID, child) => {
      const transcript = document.querySelector(".transcript-view");
      const message = [
        ...(transcript?.querySelectorAll<HTMLElement>("[data-message-id]") ?? []),
      ].find((element) => element.dataset.messageId === messageID);
      if (!message) return "";
      return child
        ? (message.querySelector<HTMLElement>(child)?.textContent ?? "")
        : (message.textContent ?? "");
    },
    id,
    childSelector,
  );
}
