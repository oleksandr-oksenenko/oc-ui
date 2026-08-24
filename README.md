# oc-ui

A pnpm workspace for the OpenCode UI.

## Requirements

- Node.js 22.18 or newer
- pnpm 11.23.0

## Setup

```sh
pnpm install
```

## Commands

```sh
pnpm dev                # Start the React app
pnpm build              # Build the React app
pnpm check              # Format, lint, type-check, and run Knip
pnpm lint               # Run Oxlint with React and Effect rules
pnpm knip               # Find unused files, exports, and dependencies
pnpm opencode:server    # Start the local OpenCode 2 beta server
pnpm opencode:version   # Print the installed OpenCode 2 beta version
pnpm ready              # Run all repository checks and the production build
```

The workspace is ready for more applications under `apps/` and shared packages
under `packages/`.
