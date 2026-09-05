import { constants } from "node:fs";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { startScriptedProvider } from "./scripted-provider.mjs";

const desktopRoot = fileURLToPath(new URL("../..", import.meta.url));
const appBundlePath = join(desktopRoot, "dist", "mac-arm64", "Ocui.app");
const appBinaryPath = join(appBundlePath, "Contents", "MacOS", "Ocui");
const runtimePath = join(appBundlePath, "Contents", "Resources", "opencode-runtime");
const execFileAsync = promisify(execFile);

const main = async () => {
  await verifyPackagedApplication();
  const profile = await mkdtemp(join(tmpdir(), "ocui-packaged-e2e-"));
  const paths = Object.fromEntries(
    ["home", "data", "state", "cache", "config", "tmp", "app"].map((name) => [
      name,
      join(profile, name),
    ]),
  );
  await Promise.all(Object.values(paths).map((path) => mkdir(path, { recursive: true })));
  const provider = await startScriptedProvider();
  let runnerError;
  try {
    const project = join(paths.app, "acceptance-project");
    await mkdir(project, { recursive: true });
    await writeFile(join(project, "opencode.json"), JSON.stringify(provider.config));
    await runWdio(paths, provider.url);
  } catch (cause) {
    runnerError = cause;
  } finally {
    await provider.close();
  }

  // Tests record only PIDs observed through this app's own utility-process metrics.
  // Never delete a profile while a recorded worker might still be using it.
  let pids = [];
  try {
    pids = JSON.parse(await readFile(join(paths.app, "acceptance-worker-pids.json"), "utf8"));
  } catch (cause) {
    if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) throw cause;
  }
  if (pids.some(isAlive)) {
    throw new Error(
      `An acceptance worker is still alive; disposable profile preserved at ${profile}`,
      {
        cause: runnerError,
      },
    );
  }
  if (runnerError !== undefined) {
    console.error(`Acceptance failed; disposable profile preserved at ${profile}`);
    throw runnerError;
  }
  await rm(profile, { recursive: true, force: true });
};

const verifyPackagedApplication = async () => {
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
  await execFileAsync("codesign", ["--verify", "--deep", "--strict", appBundlePath]);
  await Promise.all([assertArm64(appBinaryPath), assertArm64(ptyPath)]);
};

const assertArm64 = async (path) => {
  const { stdout } = await execFileAsync("lipo", ["-archs", path]);
  if (!stdout.trim().split(/\s+/u).includes("arm64")) {
    throw new Error(`Expected an arm64 executable at ${path}`);
  }
};

const isAlive = (pid) => {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Invalid acceptance worker PID");
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ESRCH") return false;
    throw cause;
  }
};

const runWdio = (paths, providerUrl) =>
  new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["run", "test:acceptance:mac:wdio"], {
      cwd: desktopRoot,
      // No provider keys, normal home files, sessions, or auth state enter this test.
      env: {
        PATH: process.env.PATH,
        HOME: paths.home,
        TMPDIR: paths.tmp,
        SHELL: "/bin/zsh",
        XDG_DATA_HOME: paths.data,
        XDG_STATE_HOME: paths.state,
        XDG_CACHE_HOME: paths.cache,
        XDG_CONFIG_HOME: paths.config,
        OPENCODE_DB: join(paths.data, "acceptance.db"),
        pnpm_config_verify_deps_before_run: "false",
        OCUI_E2E_APP_BINARY_PATH: appBinaryPath,
        OCUI_E2E_USER_DATA_PATH: paths.app,
        OCUI_E2E_PROVIDER_URL: providerUrl,
      },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Packaged WDIO run failed: ${signal ?? code ?? "unknown"}`));
    });
  });

void main().catch((cause) => {
  process.exitCode = 1;
  console.error(cause instanceof Error ? cause.message : "Packaged WDIO run failed");
});
