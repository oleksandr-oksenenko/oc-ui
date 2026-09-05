import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function createProfile(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const paths = Object.fromEntries(
    ["home", "data", "state", "cache", "config", "tmp", "app"].map((name) => [
      name,
      join(root, name),
    ]),
  );
  await Promise.all(Object.values(paths).map((path) => mkdir(path, { recursive: true })));
  return {
    root,
    paths,
    env: {
      PATH: process.env.PATH,
      HOME: paths.home,
      TMPDIR: paths.tmp,
      SHELL: "/bin/zsh",
      XDG_DATA_HOME: paths.data,
      XDG_STATE_HOME: paths.state,
      XDG_CACHE_HOME: paths.cache,
      XDG_CONFIG_HOME: paths.config,
      OPENCODE_DB: join(paths.data, "acceptance.db"),
    },
    remove: () => rm(root, { recursive: true, force: true }),
  };
}
