# Local OpenCode build

oc-ui installs locally built OpenCode packages from `vendor/opencode/` and bundles
their runtime into the desktop app. End users need neither the source checkout
nor Bun. Normal `pnpm install --frozen-lockfile` and `pnpm build` use the recorded
tarballs; they do not rebuild OpenCode or download GitHub Actions artifacts.

## Source and carried commits

The source stays in a separate Git checkout. The current checkout is
`../opencode-local` relative to this worktree, on branch `ocui-sessions`.

`vendor/opencode/source.json` records the upstream repository, released base
`v2.0.3`, exact base and fork revisions, Bun version, and carried upstream commits:

- [PR #52681](https://github.com/anomalyco/opencode/pull/52681): session listing
  with filters and opaque pagination cursors, including the follow-up that removes
  the initially proposed active-session read.
- [PR #49568](https://github.com/anomalyco/opencode/pull/49568): message reads.
  Only its feature commit is carried; its unrelated app/codemode fixture fixes
  are excluded.

The backport retains 2.0.3's workspace filters and `session.message` function
shape. It references the existing public client type, so the published client
does not need a rebuild. A compatibility commit records these adjustments.
The fork also carries oc-ui's existing agent rediscovery fix in source, replacing
the former compiled-Core pnpm patch. The existing Client and UI patches remain.
An additional local commit exposes the existing Core `session.remove` operation
through both public plugin contexts and verifies recursive removal. This supplies
`tools.session.delete` without accessing internal services from the external plugin.

`vendor/opencode/source.bundle` contains the fork's commits after the released
base, so the exact source is recoverable without publishing a fork. The package
version stays `2.0.3` because these additions preserve the pinned server protocol;
each locally built package also records `ocuiSource`, the exact fork revision.
`build.json` records tarball SHA-256 hashes and toolchain versions. pnpm's lockfile
pins tarball integrity and overrides transitive Core, Plugin, Schema, and Protocol
dependencies to the same build.

## Recover the separate checkout

From the oc-ui repository root, choose an unused directory outside this repository:

```sh
ocui="$PWD"
git clone --single-branch --branch v2.0.3 \
  https://github.com/anomalyco/opencode.git ../opencode-local
git -C ../opencode-local fetch "$ocui/vendor/opencode/source.bundle" \
  ocui-sessions:ocui-sessions
git -C ../opencode-local switch ocui-sessions
```

## Rebuild and bundle

Use the exact Node version from `.node-version` and Bun version from `source.json`:

```sh
mise install node@24.20.0 bun@1.4.2
mise exec node@24.20.0 bun@1.4.2 -- node --version
mise exec node@24.20.0 bun@1.4.2 -- pnpm build:opencode ../opencode-local
mise exec node@24.20.0 -- pnpm install
mise exec node@24.20.0 -- pnpm check
mise exec node@24.20.0 -- pnpm test
mise exec node@24.20.0 -- pnpm build
```

The build command requires a clean checkout at the recorded revision. It installs
from OpenCode's frozen lockfile, runs the list, messages, and removal plugin regression suites,
type-checks and builds the four affected packages, rewrites exports in temporary
packaging directories using upstream's published-package layout, and packs the
tarballs. It leaves source manifests untouched. If bootstrapping without the
tarballs, invoke `node tools/build-local-opencode.mjs ../opencode-local` directly
under the same `mise exec` environment before installing oc-ui dependencies.

The ordinary desktop build uses the existing OpenCode bundling and staging
pipeline. Staging verifies each fork package's source revision and includes the
build provenance as `out/opencode-runtime/source.json`. Native/WASM dependencies
still use the existing platform-aware packaging pipeline.

For an updated fork, commit its source changes, update `source.json`, recreate
`source.bundle` with `git bundle create <ocui>/vendor/opencode/source.bundle
v2.0.3..ocui-sessions`, and rerun the commands above. Review the tarballs, provenance,
and lockfile together. This local source update replaces editing installed
packages or adding new pnpm patches.

Once the carried changes ship upstream, remove their fork commits. When a released
upstream version covers both capabilities, restore registry dependencies and
remove this temporary build recipe and its vendored artifacts.
