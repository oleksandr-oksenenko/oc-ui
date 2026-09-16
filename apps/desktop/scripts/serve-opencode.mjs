import { spawn } from "node:child_process";

import { ensureOpenCodeServerBundle } from "./opencode-server-build.mjs";

const bundlePath = await ensureOpenCodeServerBundle();
const child = spawn(process.execPath, [bundlePath, ...process.argv.slice(2)], { stdio: "inherit" });
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
