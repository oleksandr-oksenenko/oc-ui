// @vitest-environment node
// oxlint-disable effecttsgo/node-builtin-import, effecttsgo/async-function -- Verify the Promise-based acceptance process inspection boundary.
import fs from "node:fs/promises";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { isOwnedProcessRunning } from "./e2e/owned-process.ts";

const platform = Object.getOwnPropertyDescriptor(process, "platform");
let kill;
let read;
beforeEach(() => {
  Object.defineProperty(process, "platform", { value: "linux" });
  kill = vi.spyOn(process, "kill").mockReturnValue(true);
  read = vi.spyOn(fs, "readFile");
});
afterEach(() => {
  Object.defineProperty(process, "platform", platform);
  vi.restoreAllMocks();
});

it.each([
  ["Z (zombie)", false],
  ["X (dead)", false],
  ["R (running)", true],
  ["S (sleeping)", true],
  ["T (stopped)", true],
])("distinguishes exited children from live processes: %s", async (state, running) => {
  read.mockResolvedValue(`Name:\tOcui\nState:\t${state}\nPid:\t4117\nPPid:\t3614\n`);
  expect(await isOwnedProcessRunning(4117)).toBe(running);
  expect(kill).toHaveBeenCalledExactlyOnceWith(4117, 0);
  expect(read).toHaveBeenCalledExactlyOnceWith("/proc/4117/status", "utf8");
});

it("accepts a process reaped between the signal probe and proc inspection", async () => {
  read.mockRejectedValue(Object.assign(new Error("process reaped"), { code: "ENOENT" }));
  expect(await isOwnedProcessRunning(4117)).toBe(false);
});

it.each(["linux", "darwin"])("accepts an absent PID on %s without reading proc", async (os) => {
  Object.defineProperty(process, "platform", { value: os });
  kill.mockImplementation(() => {
    throw Object.assign(new Error("no process"), { code: "ESRCH" });
  });
  expect(await isOwnedProcessRunning(4117)).toBe(false);
  expect(read).not.toHaveBeenCalled();
});

it("retains the macOS signal-only probe for an existing PID", async () => {
  Object.defineProperty(process, "platform", { value: "darwin" });
  expect(await isOwnedProcessRunning(4117)).toBe(true);
  expect(read).not.toHaveBeenCalled();
});

it("keeps a denied signal probe visible instead of reporting exit", async () => {
  const cause = Object.assign(new Error("signal denied"), { code: "EPERM" });
  kill.mockImplementation(() => {
    throw cause;
  });
  await expect(isOwnedProcessRunning(4117)).rejects.toBe(cause);
  expect(read).not.toHaveBeenCalled();
});

it("keeps a denied proc read visible instead of reporting exit", async () => {
  const cause = Object.assign(new Error("proc denied"), { code: "EACCES" });
  read.mockRejectedValue(cause);
  await expect(isOwnedProcessRunning(4117)).rejects.toBe(cause);
});

it("rejects missing process state instead of guessing exit", async () => {
  read.mockResolvedValue("Name:\tOcui\nPid:\t4117\n");
  await expect(isOwnedProcessRunning(4117)).rejects.toThrow("Missing process state");
});

it.each([0, -4117, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
  "rejects an invalid PID %s before touching the host",
  async (pid) => {
    await expect(isOwnedProcessRunning(pid)).rejects.toThrow("Invalid owned process PID");
    expect(kill).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  },
);
