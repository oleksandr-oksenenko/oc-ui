// @vitest-environment node
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { beforeAll, expect, it } from "vite-plus/test";
import { ensureOpenCodeServerBundle } from "../scripts/opencode-server-build.mjs";

// Cold bundle preparation owns the existing build-lock budget separately from
// the inspection process's 30-second readiness and 15-second shutdown windows.
beforeAll(() => ensureOpenCodeServerBundle(), 120_000);

const safeOutput = (output) =>
  output
    .replace(/("password":\s*")[^"]*(")/gu, "$1[redacted]$2")
    .replace(/^server password .*$/gmu, "server password [redacted]");

it.each([
  ["SIGINT", "ready"],
  ["SIGTERM", "ready"],
  ["SIGINT", "acquiring"],
  ["SIGTERM", "acquiring"],
])(
  "inspection cleans up after %s while %s",
  async (signal, boundary) => {
    const child = spawn(process.execPath, ["test/e2e/inspect-browser.mjs"], {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      stdio:
        boundary === "acquiring" ? ["ignore", "pipe", "pipe", "ipc"] : ["ignore", "pipe", "pipe"],
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
          timer = setTimeout(
            () => reject(new Error(`Startup timed out: ${safeOutput(output)}`)),
            30_000,
          );
          if (boundary === "acquiring") child.once("message", resolve);
          const read = (chunk) => {
            output = (output + chunk.toString()).slice(-16_384);
            const record = /\{\s*"status": "ready",[\s\S]*?\n\}/u.exec(output);
            if (record && boundary === "ready") resolve(JSON.parse(record[0]));
          };
          child.stdout.on("data", read);
          child.stderr.on("data", read);
        }),
        exited.then((code) => {
          throw new Error(`Exited before ${boundary} (${code}): ${safeOutput(output)}`);
        }),
      ]);
      clearTimeout(timer);
      child.kill(signal);
      if (boundary === "acquiring") {
        await expect.poll(() => output.includes('"phase":"stop","state":"requested"')).toBe(true);
        child.send({ release: true });
      }
      const code = await Promise.race([
        exited,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Shutdown timed out: ${safeOutput(output)}`)),
            15_000,
          );
        }),
      ]);
      expect(code, safeOutput(output)).toBe(0);
      expect(output).toContain("owned resources closed and disposable profile removed");
      await expect(access(ready.profile)).rejects.toMatchObject({ code: "ENOENT" });
      if (boundary === "ready") {
        for (const url of [ready.ui, `${ready.server}/api/health`]) {
          await expect(fetch(url, { signal: AbortSignal.timeout(1000) })).rejects.toThrow();
        }
      } else {
        expect(ready).toMatchObject({ status: "held", phase: "server" });
        expect(output).not.toContain('"status": "ready"');
        expect(output).toContain('"phase":"server","state":"complete"');
        expect(output).toContain('"phase":"close:server","state":"complete"');
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
