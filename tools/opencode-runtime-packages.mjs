import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";

const packageName = (specifier) =>
  specifier
    .split("/")
    .slice(0, specifier.startsWith("@") ? 2 : 1)
    .join("/");

// Walk Node's package locations without requiring an exported package.json entry.
export function findPackage(name, from) {
  let directory = resolve(from);
  while (true) {
    const candidate = join(directory, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
    const parent = dirname(directory);
    if (parent === directory)
      throw new Error(`Cannot resolve runtime package ${name} from ${from}`);
    directory = parent;
  }
}

function resolveRoots(imports) {
  const roots = new Map();
  for (const { specifier, from } of imports) {
    if (isBuiltin(specifier) || specifier === "electron") continue;
    const name = packageName(specifier);
    const source = findPackage(name, from);
    const existing = roots.get(name);
    if (existing !== undefined && existing !== source) {
      throw new Error(`Bundled runtime imports conflicting versions of ${name}`);
    }
    roots.set(name, source);
  }
  return new Map([...roots].toSorted(([left], [right]) => left.localeCompare(right)));
}

// Each real package keeps its pnpm-resolved dependencies, so linking the roots
// preserves every nested version without copying the closure.
function linkRootPackages(roots, packagesDirectory) {
  for (const [name, source] of roots) {
    const destination = join(packagesDirectory, name);
    mkdirSync(dirname(destination), { recursive: true });
    symlinkSync(source, destination, process.platform === "win32" ? "junction" : "dir");
  }
}

function copyPackageEntries(entries, runtimeDirectory) {
  for (const { path, source } of entries) {
    cpSync(source, join(runtimeDirectory, path), {
      recursive: true,
      dereference: true,
      filter: (file) => !relative(source, file).split(sep).includes("node_modules"),
    });
  }
}

/**
 * Stages a package closure beside a runtime bundle. Packaging copies real files;
 * local test/dev caches pass `{ mode: "link" }` to mirror the install on disk.
 */
export function stagePackageClosure(imports, runtimeDirectory, options = {}) {
  const roots = resolveRoots(imports);

  // Reserve root imports before traversing dependencies. Nested versions remain
  // nested, so every external package keeps the same resolution as the install.
  const packagesDirectory = join(runtimeDirectory, "node_modules");
  const staged = new Map(
    [...roots].map(([name, source]) => [join(packagesDirectory, name), source]),
  );
  const pending = [...staged];
  for (let index = 0; index < pending.length; index += 1) {
    const [destination, source] = pending[index];
    const manifest = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
    const dependencies = {
      ...manifest.peerDependencies,
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
    };
    for (const name of Object.keys(dependencies)) {
      let dependencySource;
      try {
        dependencySource = findPackage(name, source);
      } catch (error) {
        if (
          name in (manifest.optionalDependencies ?? {}) ||
          manifest.peerDependenciesMeta?.[name]?.optional
        )
          continue;
        throw error;
      }
      let visibleDirectory = destination;
      let visibleSource;
      while (visibleDirectory.startsWith(runtimeDirectory)) {
        visibleSource = staged.get(join(visibleDirectory, "node_modules", name));
        if (visibleSource !== undefined) break;
        visibleDirectory = dirname(visibleDirectory);
      }
      if (visibleSource === dependencySource) continue;
      const rootDestination = join(packagesDirectory, name);
      const target = staged.has(rootDestination)
        ? join(destination, "node_modules", name)
        : rootDestination;
      staged.set(target, dependencySource);
      pending.push([target, dependencySource]);
    }
  }

  const entries = [...staged].map(([destination, source]) => ({
    path: relative(runtimeDirectory, destination),
    source,
    manifest: readFileSync(join(source, "package.json"), "utf8"),
  }));
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ mode: options.mode ?? "copy", entries }))
    .digest("hex");
  const manifestPath = join(runtimeDirectory, "closure.json");
  if (
    existsSync(packagesDirectory) &&
    existsSync(manifestPath) &&
    JSON.parse(readFileSync(manifestPath, "utf8")).fingerprint === fingerprint
  )
    return;

  // Delete only this build's generated dependency directory, never the install.
  // The completion marker goes first: an interrupted restage must not leave a
  // partial tree that the next build accepts as complete.
  rmSync(manifestPath, { force: true });
  rmSync(packagesDirectory, { recursive: true, force: true });
  mkdirSync(packagesDirectory, { recursive: true });
  if (options.mode === "link") linkRootPackages(roots, packagesDirectory);
  else copyPackageEntries(entries, runtimeDirectory);
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        fingerprint,
        packages:
          options.mode === "link"
            ? [...roots.keys()].map((name) =>
                relative(runtimeDirectory, join(packagesDirectory, name)),
              )
            : entries.map(({ path }) => path),
      },
      null,
      2,
    ),
  );
}
