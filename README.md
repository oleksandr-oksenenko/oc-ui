# Ocui

An Electron desktop client for OpenCode.

## Product documentation

- [Product requirements and first-slice design](docs/product-requirements.md)
- [Final milestone 1 design](docs/milestone-1-design.md)
- [Managed local sidecar design](docs/milestone-2-design.md)

## Requirements

- Node.js 22.18 or newer
- pnpm 11.23.0

## Setup

```sh
pnpm install
```

The desktop package owns the pinned OpenCode CLI, client, and UI packages. The
CLI is installed as a runtime dependency of `apps/desktop`, so the Electron
main process can resolve the same `0.0.0-beta-18155` executable used by the
workspace scripts. The three package pins live in the workspace catalog.

## Commands

```sh
pnpm dev                # Start the Electron desktop app in development
pnpm build              # Build the Electron main, preload, and Solid renderer
pnpm check              # Format, lint, type-check, and run Knip
pnpm lint               # Run type-aware Oxlint checks
pnpm knip               # Find unused files, exports, and dependencies
pnpm opencode:server    # Start the installed OpenCode 0.0.0-beta-18155 server
pnpm opencode:version   # Print the installed OpenCode 0.0.0-beta-18155 version
pnpm test               # Run the automated tests
pnpm ready              # Run all repository checks and the production build
```

## OpenCode connection modes

The desktop app is local-first. It tries to start and own a loopback OpenCode
sidecar from the pinned CLI, verifies its health and exact version, and tears
the child process down when the app exits. In the pinned CLI's service mode,
the server-owned default directory is the user's home directory. The first
integration does not provide a directory picker.

If the managed sidecar cannot start or does not become healthy, the app can
connect to a remote OpenCode server instead. Remote connections use the same
Basic-authenticated client and exact-version check. A remote server's default
directory remains server-owned; the app does not send a local directory or
silently start an unrelated process.

To start the pinned CLI server manually for development, set its password and
run:

```sh
OPENCODE_SERVER_PASSWORD=your-password pnpm opencode:server
```

The sidecar and remote connection both use Basic authentication. Loopback
sidecar traffic stays on the local machine. Remote plain HTTP can expose the
password in transit, so use a trusted network or tunnel; HTTPS configuration
is not part of this slice. A remote password is never persisted in plaintext.
While the local child runs, its generated password exists in the app-private
service registration file with owner-only permissions; stopping the child
removes that file.

There is currently no Electron packager or installer in this repository. The
managed sidecar is accepted for the installed workspace/development runtime;
standalone packaged distribution, embedded CLI assets, signing, and updater
behavior remain deferred until a packaging design exists.

On NixOS, set `ELECTRON_EXEC_PATH` to a wrapped Electron 42 executable when
running `pnpm dev`; the executable downloaded by the npm package is not wrapped
with NixOS runtime libraries.

The workspace is ready for more applications under `apps/` and shared packages
under `packages/`.
