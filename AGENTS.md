# Completion checks

- After implementation, run `pnpm check` and `pnpm test` from the repository root.
- Fix every finding before calling the work complete. Do not substitute package-scoped or focused checks.

# OpenCode integration

- Inspect the pinned OpenCode SDK, UI package, and existing oc-ui code before adding a local type, projection, helper, control, icon, or behavior. Reuse upstream types and primitives when they already express the requirement.
- Reuse must preserve behavior, not just appearance. Check events, accessibility, CSS selectors, mount and remount behavior, and pointer and keyboard interaction before replacing local code with a package primitive.
- Do not invent OpenCode APIs, server behavior, persistence, IPC, or runtime data. If a runtime contract does not exist, keep the UI controlled through honest data and callback props and show an empty or disabled state where needed.
- Treat the connected OpenCode server as the authority for its filesystem. Preserve the complete server-provided location context and validate each navigation by listing the new absolute location. Do not use the Electron host's path rules; keep the minimal POSIX, Windows-drive, and UNC child/parent operations in the shared `serverPath` module.

# UI implementation and verification

- Treat the approved Storybook story, mockup, and latest browser annotations as the visual contract. Match their structure, controls, spacing, density, and placement instead of creating a new interpretation.
- Prefer installed OpenCode UI controls and icons over custom approximations. Keep a local component only when it owns real oc-ui behavior that the package does not provide.
- Do not call UI work complete from tests, types, or a browser preview alone. Inspect the actual Electron app after the final change.
- For affected UI, verify the first open as well as reopen, resize and narrow layouts, scrolling, empty and error states, loading and disabled states, keyboard and Escape behavior, focus restoration, and collapse or remount behavior where applicable.
- Keep regression tests lean: add one focused test for each real failure mode. Avoid large full-app fixtures and repeated setup for a small policy or component behavior.

# Desktop and server runtime

- Launch oc-ui through the exact repository entrypoint, normally `pnpm dev` from the repository root. Never select a process by the generic name `Electron`, and never use a global OpenCode binary when the task requires the pinned dependency.
- Report the Electron app, renderer, and OpenCode server as separate runtime states. Before saying they are running, verify the expected process and window; for a server, also verify the requested endpoint and credentials.
- Use isolated app or server state when testing onboarding, connection, or empty-state behavior so saved sessions and settings do not change the result.
- Give each async start, connect, disconnect, retry, and shutdown flow one owner. Serialize conflicting transitions; a timeout must cancel the underlying work or retain ownership until it settles.

# Integration hygiene

- Before integrating delegated or worktree commits, inspect status and ancestry against the current target branch. Preserve newer and unrelated changes, and verify the combined state rather than only the feature worktree.
