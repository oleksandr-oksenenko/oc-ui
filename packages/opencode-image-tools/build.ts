import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildOpenCodePlugin } from "../../tools/build-opencode-plugin.ts";

const directory = dirname(fileURLToPath(import.meta.url));

export async function buildImageTools(outdir = join(directory, "dist")) {
  return buildOpenCodePlugin(directory, outdir);
}

if (import.meta.main) await buildImageTools();
