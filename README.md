# Ocui

A desktop and browser client for OpenCode.

## Requirements

- Node.js version pinned in [`.node-version`](.node-version)
- pnpm 11.23.0

## Setup

```sh
pnpm install --frozen-lockfile
```

The local default (`pnpm ready`) runs static checks and unit tests. GitHub Actions
runs the heavier component, integration, build, and packaged desktop checks. See
[verification tiers](docs/app-verification.md#verification-tiers) for execution policy.

Opt-in local component and integration tests require Chromium to be provisioned
once per machine (integration fixtures also use OpenSSL and zsh):

```sh
pnpm --filter desktop exec playwright install chromium
```

See [Storybook verification](docs/storybook-verification.md) for the full
verification workflow.

The workspace pins OpenCode CLI, server, client, and UI packages together at
`2.0.3`, the `latest` release of the `@opencode/*` packages, in
[pnpm-workspace.yaml](pnpm-workspace.yaml). Connections
require that exact server version. Electron runs the packaged server library in an owned utility
process. Browser mode connects to an independently running server.

## Quick start

### Desktop

```sh
pnpm dev
```

Choose the built-in server to run OpenCode locally, or connect to an existing
server. The app owns the built-in server and stops it when the app closes.

On NixOS, set `ELECTRON_EXEC_PATH` to a wrapped Electron 42 executable when
running `pnpm dev`; the executable downloaded by the npm package is not wrapped
with NixOS runtime libraries.

### Browser

Start the pinned server library in one terminal:

```sh
OPENCODE_SERVER_PASSWORD=your-password pnpm dev:opencode
```

In another terminal:

```sh
pnpm dev:web
```

Open `http://127.0.0.1:5173` and connect using the server address printed by
OpenCode and the password you supplied. Browser mode requires a separately
running server; it never starts or stops one.

## Development commands

```sh
pnpm dev                # Start the Electron desktop app in development
pnpm build              # Build the Electron main, preload, and Solid renderer
pnpm dev:web            # Serve the browser app at http://127.0.0.1:5173
pnpm build:web          # Build static browser assets in apps/desktop/dist-web
pnpm preview:web        # Preview the static build at http://127.0.0.1:4173
pnpm check              # Check formatting, lint, types, component layout, and unused code
pnpm lint               # Run type-aware Oxlint and CSS checks
pnpm knip               # Find unused files, exports, and dependencies
pnpm dev:opencode       # Start the pinned OpenCode server library
pnpm storybook          # Start the component catalog at http://localhost:6006
pnpm build-storybook    # Build the static component catalog
pnpm verify:browser     # Start an isolated app/server session for manual inspection
pnpm test               # Tier 0: unit/controller, prompt-editor, and session-tools tests
pnpm test:local         # Compatibility alias for pnpm test
pnpm ready              # Local gate: static checks and tier 0 tests
pnpm test:components    # Tier 1: Storybook/accessibility and Chromium storage tests
pnpm test:integration   # Tier 2: browser acceptance and real-server lifecycle tests
pnpm test:all           # Opt in to all non-packaged test tiers (0–2)
pnpm ready:ci           # Opt in to checks, tiers 0–2, and all three builds
pnpm package:mac        # Build an unpacked macOS arm64 .app in apps/desktop/dist
pnpm package:linux      # Build an unpacked Linux x64/glibc app in apps/desktop/dist
pnpm make:mac           # Build the unpacked .app and a macOS arm64 DMG
pnpm test:acceptance:mac # Package and test the macOS arm64 app with WebdriverIO
pnpm test:acceptance:linux # Package and test the Linux x64/glibc app with WebdriverIO
```

`pnpm verify:browser` prints a UI URL, server address, disposable credentials,
and a test project. It uses a scripted provider and does not run UI assertions.
See [App verification](docs/app-verification.md) for inspection, cleanup, and
which automated checks to run for a change.

Packaged desktop acceptance (tier 3) runs on both platforms on pushes to `main`
and manual CI dispatch.
It is separate from `pnpm test`, `pnpm ready`, and `pnpm ready:ci`.

### Local tests and CI

Use `pnpm test` (or its `test:local` alias) for the fast local loop. It runs both workspace packages and
the desktop `unit` project, without needing Chromium. For a single desktop test:

```sh
pnpm --filter desktop exec vp test run --project=unit <test-file>
```

Run affected browser or Storybook projects when developing those features; see
[App verification](docs/app-verification.md) for the focused commands. Before
completing an implementation, run the root `pnpm check` and `pnpm test` gates.

The [CI workflow](.github/workflows/ci.yml) runs on every pull request and push to
`main`, and can also be started manually. Both Linux x64 (`ubuntu-24.04`) and macOS
arm64 (`macos-15`) runners provision the pinned Node.js and pnpm versions.
Static checks, unit tests, components, integrations, and builds have independent
jobs; Chromium is installed only for component and integration jobs:

- Linux and macOS: tiers 0–2 and desktop/browser/Storybook builds on PRs and `main`.
- Linux and macOS: the same packaged acceptance suite on `main` and manual
  dispatch. Packaging supports macOS arm64 and Linux x64/glibc.

CI invokes Vite+ tasks through `vp run --no-cache -w` so every run executes those
tasks. GitHub Actions dependency
caching is disabled, and CI does not upload artifacts. Build outputs and test
diagnostics stay on the disposable runner; test output is available in the job logs.

Packaged live-provider chat tests are opt-in and require credentials; CI uses the
self-contained scripted provider.

## Desktop packaging

Packaging supports macOS arm64 and Linux x64 with glibc, building on the target
platform. `pnpm package:mac`, `pnpm make:mac`, and `pnpm package:linux` build `out/`,
stage the pinned server library and native/WASM assets, and run electron-builder.
The macOS app is written to `apps/desktop/dist/mac-arm64/Ocui.app`, with the server
runtime at `Contents/Resources/opencode-runtime`. The Linux executable is
`apps/desktop/dist/linux-unpacked/ocui`, with the server runtime at
`resources/opencode-runtime`.

Linux packaged acceptance needs Electron's system libraries, `xvfb`, and `xauth`.
The native CI job installs these dependencies; WebdriverIO manages the virtual
display. Linux acceptance launches use `--no-sandbox` and Electron's basic
password-store test substitute. macOS uses a mock keychain. These exercise
credential persistence rather than real OS secret-store protection; production
launch arguments and secure-storage behavior are unchanged.

By default the macOS app uses ad-hoc signing for local testing. To use
an installed Apple Development identity, provide its exact name through
`CSC_NAME`, for example:

```sh
CSC_NAME="Apple Development: Developer (TEAMID)" pnpm make:mac
```

This packaging slice does not notarize, publish, or configure an updater.

## OpenCode connection modes

Desktop offers a built-in server and a remote connection. The built-in server
starts on request, stays on loopback, and stops with the app. Browser mode offers
a server address and optional password; it never starts or stops a server.
Both hosts use the same workspace and exact-version check.

Connections accept HTTP or HTTPS origins, without embedded credentials, paths,
queries, or fragments. Desktop can store passwords using Electron secure storage.
Browser storage remembers only the last successful address; reload requires an
explicit connection and a fresh password. Unsent drafts live in the workspace.

For hosted use, deploy `apps/desktop/dist-web` on a static HTTPS host and provide
a reachable HTTPS OpenCode endpoint with a valid certificate. Allow the UI origin
on that server, for example:

```sh
pnpm --filter desktop opencode:serve --port 4096 --cors https://ocui.example.com
```

The operator supplies TLS and authentication; oc-ui does not proxy or host the API.
An HTTPS browser page requires an HTTPS API, including for loopback addresses.
To build for a static path, use `pnpm build:web --base /ocui/`. The API itself must
be available at an origin root. See [Browser mode](docs/browser-mode-design.md)
for storage, lifecycle, CORS, and deployment details. Chromium is the initial
verified browser target.

## Repository layout

- `apps/desktop/` — Electron main and preload, shared Solid renderer, browser
  entrypoint, Storybook stories, and app tests.
- `packages/opencode-session-tools/` — bundled OpenCode plugin for creating
  sessions in worktrees; see its [README](packages/opencode-session-tools/README.md).
- `tools/` — packaging and repository checks.
- `docs/` — architecture, feature designs, and verification guidance.

## Documentation

- [App verification](docs/app-verification.md) and
  [Storybook verification](docs/storybook-verification.md)
- [Effect architecture](docs/effect-architecture.md) and
  [state ownership](docs/effect-ownership-map.md)
- [Browser mode and deployment](docs/browser-mode-design.md)
- [Embedded session browser](docs/browser-tool-integration.md)
- [Managed worktrees](docs/managed-worktree-design.md)

The [original product requirements](docs/product-requirements.md),
[milestone 1 design](docs/milestone-1-design.md), and
[managed local sidecar design](docs/milestone-2-design.md) describe earlier
implementation slices. Their version pins and scope limits are historical;
use the workspace catalog and current source for the installed runtime contract.
