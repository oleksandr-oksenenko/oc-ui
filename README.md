# Ocui

A desktop and browser client for OpenCode.

## Requirements

- Node.js 24 or newer
- pnpm 11.23.0

## Setup

```sh
pnpm install --frozen-lockfile
```

Storybook and full-app browser tests, which run as part of `pnpm test` and `pnpm ready`,
require Chromium to be provisioned once per machine (the full-app HTTPS fixture also uses OpenSSL):

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

Start the pinned server in one terminal:

```sh
OPENCODE_SERVER_PASSWORD=your-password pnpm --filter desktop exec opencode serve
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
pnpm --filter desktop exec opencode serve     # Start the pinned OpenCode server
pnpm --filter desktop exec opencode --version # Print the installed OpenCode version
pnpm storybook          # Start the component catalog at http://localhost:6006
pnpm build-storybook    # Build the static component catalog
pnpm verify:browser     # Start an isolated app/server session for manual inspection
pnpm test               # Run unit, Storybook, browser, and session-tools tests
pnpm ready              # Run checks, all tests, desktop/browser builds, and Storybook
pnpm package:mac        # Build an unpacked macOS arm64 .app in apps/desktop/dist
pnpm make:mac           # Build the unpacked .app and a macOS arm64 DMG
pnpm test:acceptance:mac # Package and test the macOS arm64 app with WebdriverIO
```

`pnpm verify:browser` prints a UI URL, server address, disposable credentials,
and a test project. It uses a scripted provider and does not run UI assertions.
See [App verification](docs/app-verification.md) for inspection, cleanup, and
which automated checks to run for a change.

Packaged macOS acceptance is separate from `pnpm test` and `pnpm ready`.

## macOS packaging

Packaging is local macOS arm64 only. `pnpm package:mac` and `pnpm make:mac`
build `out/`, stage the pinned server library and native/WASM assets, and run
electron-builder. The app is written to `apps/desktop/dist/`; the server runtime
is bundled at `Contents/Resources/opencode-runtime`.

By default the app uses ad-hoc signing for local testing. To use
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
pnpm --filter desktop exec opencode2 serve --hostname 127.0.0.1 --port 4096 --cors https://ocui.example.com
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
