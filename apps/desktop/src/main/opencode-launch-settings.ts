import { createRequire } from "node:module";
import { isAbsolute, join, resolve } from "node:path";

/** Called only in the child, before importing the OpenCode library. */
export async function configureOpenCodeLaunch(userDataPath: string, env = process.env) {
  const directory = join(userDataPath, "opencode", "config");
  delete env.OPENCODE_CONFIG;
  delete env.OPENCODE_CONFIG_CONTENT;
  env.OPENCODE_CONFIG_DIR = directory;
  env.OPENCODE_CLIENT = "oc-ui";
  // Resolve only the staged pinned native package, never a global PATH command.
  env.OPENCODE_PTY_BIN = createRequire(import.meta.url).resolve(
    `@opencode-ai/pty-${process.platform}-${process.arch}/bin/opencode-pty`,
  );

  const { Global } = await import("@opencode-ai/util/global");
  const database = env.OPENCODE_DB || "opencode.db";
  if (database === ":memory:") throw new Error("Built-in OpenCode requires a persistent database.");
  return {
    database: { path: isAbsolute(database) ? database : resolve(Global.Path.data, database) },
    config: {
      directory,
      project: true,
      content: JSON.stringify({
        plugins: [{ package: new URL("./session-tools/", import.meta.url).href }],
      }),
    },
  };
}
