import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "vendor/opencode");
const source = JSON.parse(readFileSync(join(output, "source.json"), "utf8"));
const checkout = process.argv[2];
if (!checkout) throw new Error("Usage: pnpm build:opencode <separate-opencode-checkout>");
const directory = resolve(checkout);
const node = readFileSync(join(root, ".node-version"), "utf8").trim();
if (process.version !== `v${node}`) throw new Error(`Use mise exec node@${node} bun@${source.bun}`);

function run(command, args, cwd = directory) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

if (run("git", ["rev-parse", "HEAD"]).trim() !== source.revision)
  throw new Error(`Checkout must be at ${source.revision}`);
if (run("git", ["status", "--porcelain"]).trim())
  throw new Error("Commit source changes before building");
if (run("bun", ["--version"]).trim() !== source.bun) throw new Error(`Use Bun ${source.bun}`);

run("bun", ["install", "--frozen-lockfile"]);
run(
  "bun",
  [
    "test",
    "test/plugin/session-list.test.ts",
    "test/plugin-message.test.ts",
    "test/plugin/session-remove.test.ts",
  ],
  join(directory, "packages/core"),
);
const workspace = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
const archives = {};
const staging = join(root, ".cache/opencode-pack");
for (const name of source.packages) {
  const packageDirectory = join(directory, "packages", name);
  run("bun", ["typecheck"], packageDirectory);
  run("bun", ["run", "build"], packageDirectory);
  const manifest = JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8"));
  const types = name === "core" ? "./dist/types/" : "./dist/";
  manifest.exports = Object.fromEntries(
    Object.entries(manifest.exports).map(([key, value]) => [
      key,
      {
        import: value.replace("./src/", "./dist/").replace(/\.ts$/, ".js"),
        types: value.replace("./src/", types).replace(/\.ts$/, ".d.ts"),
      },
    ]),
  );
  if (manifest.imports)
    manifest.imports = Object.fromEntries(
      Object.entries(manifest.imports).map(([key, conditions]) => [
        key,
        Object.fromEntries(
          Object.entries(conditions).map(([condition, value]) => [
            condition,
            value
              .replace("./src/", condition === "types" ? types : "./dist/")
              .replace(/\.ts$/, condition === "types" ? ".d.ts" : ".js"),
          ]),
        ),
      ]),
    );
  for (const field of ["dependencies", "peerDependencies", "optionalDependencies"])
    if (manifest[field])
      manifest[field] = Object.fromEntries(
        Object.entries(manifest[field]).map(([dependency, version]) => [
          dependency,
          version === "catalog:"
            ? workspace.workspaces.catalog[dependency]
            : version.startsWith("workspace:")
              ? source.version
              : version,
        ]),
      );
  delete manifest.devDependencies;
  delete manifest.scripts;
  manifest.ocuiSource = source.revision;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  cpSync(join(packageDirectory, "dist"), join(staging, "dist"), { recursive: true });
  cpSync(join(directory, "LICENSE"), join(staging, "LICENSE"));
  writeFileSync(join(staging, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const packed = JSON.parse(
    run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", output], staging),
  )[0];
  archives[manifest.name] = {
    file: packed.filename,
    sha256: createHash("sha256")
      .update(readFileSync(join(output, packed.filename)))
      .digest("hex"),
  };
  console.log(`Packed ${manifest.name} from ${source.revision}`);
}
rmSync(staging, { recursive: true, force: true });
writeFileSync(
  join(output, "build.json"),
  `${JSON.stringify({ revision: source.revision, node, bun: source.bun, archives }, null, 2)}\n`,
);
