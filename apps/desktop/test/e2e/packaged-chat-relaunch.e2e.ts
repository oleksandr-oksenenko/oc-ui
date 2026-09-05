/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="@wdio/electron-service" />

import assert from "node:assert/strict";
import { $, browser } from "@wdio/globals";

import { withLocalOpenCodeClient } from "./support/local-opencode-client.ts";
import {
  quitAndWaitForOwnedWorkers,
  startBuiltInServer,
} from "./support/packaged-app-lifecycle.ts";
import {
  CHAT_PROMPT,
  CHAT_SENTINEL,
  chatRunConfig,
  readChatRunState,
} from "./support/chat-run-state.ts";

const STARTUP_TIMEOUT_MS = 45_000;
const CLEANUP_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 100;
const config = chatRunConfig();

describe("packaged chat relaunch", () => {
  it("reconnects and hydrates the one recorded API-seeded chat", async () => {
    const state = await readChatRunState(config.chatStatePath);
    assert.equal(state.fixtureDirectory, config.fixtureDirectory);

    const runtime = await browser.electron.execute((electron) => ({
      isPackaged: electron.app.isPackaged,
      userData: electron.app.getPath("userData"),
    }));
    assert.equal(runtime.isPackaged, true);
    assert.equal(runtime.userData, config.userDataPath);

    await startBuiltInServer(config.userDataPath, config.fixtureDirectory, STARTUP_TIMEOUT_MS);

    await withLocalOpenCodeClient(async (api) => {
      const recorded = await api.session.get({ sessionID: state.sessionID });
      assert.equal(recorded.title, state.sessionTitle);
      assert.equal(recorded.location.directory, config.fixtureDirectory);
      assert.equal(recorded.agent, config.agentID);
      assert.equal(recorded.model?.providerID, config.providerID);
      assert.equal(recorded.model?.id, config.modelID);
      assert.equal(recorded.model?.variant, config.variant);
      assert.equal(recorded.outcome, "succeeded");
      assert.equal(Number.isFinite(recorded.cost), true);
      assert.ok(recorded.cost >= 0 && recorded.cost <= config.acceptanceCostCeilingUSD);
      const catalog = await api.session.list({ directory: config.fixtureDirectory });
      assert.equal(catalog.data.length, 1, "the isolated session catalog must contain one session");
      assert.equal(catalog.data[0]?.id, state.sessionID);
      assert.equal(catalog.data[0]?.title, state.sessionTitle);

      const session = $(`button[aria-label='${state.sessionTitle}, Idle']`);
      await session.waitForClickable({ timeout: STARTUP_TIMEOUT_MS });
      await session.click();
      await browser.waitUntil(
        async () => {
          const selected = $("[aria-current='page']");
          if (!(await selected.isExisting())) return false;
          if ((await selected.getAttribute("aria-label")) !== `${state.sessionTitle}, Idle`) {
            return false;
          }
          return (
            (await transcriptMessageCount(".transcript-user-message")) === 1 &&
            (await transcriptMessageCount(".transcript-assistant-message")) === 1 &&
            (await messageIDCount(state.userMessageID)) === 1 &&
            (await messageIDCount(state.assistantMessageID)) === 1 &&
            (await messageText(state.userMessageID)) === CHAT_PROMPT &&
            (await messageText(state.assistantMessageID, ".transcript-markdown")) === CHAT_SENTINEL
          );
        },
        { timeout: STARTUP_TIMEOUT_MS, interval: POLL_INTERVAL_MS },
      );

      assert.equal(await transcriptMessageCount(".transcript-user-message"), 1);
      assert.equal(await transcriptMessageCount(".transcript-assistant-message"), 1);
      assert.equal(await messageIDCount(state.userMessageID), 1);
      assert.equal(await messageIDCount(state.assistantMessageID), 1);
      assert.equal(await messageText(state.userMessageID), CHAT_PROMPT);
      assert.equal(
        await messageText(state.assistantMessageID, ".transcript-markdown"),
        CHAT_SENTINEL,
      );
      const assistant = await findMessage(state.assistantMessageID);
      assert.equal(await assistant.getAttribute("data-state"), "complete");
      assert.equal(await transcriptMessageCount(".transcript-working"), 0);
      assert.equal(await transcriptMessageCount(".transcript-error-state"), 0);
      assert.equal(await transcriptMessageCount(".transcript-message-failure"), 0);
      assert.equal(await transcriptMessageCount(".transcript-pending-interaction"), 0);
      assert.equal(await transcriptMessageCount(".transcript-tool-call"), 0);
      const messages = await api.message.list({ sessionID: state.sessionID, order: "asc" });
      assert.equal(messages.data.length, 2, "the persisted transcript must contain two messages");
      assert.deepEqual(
        messages.data.map((message) => message.id),
        [state.userMessageID, state.assistantMessageID],
      );
      assert.equal(messages.data[0]?.type, "user");
      assert.equal(messages.data[0]?.text, CHAT_PROMPT);
      assert.equal(messages.data[1]?.type, "assistant");
      if (messages.data[1]?.type === "assistant") {
        const persistedAssistant = messages.data[1];
        assert.equal(
          persistedAssistant.content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join(""),
          CHAT_SENTINEL,
        );
        assert.equal(persistedAssistant.agent, config.agentID);
        assert.equal(persistedAssistant.model.providerID, config.providerID);
        assert.equal(persistedAssistant.model.id, config.modelID);
        assert.equal(persistedAssistant.model.variant, config.variant);
        assert.equal(persistedAssistant.finish, "stop");
        assert.equal(persistedAssistant.error, undefined);
        assert.equal(persistedAssistant.retry, undefined);
        assert.equal(persistedAssistant.time.completed !== undefined, true);
        assert.equal(
          persistedAssistant.content.some((part) => part.type === "tool"),
          false,
        );
      }
    });
  });

  after(async () => {
    await quitAndWaitForOwnedWorkers(config.userDataPath, CLEANUP_TIMEOUT_MS);
  });
});

async function findMessage(id: string) {
  const elements = await $(".transcript-view").$$("[data-message-id]").getElements();
  const matches = [];
  for (const element of elements) {
    if ((await element.getAttribute("data-message-id")) === id) matches.push(element);
  }
  assert.equal(matches.length, 1, `expected one message with id ${id}`);
  return matches[0];
}

async function messageIDCount(id: string): Promise<number> {
  const elements = await $(".transcript-view").$$("[data-message-id]").getElements();
  let count = 0;
  for (const element of elements) {
    if ((await element.getAttribute("data-message-id")) === id) count += 1;
  }
  return count;
}

async function transcriptMessageCount(selector: string): Promise<number> {
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
