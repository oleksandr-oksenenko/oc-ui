import { build } from "esbuild";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));

// One bundle recipe for remote installation and the built-in server.
export async function buildSessionTools(outdir = join(directory, "dist")) {
  const result = await build({
    absWorkingDir: directory,
    entryPoints: ["src/index.ts"],
    outdir,
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    external: ["effect", "effect/*"],
    metafile: true,
  });
  await writeFile(join(outdir, "package.json"), JSON.stringify({ type: "module" }));
  return Object.keys(result.metafile.inputs)
    .filter((input) => !input.includes("node_modules/"))
    .map((input) => join(directory, input));
}

if (import.meta.main) await buildSessionTools();
