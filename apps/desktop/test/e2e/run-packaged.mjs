import { constants } from "node:fs";
import { access, mkdtemp, rm } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Service as OpenCodeService } from "@opencode-ai/client/service";

const desktopRoot = fileURLToPath(new URL("../..", import.meta.url));
const appBundlePath = join(desktopRoot, "dist", "mac-arm64", "Ocui.app");
const appBinaryPath = join(appBundlePath, "Contents", "MacOS", "Ocui");
const sidecarPath = join(appBundlePath, "Contents", "Resources", "opencode", "opencode2");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const execFileAsync = promisify(execFile);

const main = async () => {
  await verifyPackagedApplication();
  const userDataPath = await mkdtemp(join(tmpdir(), "ocui-packaged-e2e-"));
  let runnerError;

  try {
    await runWdio(userDataPath, appBinaryPath);
  } catch (cause) {
    runnerError = cause;
  }

  let cleanupError;
  let preserveUserData = false;
  const registrationFile = join(userDataPath, "opencode", "service.json");
  try {
    if (await pathExists(registrationFile)) {
      try {
        await OpenCodeService.stop({ file: registrationFile });
      } catch (cause) {
        preserveUserData = true;
        cleanupError = new Error(`Failed to stop OpenCode; profile preserved at ${userDataPath}`, {
          cause,
        });
      }
      if (!preserveUserData && (await pathExists(registrationFile))) {
        preserveUserData = true;
        cleanupError = new Error(
          `OpenCode registration remained after stop; profile preserved at ${userDataPath}`,
        );
      } else if (!preserveUserData && runnerError === undefined) {
        cleanupError = new Error("OpenCode service registration remained after a successful run");
      }
    }
  } catch (cause) {
    preserveUserData = true;
    cleanupError = new Error(
      `Failed to inspect OpenCode cleanup; profile preserved at ${userDataPath}`,
      { cause },
    );
  }

  if (!preserveUserData) {
    try {
      await rm(userDataPath, { recursive: true, force: true });
    } catch (cause) {
      cleanupError = cause;
    }
  }

  if (runnerError !== undefined && cleanupError !== undefined) {
    throw new AggregateError([runnerError, cleanupError], "Packaged acceptance and cleanup failed");
  }
  if (runnerError !== undefined) throw runnerError;
  if (cleanupError !== undefined) throw cleanupError;
};

const verifyPackagedApplication = async () => {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error("Packaged acceptance requires macOS arm64");
  }

  await Promise.all([access(appBinaryPath, constants.X_OK), access(sidecarPath, constants.X_OK)]);
  await execFileAsync("codesign", ["--verify", "--deep", "--strict", appBundlePath]);
  await Promise.all([assertArm64(appBinaryPath), assertArm64(sidecarPath)]);
};

const assertArm64 = async (path) => {
  const { stdout } = await execFileAsync("lipo", ["-archs", path]);
  if (!stdout.trim().split(/\s+/u).includes("arm64")) {
    throw new Error(`Expected an arm64 executable at ${path}`);
  }
};

const pathExists = async (path) => {
  try {
    await access(path);
    return true;
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return false;
    throw cause;
  }
};

const runWdio = (userDataPath, packagedAppBinaryPath) =>
  new Promise((resolve, reject) => {
    const child = spawn(pnpmCommand, ["run", "test:acceptance:mac:wdio"], {
      cwd: desktopRoot,
      env: {
        ...process.env,
        OCUI_E2E_APP_BINARY_PATH: packagedAppBinaryPath,
        OCUI_E2E_USER_DATA_PATH: userDataPath,
      },
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          signal === null
            ? `Packaged WDIO run failed with exit code ${code ?? "unknown"}`
            : `Packaged WDIO run ended with signal ${signal}`,
        ),
      );
    });
  });

void main().catch((cause) => {
  process.exitCode = 1;
  if (cause instanceof AggregateError) {
    console.error(cause.message);
    for (const failure of cause.errors) {
      console.error(failure instanceof Error ? failure.message : "Unknown failure");
    }
    return;
  }
  if (cause instanceof Error) {
    console.error(cause.message);
  } else {
    console.error("Packaged WDIO run failed");
  }
});
