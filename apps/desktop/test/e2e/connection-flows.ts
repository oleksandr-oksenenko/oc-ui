import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { $, browser } from "@wdio/globals";

export async function verifyConnectionSettings(settingsPath: string): Promise<void> {
  const local = await browser.execute(() => window.desktop.localOpenCode.connect());
  if (local.status !== "connected") throw new Error(local.message);
  await $(".shell-server-selector").click();
  await $("#connection-form-title").waitForDisplayed();
  await $("span=Remote").click();
  const url = 'input[placeholder="http://homie:4096"]';
  const password = 'input[placeholder="Optional server password"]';
  await $(url).setValue("ftp://127.0.0.1:4096");
  await $(".connection-form-submit").click();
  await $(".connection-form-error").waitForDisplayed();
  assert.match(await $(".connection-form-error").getText(), /HTTP or HTTPS/u);
  await $(url).setValue(local.connection.serverUrl);
  await $(password).setValue("incorrect-acceptance-password");
  await $(".connection-form-submit").click();
  await browser.waitUntil(async () =>
    (await $(".connection-form-error").getText()).includes("rejected the password"),
  );
  await $(password).setValue(local.connection.password);
  await $(".connection-form-submit").click();
  await $('.shell-server-selector[aria-label$=", Connected"]').waitForDisplayed({
    timeout: 45_000,
  });
  await browser.waitUntil(
    async () => JSON.parse(await readFile(settingsPath, "utf8")).kind === "remote",
  );
  const contents = await readFile(settingsPath, "utf8");
  assert.equal(contents.includes(local.connection.password), false);
  assert.match(JSON.parse(contents).encryptedPassword, /^[A-Za-z0-9+/]+=*$/u);
  assert.equal(
    await browser.execute(async () => {
      const saved = await window.desktop.target.load();
      const running = await window.desktop.localOpenCode.connect();
      return (
        saved?.kind === "remote" &&
        running.status === "connected" &&
        saved.password === running.connection.password
      );
    }),
    true,
  );

  // Saved remote credentials reconnect through the real preload, storage, and SDK boundaries.
  await browser.refresh();
  await $('.shell-server-selector[aria-label$=", Connected"]').waitForDisplayed({
    timeout: 45_000,
  });
  await $(".shell-server-selector").click();
  await $("button=Forget saved choice").waitForClickable();
  await $("button=Forget saved choice").click();
  await browser.waitUntil(async () => !(await $("button=Forget saved choice").isExisting()));
  await assert.rejects(access(settingsPath), { code: "ENOENT" });
  await $("button*=Start built-in server").click();
  await $('[aria-label="Select server, Local server, Connected"]').waitForDisplayed({
    timeout: 45_000,
  });
}
