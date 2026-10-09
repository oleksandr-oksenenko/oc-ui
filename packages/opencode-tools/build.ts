import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildOpenCodePlugin } from "../../tools/build-opencode-plugin.ts";

const directory = dirname(fileURLToPath(import.meta.url));

// One bundle recipe for remote installation and the built-in server.
export async function buildOpenCodeTools(outdir = join(directory, "dist")) {
  return buildOpenCodePlugin(directory, outdir);
}

if (import.meta.main) await buildOpenCodeTools();
