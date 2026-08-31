import { chmodSync, copyFileSync, mkdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repositoryDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktopDirectory = join(repositoryDirectory, "apps", "desktop");
const sharedApiPath = join(desktopDirectory, "src", "shared", "desktop-api.ts");
const cliPackageJsonPath = join(
  desktopDirectory,
  "node_modules",
  "@opencode-ai",
  "cli",
  "package.json",
);
const stagingDirectory = join(desktopDirectory, ".packaging", "opencode");
const stagedBinaryPath = join(stagingDirectory, "opencode2");

const fail = (message) => {
  throw new Error(`OpenCode packaging validation failed: ${message}`);
};

if (process.platform !== "darwin" || process.arch !== "arm64") {
  fail("packaging is supported only on macOS arm64");
}

const sharedApi = readFileSync(sharedApiPath, "utf8");
const expectedVersionMatch = sharedApi.match(/export const OPENCODE_VERSION = ["']([^"']+)["']/);
if (expectedVersionMatch === null) {
  fail(`could not read OPENCODE_VERSION from ${sharedApiPath}`);
}
const expectedVersion = expectedVersionMatch[1];

let cliPackageJson;
let cliPackageDirectory;
try {
  cliPackageDirectory = dirname(realpathSync(cliPackageJsonPath));
  cliPackageJson = JSON.parse(readFileSync(cliPackageJsonPath, "utf8"));
} catch {
  fail(`installed @opencode-ai/cli package is missing at ${cliPackageJsonPath}`);
}

if (cliPackageJson.version !== expectedVersion) {
  fail(
    `installed @opencode-ai/cli is ${String(cliPackageJson.version)}, expected ${expectedVersion}`,
  );
}

const configuredBin = cliPackageJson.bin?.opencode2;
if (configuredBin !== "./bin/opencode2.exe") {
  fail(`unexpected opencode2 bin entry: ${String(configuredBin)}`);
}

const installedBinaryPath = resolve(cliPackageDirectory, configuredBin);
let installedBinary;
try {
  installedBinary = statSync(installedBinaryPath);
} catch {
  fail(`installed executable is missing at ${installedBinaryPath}`);
}
if (!installedBinary.isFile() || (installedBinary.mode & 0o111) === 0) {
  fail(`installed executable is not executable: ${installedBinaryPath}`);
}

const versionResult = spawnSync(installedBinaryPath, ["--version"], {
  encoding: "utf8",
  timeout: 10_000,
});
if (versionResult.error !== undefined || versionResult.status !== 0) {
  fail(`could not run ${installedBinaryPath} --version`);
}
const versionOutput = `${versionResult.stdout}${versionResult.stderr}`.trim();
const reportedVersions = versionOutput.split(/\s+/u);
if (
  !reportedVersions.includes(expectedVersion) &&
  !reportedVersions.includes(`v${expectedVersion}`)
) {
  fail(`executable reported ${JSON.stringify(versionOutput)}, expected ${expectedVersion}`);
}

const archResult = spawnSync("lipo", ["-archs", installedBinaryPath], {
  encoding: "utf8",
});
if (archResult.error !== undefined || archResult.status !== 0) {
  fail(`could not inspect executable architecture with lipo: ${installedBinaryPath}`);
}
if (archResult.stdout.trim() !== "arm64") {
  fail(`executable architecture is ${JSON.stringify(archResult.stdout.trim())}, expected arm64`);
}

mkdirSync(stagingDirectory, { recursive: true });
copyFileSync(installedBinaryPath, stagedBinaryPath);
chmodSync(stagedBinaryPath, 0o755);
console.log(`Staged OpenCode ${expectedVersion} arm64 executable at ${stagedBinaryPath}`);
