# oc-ui repository guidance

## Effect and state ownership

This repository uses Effect v4 RC for server communication, persistence, connections, and feature workflows. Keep pure calculations and rendering as ordinary code.

- Before writing Effect code, read `apps/desktop/node_modules/effect/AGENTS.md` completely once per session and installed version, following its links where required. If dependencies are absent, install from the existing lockfile before consulting this guide. Resolve unfamiliar APIs against `apps/desktop/node_modules/effect/src`; online references must match the installed version.
- Compose one application runtime in Electron main and one in the renderer. Use services for resources, shared state, and external dependencies; use scopes to own resources, child fibers, and cleanup.
- Keep oc-ui application state in Effect services and atoms, connected through `@effect/atom-solid`. Keep focus, layout, and DOM behavior in Solid. The OpenCode SDK helpers and Solid store inside Workspace own SDK caching, optimistic updates, rollback, and events. Do not mirror their state in atoms or reimplement their behavior. Adopting future upstream Effect helpers requires verified behavior parity.
- Before changing an async workflow, define its owner, lifetime, cancellation, partial-failure recovery, and shutdown policy. Component disposal or loss of a subscriber must not abandon application-owned work. Settle affected callers and await owned cleanup before disposing the owner.
- Forward Effect's AbortSignal to external APIs where supported. Interruption and timeouts must cancel the underlying work or leave it owned until settlement. Limit uninterruptible regions to work that must finish for correctness.
- Cancel obsolete reads and serialize conflicting mutations and connection transitions. Retry only when repetition is safe; cancellation or a missing response does not prove a mutation was unapplied.
- Prefer native Effect APIs, scopes, fibers, queues, synchronization, finalizers, and retry schedules. Adapt Electron and necessary Promise APIs at their boundaries; custom coordination needs a requirement the built-ins cannot satisfy.
- Use typed errors for expected failures and schemas for untrusted input. Recover where the owner can act or present a useful message; keep unexpected defects visible. Add logging or tracing where it explains lifecycle and failure behavior.

## OpenCode integration

- Inspect the relevant pinned SDK, UI package, and existing oc-ui implementation before adding types, helpers, controls, icons, or behavior. Reuse upstream primitives when they meet the requirement; local components should own behavior upstream does not provide.
- When replacing a component, preserve events, accessibility, CSS selectors, mount and remount behavior, and pointer and keyboard interaction, as well as appearance.
- Use existing runtime contracts for OpenCode APIs, persistence, IPC, and server data. Where a contract is absent, keep the UI controlled through data and callback props with an empty or disabled state.
- The connected server owns its filesystem. Preserve its complete location context and validate navigation by listing each new absolute location. Keep POSIX, Windows-drive, and UNC child/parent operations in shared `serverPath`; do not apply the Electron host's path rules.

## Changes and complexity

- For a feature or refactor, identify the owner, required abstractions, and code being replaced before coding. Remove superseded coordinators, flags, queues, and state mirrors. Review the final change for unnecessary helpers, types, layers, and duplication.
- Report production lines added, removed, and net change, plus new abstractions and old machinery removed. Count tests, documentation, and generated code separately. Treat growth as an advisory signal to review complexity, never as a failing gate or a reason to compress formatting or remove useful checks.
- Explain remaining growth. If duplication is temporary, name what will disappear and the follow-up step that removes it.

## UI and desktop runtime

- Follow the approved Storybook story, mockup, and latest browser annotations for structure, controls, spacing, density, and placement.
- Use the Codex in-app browser for standalone pages and Storybook when it supports the required check. Verify Electron and embedded views in the running app; they are not reachable through that browser.
- Launch through the repository entrypoint, normally `pnpm dev` from the root. Identify processes by their repository and entrypoint, never just the name `Electron`. Use the pinned OpenCode executable when testing this integration.
- Verify the Electron app, renderer, and server separately before reporting them as running: check the expected processes and app window, and verify the server endpoint with the required credentials.
- Use isolated app or server state for onboarding, connection, and empty-state tests so saved settings and sessions do not affect the result.

## Verification and completion

- Use [App verification](docs/app-verification.md) to choose additional browser, Storybook, Electron, and packaging checks for the affected boundary.
- After code or configuration implementation, run `pnpm check` and `pnpm test` from the repository root. Focused checks may support development but do not replace these gates. For prose-only changes, check the diff and any affected references.
- Fix findings introduced by the change. Report unrelated failures separately; do not expand into unrelated repairs or describe failing checks as passing. If a required check cannot run, state the blocker and what remains unverified.
- Follow the [affected-UI checklist](docs/app-verification.md#check-affected-ui). Use Storybook for the detailed state matrix and the full browser app (`pnpm dev:web`) by default for renderer workflows. Inspect Electron after changes to native integration, host-dependent layout, preload/settings, built-in server ownership, or packaging. Cover first open and reopen, resize and narrow layouts, scrolling, empty/error/loading/disabled states, keyboard and Escape, focus restoration, and collapse or remount where relevant.
- Keep regression tests focused on real failure modes. For workflow changes, cover the relevant ordering, cancellation, partial failure, retry, cleanup, and shutdown behavior alongside success. Avoid large full-app fixtures for small component or policy changes.
- Before integrating delegated or worktree commits, inspect status and ancestry against the current target branch. Preserve newer and unrelated changes, and verify the combined result.
