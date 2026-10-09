import { randomUUID } from "node:crypto";
import { open, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SaveFileInput } from "../shared/desktop-api.ts";

/** Pending IPC owns the dialog and atomic replacement through settlement. */
export async function saveFile(
  input: SaveFileInput,
  choose: (name: string) => Promise<string | undefined>,
): Promise<void> {
  const path = await choose(input.name);
  if (path === undefined) return;
  const temporary = join(dirname(path), `.ocui-${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    try {
      await handle.writeFile(input.bytes);
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
