import type { LocalOpenCodeService } from "./local-opencode.ts";

type SidecarShutdown = Pick<LocalOpenCodeService, "disconnect">;

/** Stop the managed sidecar without allowing cleanup failure to block app quit. */
export async function disconnectSidecarForQuit(
  sidecar: SidecarShutdown | undefined,
): Promise<void> {
  try {
    await sidecar?.disconnect();
  } catch {
    // The sidecar owns its retry policy. App shutdown must still complete.
  }
}
