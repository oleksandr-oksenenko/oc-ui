import { build } from "esbuild";
import type { Plugin } from "esbuild";

// OpenCode publishes extensionless ESM and Node-specific conditional loaders that
// plain Node cannot load. Both the Electron worker and the standalone test/dev
// server are bundled with esbuild and run with a staged package closure.
function openCodePackageBoundary(dependencies: Map<string, string>): Plugin {
  return {
    name: "opencode-package-boundary",
    setup(builder) {
      builder.onResolve({ filter: /^[^./#]/ }, (args) => {
        if (args.path.startsWith("@opencode/") || args.path === "@parcel/watcher/wrapper") {
          return undefined;
        }
        dependencies.set(`${args.path}\0${args.resolveDir}`, args.resolveDir);
        return { path: args.path, external: true };
      });
    },
  };
}

export async function bundleOpenCodeRuntime({
  configDirectory,
  entryPoints,
  outfile,
}: {
  configDirectory: string;
  entryPoints: string[];
  outfile: string;
}) {
  const dependencies = new Map<string, string>();
  const result = await build({
    absWorkingDir: configDirectory,
    entryPoints,
    outfile,
    bundle: true,
    platform: "node",
    conditions: ["node"],
    format: "esm",
    target: "node24",
    metafile: true,
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    },
    plugins: [openCodePackageBoundary(dependencies)],
  });
  return {
    result,
    dependencies: [...dependencies].map(([key, from]) => ({
      specifier: key.split("\0")[0] ?? key,
      from,
    })),
  };
}
