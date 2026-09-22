/// <reference types="node" />
/// <reference types="@wdio/electron-service" />

import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { $, browser } from "@wdio/globals";

const POLL_INTERVAL_MS = 100;
const workerPids = new Set<number>();

export async function startBuiltInServer(
  userDataPath: string,
  fixtureDirectory: string,
  timeoutMs: number,
): Promise<void> {
  await browser.electron.execute(
    (_electron, directory) => process.chdir(directory),
    fixtureDirectory,
  );
  const heading = $("#connection-form-title");
  await heading.waitForDisplayed({ timeout: timeoutMs });
  assert.equal(await heading.getText(), "Connect to OpenCode");
  const start = $("button*=Start built-in server");
  await start.waitForClickable({ timeout: timeoutMs });
  await start.click();
  await browser.waitUntil(async () => (await recordOwnedWorkers(userDataPath)).length === 1, {
    timeout: timeoutMs,
    interval: POLL_INTERVAL_MS,
  });
  await $('[aria-label="Select server, Local server, Connected"]').waitForDisplayed({
    timeout: timeoutMs,
  });
}

async function recordOwnedWorkers(userDataPath: string): Promise<number[]> {
  const pids = await browser.electron.execute((electron) =>
    electron.app
      .getAppMetrics()
      .filter((metric) => metric.name === "Ocui built-in OpenCode")
      .map((metric) => metric.pid),
  );
  for (const pid of pids) {
    assert.ok(Number.isSafeInteger(pid) && pid > 0);
    workerPids.add(pid);
  }
  await writeFile(
    join(userDataPath, "acceptance-worker-pids.json"),
    JSON.stringify([...workerPids]),
  );
  return pids;
}

export async function quitAndWaitForOwnedWorkers(
  userDataPath: string,
  timeoutMs: number,
): Promise<void> {
  await recordOwnedWorkers(userDataPath);
  // Quit no longer asks. Mock native dialogs so a stop failure cannot block the run.
  const dialogs = await browser.electron.mock("dialog", "showMessageBox");
  await dialogs.mockResolvedValue({ response: 0, checkboxChecked: false });
  // Let the execute reply reach WDIO before the app closes its renderer.
  await browser.electron.execute((electron) => {
    setTimeout(() => electron.app.quit(), 0);
  });
  for (const pid of workerPids) {
    const deadline = Date.now() + timeoutMs;
    let exited = false;
    while (Date.now() < deadline) {
      try {
        globalThis.process.kill(pid, 0);
      } catch (cause) {
        if (!(cause instanceof Error && "code" in cause && cause.code === "ESRCH")) throw cause;
        exited = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    assert.equal(exited, true, `Owned OpenCode process ${pid} survived app quit`);
  }
}
