// @vitest-environment node
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";

it.each(["SIGINT", "SIGTERM"])(
  "inspection cleans up after %s",
  async (signal) => {
    const child = spawn(process.execPath, ["test/e2e/inspect-browser.mjs"], {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let output = "";
    const exited = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code));
    });
    let timer;
    try {
      const ready = await Promise.race([
        new Promise((resolve, reject) => {
          timer = setTimeout(() => reject(new Error(`Startup timed out: ${output}`)), 30_000);
          const read = (chunk) => {
            output = (output + chunk.toString()).slice(-16_384);
            const record = /\{\s*"status": "ready",[\s\S]*?\n\}/u.exec(output);
            if (record) resolve(JSON.parse(record[0]));
          };
          child.stdout.on("data", read);
          child.stderr.on("data", read);
        }),
        exited.then((code) => {
          throw new Error(`Exited before ready (${code}): ${output}`);
        }),
      ]);
      clearTimeout(timer);
      child.kill(signal);
      const code = await Promise.race([
        exited,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Shutdown timed out: ${output}`)), 15_000);
        }),
      ]);
      expect(code, output).toBe(0);
      expect(output).toContain("owned resources closed and disposable profile removed");
      await expect(access(ready.profile)).rejects.toMatchObject({ code: "ENOENT" });
      for (const url of [ready.ui, `${ready.server}/api/health`]) {
        await expect(fetch(url, { signal: AbortSignal.timeout(1000) })).rejects.toThrow();
      }
    } finally {
      clearTimeout(timer);
      if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
        if (process.platform === "win32") child.kill("SIGKILL");
        else process.kill(-child.pid, "SIGKILL");
        await exited;
      }
    }
  },
  50_000,
);
