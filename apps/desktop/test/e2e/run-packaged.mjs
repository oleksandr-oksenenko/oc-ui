import { createProfile } from "./profile.mjs";
import { constants } from "node:fs";
import { access, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { startScriptedProvider } from "./scripted-provider.mjs";

const desktopRoot = fileURLToPath(new URL("../..", import.meta.url));
const appBundlePath = join(desktopRoot, "dist", "mac-arm64", "Ocui.app");
const appBinaryPath = join(appBundlePath, "Contents", "MacOS", "Ocui");
const runtimePath = join(appBundlePath, "Contents", "Resources", "opencode-runtime");
const execFileAsync = promisify(execFile);

const main = async () => {
  const mode = process.argv[2] ?? "startup";
  if (mode !== "startup" && mode !== "chat") {
    throw new Error("Packaged acceptance mode must be startup or chat");
  }
  if (mode === "chat" && !process.env.OPENCODE_API_KEY?.trim()) {
    throw new Error("Missing required chat environment variable OPENCODE_API_KEY");
  }
  const interruption = new AbortController();
  const interrupt = (signal) =>
    interruption.abort(new Error(`Packaged acceptance interrupted by ${signal}`));
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  let profile;
  const failures = [];
  try {
    await verifyPackagedApplication(interruption.signal);
    interruption.signal.throwIfAborted();
    profile = await createProfile("ocui-packaged-e2e-");
    const { root, paths, env } = profile;
    Object.assign(env, {
      pnpm_config_verify_deps_before_run: "false",
      OCUI_E2E_APP_BINARY_PATH: appBinaryPath,
      OCUI_E2E_USER_DATA_PATH: paths.app,
      OCUI_E2E_ARTIFACT_DIRECTORY: join(root, "artifacts"),
    });
    if (mode === "startup") {
      const provider = await startScriptedProvider();
      try {
        const project = join(paths.app, "acceptance-project");
        await mkdir(project, { recursive: true });
        await writeFile(join(project, "opencode.json"), JSON.stringify(provider.config));
        await runWdio(
          { ...env, OCUI_E2E_PROVIDER_URL: provider.url },
          "startup",
          interruption.signal,
        );
      } catch (cause) {
        failures.push(cause);
      } finally {
        await provider.close();
      }
    } else {
      const fixture = join(await realpath(root), "fixture-project");
      await mkdir(fixture, { recursive: true });
      const gitOptions = { env, signal: interruption.signal, timeout: 30_000 };
      await execFileAsync("git", ["init", "--quiet", "--initial-branch=main", fixture], gitOptions);
      await execFileAsync(
        "git",
        [
          "-C",
          fixture,
          "-c",
          "user.name=oc-ui-e2e",
          "-c",
          "user.email=oc-ui-e2e@invalid",
          "-c",
          "commit.gpgsign=false",
          "commit",
          "--quiet",
          "--allow-empty",
          "-m",
          "fixture",
        ],
        gitOptions,
      );
      await writeFile(
        join(fixture, "opencode.json"),
        JSON.stringify({
          providers: {
            "opencode-go": {
              models: {
                "deepseek-v4-flash": {
                  variants: [{ id: "low", settings: { reasoningEffort: "low" } }],
                },
              },
            },
          },
        }),
      );
      Object.assign(env, {
        OPENCODE_API_KEY: process.env.OPENCODE_API_KEY,
        OCUI_E2E_CHAT_STATE_PATH: join(root, "chat-state.json"),
        OCUI_E2E_FIXTURE_DIRECTORY: fixture,
        OCUI_E2E_CHAT_PROVIDER_ID: "opencode-go",
        OCUI_E2E_CHAT_MODEL_ID: "deepseek-v4-flash",
        OCUI_E2E_CHAT_VARIANT: "low",
        OCUI_E2E_CHAT_AGENT_ID: "build",
        // The spec checks reported cost after completion; this is not a provider spending limit.
        OCUI_E2E_CHAT_COST_CEILING_USD: "0.01",
      });
      await runWdio(env, "chat-create", interruption.signal);
      await assertWorkersStopped(paths.app);
      await runWdio(env, "chat-relaunch", interruption.signal);
    }
  } catch (cause) {
    failures.push(cause);
  } finally {
    if (profile !== undefined) {
      try {
        await assertWorkersStopped(profile.paths.app);
      } catch (cause) {
        failures.push(cause);
      }
      if (interruption.signal.aborted && !failures.includes(interruption.signal.reason)) {
        failures.push(interruption.signal.reason);
      }
      if (failures.length === 0) {
        try {
          await rm(profile.root, { recursive: true, force: true });
        } catch (cause) {
          failures.push(cause);
        }
      }
      if (failures.length > 0) {
        console.error(
          `Acceptance failed; disposable profile and artifacts preserved at ${profile.root}`,
        );
      }
    }
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "Packaged acceptance failed");
};

const verifyPackagedApplication = async (signal) => {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error("Packaged acceptance requires macOS arm64");
  }
  const ptyPath = join(
    runtimePath,
    "node_modules",
    "@opencode-ai",
    "pty-darwin-arm64",
    "bin",
    "opencode-pty",
  );
  await Promise.all([
    access(appBinaryPath, constants.X_OK),
    access(join(runtimePath, "opencode-worker.mjs")),
    access(ptyPath, constants.X_OK),
  ]);
  await execFileAsync("codesign", ["--verify", "--deep", "--strict", appBundlePath], {
    signal,
    timeout: 60_000,
  });
  await Promise.all([assertArm64(appBinaryPath, signal), assertArm64(ptyPath, signal)]);
};

const assertArm64 = async (path, signal) => {
  const { stdout } = await execFileAsync("lipo", ["-archs", path], { signal, timeout: 30_000 });
  if (!stdout.trim().split(/\s+/u).includes("arm64")) {
    throw new Error(`Expected an arm64 executable at ${path}`);
  }
};

const assertWorkersStopped = async (appPath) => {
  // Only inspect PIDs observed through this app's own utility-process metrics.
  let pids;
  try {
    pids = JSON.parse(await readFile(join(appPath, "acceptance-worker-pids.json"), "utf8"));
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return;
    throw cause;
  }
  if (!Array.isArray(pids) || pids.some((pid) => !Number.isSafeInteger(pid) || pid <= 0)) {
    throw new Error("Invalid acceptance worker PID record");
  }
  if (pids.some(isAlive)) throw new Error("An acceptance worker is still alive");
};

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ESRCH") return false;
    throw cause;
  }
};

const runWdio = async (env, phase, signal) => {
  signal.throwIfAborted();
  const child = spawn(
    "pnpm",
    ["run", "test:acceptance:mac:wdio", "--spec", `test/e2e/packaged-${phase}.e2e.ts`],
    {
      cwd: desktopRoot,
      detached: true,
      env: {
        ...env,
        OCUI_E2E_ARTIFACT_NAME: `packaged-${phase}-failure`,
        OCUI_E2E_MOCHA_TIMEOUT_MS: phase === "chat-create" ? "180000" : "120000",
      },
      stdio: "inherit",
    },
  );
  const exited = new Promise((resolve) => {
    child.once("error", (cause) => resolve(new Error("Packaged WDIO could not start", { cause })));
    child.once("exit", (code, exitSignal) =>
      resolve(
        code === 0
          ? undefined
          : new Error(`Packaged WDIO run failed: ${exitSignal ?? code ?? "unknown"}`),
      ),
    );
  });
  let timeout;
  let onAbort;
  const stopped = new Promise((resolve) => {
    timeout = setTimeout(
      () => resolve(new Error("Packaged WDIO watchdog expired")),
      phase === "startup" ? 720_000 : 240_000,
    );
    onAbort = () => resolve(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  const failure = await Promise.race([exited, stopped]);
  clearTimeout(timeout);
  // Keep handling parent interruption throughout bounded group cleanup.
  try {
    if (child.pid !== undefined && isAlive(-child.pid)) {
      for (const stopSignal of ["SIGTERM", "SIGKILL"]) {
        try {
          process.kill(-child.pid, stopSignal);
        } catch (cause) {
          if (!(cause instanceof Error && "code" in cause && cause.code === "ESRCH")) throw cause;
        }
        const deadline = Date.now() + 15_000;
        while (isAlive(-child.pid) && Date.now() < deadline) await delay(100);
        if (!isAlive(-child.pid)) break;
      }
      if (isAlive(-child.pid)) throw new Error("Packaged WDIO process group did not stop");
    }
  } catch (cause) {
    child.unref();
    throw failure === undefined
      ? cause
      : new AggregateError([failure, cause], "WDIO run and cleanup failed");
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
  if (failure !== undefined) throw failure;
  signal.throwIfAborted();
};

void main().catch((cause) => {
  process.exitCode = 1;
  console.error(cause);
});
