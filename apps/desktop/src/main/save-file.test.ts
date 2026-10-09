import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vite-plus/test";
import { saveFile } from "./save-file.ts";

const file = { name: "capture.png", bytes: Uint8Array.from([0, 1, 255]) };

describe("native file saving", () => {
  it("awaits the chosen write, treats dialog cancellation normally, and propagates failures", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ocui-download-test-"));
    const dialog = Promise.withResolvers<string | undefined>();
    const choose = vi
      .fn<(name: string) => Promise<string | undefined>>()
      .mockReturnValueOnce(dialog.promise)
      .mockResolvedValueOnce(undefined);
    try {
      const target = join(directory, "capture.png");
      let settled = false;
      const saving = saveFile(file, choose).then(() => {
        settled = true;
        return undefined;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(choose).toHaveBeenCalledWith("capture.png");
      expect(await readdir(directory)).toEqual([]);
      dialog.resolve(target);
      await saving;
      expect(new Uint8Array(await readFile(target))).toEqual(file.bytes);
      await expect(saveFile(file, choose)).resolves.toBeUndefined();
      expect(await readdir(directory)).toEqual(["capture.png"]);
      choose.mockRejectedValueOnce(new Error("dialog failed"));
      await expect(saveFile(file, choose)).rejects.toThrow("dialog failed");
      choose.mockResolvedValueOnce(join(directory, "missing", "capture.png"));
      await expect(saveFile(file, choose)).rejects.toThrow("ENOENT");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each(["capture.png", `${"a".repeat(236)}.png`])(
    "atomically replaces %s and removes failed temporary copies",
    async (name) => {
      const directory = await mkdtemp(join(tmpdir(), "ocui-download-test-"));
      try {
        const target = join(directory, name);
        await writeFile(target, "old");
        await saveFile(file, async () => target);
        expect(new Uint8Array(await readFile(target))).toEqual(file.bytes);
        expect(await readdir(directory)).toEqual([name]);
        const blocked = join(directory, "folder");
        await mkdir(blocked);
        await expect(saveFile(file, async () => blocked)).rejects.toThrow(/EISDIR|ENOTDIR|EEXIST/);
        expect((await readdir(directory)).toSorted()).toEqual([name, "folder"]);
        expect(new Uint8Array(await readFile(target))).toEqual(file.bytes);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
