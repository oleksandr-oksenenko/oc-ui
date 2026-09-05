import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const executeFile = promisify(execFile);

export async function git(directory: string, ...args: string[]): Promise<string> {
  const result = await executeFile("git", ["-C", directory, ...args], {
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
  });
  return result.stdout.trim();
}

/** All Git mutations target the runner's disposable fixture, including its local origin. */
export async function prepareProjectFixture(projectDirectory: string): Promise<void> {
  const origin = join(dirname(projectDirectory), "acceptance-origin.git");
  await mkdir(projectDirectory, { recursive: true });
  await mkdir(origin, { recursive: true });
  await git(origin, "init", "--bare", "--initial-branch=main");
  await git(projectDirectory, "init", "--initial-branch=main");
  await writeFile(join(projectDirectory, ".git", "info", "exclude"), "/opencode.json\n");
  await git(projectDirectory, "config", "user.name", "Ocui acceptance test");
  await git(projectDirectory, "config", "user.email", "acceptance@example.invalid");
  await writeFile(join(projectDirectory, "working.txt"), "Original working content\n");
  await git(projectDirectory, "add", "working.txt");
  await git(projectDirectory, "commit", "-m", "Acceptance base");
  await git(projectDirectory, "remote", "add", "origin", origin);
  await git(projectDirectory, "push", "-u", "origin", "main");
  await git(projectDirectory, "remote", "set-head", "origin", "main");
  await git(projectDirectory, "checkout", "-b", "acceptance");
  await writeFile(join(projectDirectory, "branch.txt"), "Committed branch content\n");
  await git(projectDirectory, "add", "branch.txt");
  await git(projectDirectory, "commit", "-m", "Acceptance branch change");
  await writeFile(join(projectDirectory, "working.txt"), "Uncommitted working content\n");
}
