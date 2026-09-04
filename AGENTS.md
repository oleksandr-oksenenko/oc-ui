# Completion checks

- After implementation, run `pnpm check` and `pnpm test` from the repository root.
- Fix every finding before calling the work complete. Do not substitute package-scoped or focused checks.

# Code size and complexity

- Treat production line count as a strong proxy for complexity. Prefer the least code that meets the requirement clearly and correctly. Expect refactors that preserve behavior to reduce code; use net growth as a signal to review the changes for simplification opportunities.
- Before coding a feature or refactor, identify its owner, the abstractions it needs, and any existing code it replaces. Additional services, types, helpers, or adapters need a concrete purpose.
- Replace old ownership completely. Remove superseded coordinators, flags, queues, and state mirrors instead of adding another layer around them.
- Review for deletion before completion: inline unnecessary helpers, remove redundant types, combine unnecessary layers, and reuse existing operations. Callers should become simpler and ownership easier to follow.
- For each feature or refactor, report production lines added, removed, and the net change, along with new abstractions and old machinery removed. Count tests, documentation, and generated code separately.
- Size checks and growth budgets are advisory. Exceeding an expected size should produce an informational report and prompt a focused review for unnecessary code, duplication, and avoidable abstractions. Apply useful simplifications and briefly explain remaining growth; size alone must not fail verification or block completion. Existing correctness and quality checks remain mandatory.
- Justify temporary growth by naming exactly what later disappears and in which follow-up step. Do not let temporary duplication become the default architecture.
- Do not reduce line count through dense formatting, hidden complexity, or removal of useful checks. Optimize for less code to understand while preserving required behavior and readability.

# Effect architecture

Use Effect to make ownership and failure behavior explicit, not merely to rewrite successful async operations. This repository uses Effect v4 RC; read the installed guidance and source before using unfamiliar APIs.

1. **Start with ownership.** Use Effect for server communication, persistence, connections, and feature workflows. Give each operation an owner and a lifetime. Create services for real resources, shared state, or external dependencies; keep pure calculations and rendering as ordinary code.
2. **Make lifetimes structural.** Compose one application runtime in Electron main and one in the renderer. Use scopes to own resources, child fibers, and cleanup on success, failure, or interruption. Define what happens when a caller, component, or owner goes away; losing a subscriber must not accidentally abandon work owned by the application.
3. **Prefer built-in mechanisms.** Use Effect scopes, fibers, queues, synchronization primitives, finalizers, and retry schedules before creating custom coordination. A custom mechanism needs a concrete requirement that the existing abstractions do not satisfy.
4. **Design failure paths alongside success.** Specify cancellation, partial completion, recovery, and shutdown before implementation. Decide whether caller cancellation propagates and whether shutdown finishes or discards pending work. The application chooses the policy; Effect implements it. Settle affected callers and wait for owned cleanup before disposal.
5. **Connect interruption to real work.** Forward Effect's AbortSignal to external APIs where supported. Stopping a caller's wait is not proof that I/O has stopped. Retain ownership until uncancellable work and cleanup settle. Keep uninterruptible regions limited to work that must finish for correctness; do not disable cancellation across a whole workflow by default.
6. **Handle concurrency and retries deliberately.** Cancel obsolete reads and serialize conflicting mutations in the required order. A timeout must cancel work or leave it owned until settlement. Retry only when repeating the operation is safe; cancellation or a missing response does not prove that a mutation was never applied.
7. **Give state one owner.** Use Effect services and atoms for application state, with `@effect/atom-solid` connecting it to the UI. Keep focus, layout, and DOM behavior in Solid. Never mirror authoritative state across stores.
8. **Keep external boundaries narrow.** Prefer native Effect APIs and adapt Electron or necessary Promise APIs at their boundaries. During migration, the existing OpenCode SDK data store remains application code inside Workspace and stays authoritative until caching, optimistic updates, rollback, and event behavior have a verified Effect replacement. Do not copy that store into atoms.
9. **Make failures clear.** Use typed errors for expected failures and schemas for untrusted input. Recover where an owner can act or present a useful message; keep unexpected defects visible. Use logging and tracing where they help explain lifecycle and failure behavior.
10. **Replace machinery and verify difficult cases.** Remove the manual coordination each migration replaces. Add platform and testing integrations where they replace required local machinery. Use existing verification gates and focused tests for ordering, cancellation, partial failure, retries, cleanup, and shutdown, alongside successful results.

# OpenCode integration

- Inspect the pinned OpenCode SDK, UI package, and existing oc-ui code before adding a local type, projection, helper, control, icon, or behavior. Reuse upstream types and primitives when they already express the requirement.
- Reuse must preserve behavior, not just appearance. Check events, accessibility, CSS selectors, mount and remount behavior, and pointer and keyboard interaction before replacing local code with a package primitive.
- Do not invent OpenCode APIs, server behavior, persistence, IPC, or runtime data. If a runtime contract does not exist, keep the UI controlled through honest data and callback props and show an empty or disabled state where needed.
- Treat the connected OpenCode server as the authority for its filesystem. Preserve the complete server-provided location context and validate each navigation by listing the new absolute location. Do not use the Electron host's path rules; keep the minimal POSIX, Windows-drive, and UNC child/parent operations in the shared `serverPath` module.

# UI implementation and verification

- Treat the approved Storybook story, mockup, and latest browser annotations as the visual contract. Match their structure, controls, spacing, density, and placement instead of creating a new interpretation.
- Use the Codex in-app browser for standalone local web pages and Storybook whenever it can perform the required verification. Use an external browser only when the in-app browser cannot perform the check. This guidance does not cover embedded webviews: the Electron renderer and any view embedded in the app window are not reachable from the in-app browser, so verify them in the running app instead.
- Prefer installed OpenCode UI controls and icons over custom approximations. Keep a local component only when it owns real oc-ui behavior that the package does not provide.
- Complete the following verification checklist as one unit before calling UI work done:
  - Inspect the actual Electron app after the final change. Do not call UI work complete from tests, types, or a browser preview alone.
  - For affected UI, verify the first open as well as reopen, resize and narrow layouts, scrolling, empty and error states, loading and disabled states, keyboard and Escape behavior, focus restoration, and collapse or remount behavior where applicable.
  - Keep regression tests lean: add one focused test for each real failure mode. Avoid large full-app fixtures and repeated setup for a small policy or component behavior.

# Desktop and server runtime

- Launch oc-ui through the exact repository entrypoint, normally `pnpm dev` from the repository root. Never select a process by the generic name `Electron`, and never use a global OpenCode binary when the task requires the pinned dependency.
- Report the Electron app, renderer, and OpenCode server as separate runtime states. Before saying they are running, verify the expected process and window; for a server, also verify the requested endpoint and credentials.
- Use isolated app or server state when testing onboarding, connection, or empty-state behavior so saved sessions and settings do not change the result.
- Give each async start, connect, disconnect, retry, and shutdown flow one owner. Serialize conflicting transitions; a timeout must cancel the underlying work or retain ownership until it settles.

# Integration hygiene

- Before integrating delegated or worktree commits, inspect status and ancestry against the current target branch. Preserve newer and unrelated changes, and verify the combined state rather than only the feature worktree.
