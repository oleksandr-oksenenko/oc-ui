import { build } from "esbuild";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Shared bundle recipe for standalone and desktop server plugins. */
export async function buildOpenCodePlugin(directory: string, outdir = join(directory, "dist")) {
  const result = await build({
    absWorkingDir: directory,
    entryPoints: ["src/index.ts"],
    outdir,
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    external: ["effect", "effect/*", "@opencode/core/*", "@silvia-odwyer/photon-node"],
    metafile: true,
  });
  await writeFile(join(outdir, "package.json"), JSON.stringify({ type: "module" }));
  return Object.keys(result.metafile.inputs)
    .filter((input) => !input.includes("node_modules/"))
    .map((input) => join(directory, input));
}
