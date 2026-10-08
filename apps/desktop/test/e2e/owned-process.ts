import fs from "node:fs/promises";

/** Inspect only a recorded process PID, never a process group or a name match. */
export async function isOwnedProcessRunning(pid: number): Promise<boolean> {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Invalid owned process PID");
  try {
    process.kill(pid, 0);
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ESRCH") return false;
    throw cause;
  }
  if (process.platform !== "linux") return true;

  let status;
  try {
    status = await fs.readFile(`/proc/${pid}/status`, "utf8");
  } catch (cause) {
    // The process can be reaped between kill(0) and the proc read.
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return false;
    throw cause;
  }
  const state = status.match(/^State:\s+(\S)(?:\s|$)/mu)?.[1];
  if (state === undefined) throw new Error(`Missing process state for owned PID ${pid}`);
  // Linux keeps exited children in proc until their parent reaps them.
  return state !== "Z" && state !== "X";
}
