# oc-ui

A pnpm workspace for the OpenCode UI.

## Product documentation

- [Product requirements and first-slice design](docs/product-requirements.md)
- [Final milestone 1 design](docs/milestone-1-design.md)

## Requirements

- Node.js 22.18 or newer
- pnpm 11.23.0

## Setup

```sh
pnpm install
```

## Commands

```sh
pnpm dev                # Start the Electron desktop app in development
pnpm build              # Build the Electron main, preload, and Solid renderer
pnpm check              # Format, lint, type-check, and run Knip
pnpm lint               # Run type-aware Oxlint checks
pnpm knip               # Find unused files, exports, and dependencies
pnpm opencode:server    # Start the local OpenCode 2 beta server
pnpm opencode:version   # Print the installed OpenCode 2 beta version
pnpm test               # Run the automated tests
pnpm ready              # Run all repository checks and the production build
```

The first milestone expects an OpenCode server protected by Basic auth:

```sh
OPENCODE_SERVER_PASSWORD=your-password pnpm opencode:server
```

On NixOS, set `ELECTRON_EXEC_PATH` to a wrapped Electron 42 executable when
running `pnpm dev`; the executable downloaded by the npm package is not wrapped
with NixOS runtime libraries.

The workspace is ready for more applications under `apps/` and shared packages
under `packages/`.
