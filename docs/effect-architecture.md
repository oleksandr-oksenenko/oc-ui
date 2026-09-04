# Effect application design

High-level design for review. Based on main `f9554f8`, OpenCode `0.0.0-beta-18866` and Effect `4.0.0-rc.112`. This describes the intended architecture and the steps to reach it; it is not an implementation status report.

## Purpose and caller model

Give application work and state clear owners, make resource lifetimes explicit, and preserve the current desktop and OpenCode behavior. Effect services own operations and resources; atoms expose application state; Solid renders and handles the DOM.

Callers express an action, without coordinating its internal steps. These are conceptual operations, not new IPC endpoints or final TypeScript signatures:

```text
Connection.connect(local | remote) → verify, attach workspace, save successful choice
Connection.changeServer()          → leave workspace, return to selection
Connection.forgetTarget()          → leave workspace, clear saved choice
Workspace.selectSession(id)        → select, load relevant data
Workspace.submit(session, input)   → admit work, track acknowledgement and failure
Desktop.quit()                    → confirm, stop child, cancel Settings work, settle IPC, dispose
```

Changing or forgetting the connection never stops the built-in server. Submitting a prompt waits for the relevant admission/acknowledgement, not completion of the agent's entire run.

## Structure and ownership

```text
Electron main — one application runtime
├── Desktop lifecycle: IPC admission, windows and Quit
├── Settings: saved target, secure storage and write ordering
└── Built-in server: one child, readiness and termination
    └── Utility process — separate Effect scope
        ├── Worker: launch settings and shutdown bridge
        └── OpenCode: HTTP, database, credentials and server work

Renderer — one runtime and atom registry per window lifetime
└── Connection: selected target, attempts and workspace lifetime
    └── Workspace: feature workflows and application state
        ├── Sessions, composer, forms, changes and local drafts
        └── Existing SDK data store — retained during migration

Solid views → dispatch application actions and subscribe to state
            → own focus, scrolling, layout and DOM behavior
```

These are responsibility boundaries, not a service or class for every item. Use services for real resources, shared state and external dependencies. Keep feature operations as functions within their owner unless a separate service has a concrete purpose. Compose dependencies at the main and renderer entrypoints; do not create runtimes in components or individual requests. Prefer Effect scopes, queues, fibers and finalizers over custom coordination. Each owner defines whether pending work completes or is discarded when it closes.

| Owner             | Authoritative state and decisions                                                                                                                                             |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop lifecycle | Accepted IPC, Quit confirmation, shutdown order and whether new work can enter.                                                                                               |
| Settings          | Saved local/remote choice, encrypted remote password and serialized persistence. Reads observe earlier accepted writes.                                                       |
| Built-in server   | Current child, shared startup/stop, verified endpoint, temporary HTTP password and failure notification. Only confirmed exit releases process ownership.                      |
| Worker / OpenCode | Worker owns preparation and its retained scope. Upstream owns server resources, database, provider credentials, configuration discovery and ongoing server work.              |
| Connection        | Attempts, selected target, setup/error state, saving/forgetting and workspace replacement. Late results cannot replace a newer selection.                                     |
| Workspace         | Selected session, feature operations, local drafts, loading/errors and reconnect recovery order. Server data remains authoritative on the server, with one client-side store. |
| Solid views       | Element references, focus, scroll position, responsive panels and purely visual open/closed state.                                                                            |

Application draft content belongs to Workspace; DOM editor mechanics belong to Solid. Atom projections and derived views do not become additional authoritative stores. No new disk persistence or cross-server draft retention is introduced.

## Existing SDK store is application code

The SDK's Solid data store is **inside Workspace**. It currently owns cached server data, optimistic updates, acknowledgement, rollback and event reconciliation. Keeping it during migration is an explicit temporary exception to moving application state into Effect.

Effect workflows call the required SDK helpers through a small local adapter. The UI reads the existing store directly through its established accessors; do not copy that data into atoms. Our new application state uses atoms and atom-solid. The adapter is an integration detail, not an independent application owner or a generic abstraction over the entire SDK.

Give the store one explicit Solid lifecycle owner per connection, controlled by Workspace. Its mount/cleanup requirements must work independently of which panels subscribe. Preserve its event subscription and reconnect behavior while it remains authoritative; do not introduce a competing reconciliation stream.

Use the native Effect client for direct operations where the same behavior can be preserved. Keep operations that update the cache or perform optimistic changes on the existing SDK path until their replacement is verified. Replacing a Promise signature alone does not migrate data ownership.

Remove the temporary store only when an Effect replacement covers the required cache, optimistic admission, ordered sends, acknowledgement, rollback and event/reconnect behavior. Transfer each responsibility once, remove the previous owner, and keep the same visible behavior. The final design has application state and workflows owned by Effect, with Solid used for rendering and DOM behavior.

## Lifetimes and important flows

**Connect.** Supersede obsolete verification reads. For local connections, ask main for its owned server; concurrent callers share startup. Main verifies authenticated health, the pinned version and child PID after the listening notification. Renderer verifies the connection and server location, attaches Workspace, and waits for stream/setup readiness before reporting success and saving the choice. Preserve the full server-provided location context. A saved local choice remains lazy; existing remote auto-connect behavior is preserved.

**Change or forget.** Stop accepting mutations for the old workspace and cancel obsolete reads. Define pending-job cancellation and active-operation settlement for each workflow; leaving a workspace does not imply executing every queued mutation. Settle affected callers and retain resources needed by active I/O and cleanup before releasing them. Forget also clears the saved target and reports a persistence failure. The current IPC contract does not propagate renderer cancellation to main; any cancellation must be performed explicitly by its main-side owner. The built-in child stays running.

**Feature work.** Capture the connection and session identity when accepting an action. Session changes, panel collapse and subscriber loss must not abandon it or apply its result to a new selection. Serialize conflicting mutations at their actual owner; do not route every unrelated action through one global queue. Wait for request settlement or protocol acknowledgement, not all subsequent server activity.

**Reconnect or crash.** While the existing SDK store is retained, it owns transport reconnection and event reconciliation. Workspace owns application recovery order: refresh location, then session and selected-feature data. Initial setup failure returns to connection selection with an actionable error. A built-in process crash invalidates a selected local connection and requires explicit restart; it does not disturb a selected remote connection.

**Quit.** Main owns one attempt: block new local connects during the attempt; confirm if a child is retained; stop the child and observe exit. Then close the renderer and invoke Settings shutdown: reject new jobs, discard pending jobs and settle their callers as canceled, request active-job cancellation, and await actual I/O and cleanup. Only then wait for remaining tracked IPC settlements, remove handlers and dispose services. Waiting for IPC before canceling its pending Settings jobs can deadlock. Cancel Quit leaves the server running and allows connects again; failed child termination keeps its owner available for another Quit and does not begin Settings shutdown. Preserve the current rule that local connects remain closed once child shutdown has started, even if stopping fails. Distinguish a child-stop failure from a later cleanup failure.

Closing the last macOS window may leave main and the child alive. Reopening creates a fresh renderer. UI subscriber loss does not end an application operation, but destroying the renderer process necessarily ends its local execution. Work already accepted by OpenCode belongs to the server; stronger delivery guarantees across renderer destruction would require a separate contract.

## Boundaries, failures and persistence

- Validate untrusted IPC and external input with schemas. Keep Electron events, native dialogs, secure storage and unavoidable Promises at narrow adapters. Use the pinned Effect APIs and upstream types instead of inventing parallel models.
- Represent expected failures with typed errors. Recover where an owner can retry safely or show a useful message; keep unexpected defects visible. Log failures and useful lifecycle transitions at their owner without credentials or duplicate reports.
- Forward Effect's AbortSignal where supported. Interrupting a Promise wrapper alone does not establish that I/O stopped. A timeout requests cancellation or retains active ownership until actual settlement and cleanup. Keep uninterruptible regions limited to a concrete correctness requirement, and distinguish caller cancellation from worker-job interruption. Cancellation does not undo a mutation already applied. Retry only when the operation's contract makes it safe; keep pending, canceled and failed outcomes meaningful.
- Preserve launch policy: app-specific config directory, persistent OpenCode database under its existing data root unless overridden, and upstream provider credentials. The temporary local HTTP password and saved remote password remain separate concerns.
- Preserve the worker entrypoint, Node runtime, dependency staging and native/WASM assets. Keep OpenCode's existing server scope and cleanup rather than rebuilding its service graph in main.

## Migration and completion

The first bounded slice is [Settings operation ordering](/Users/alex/.codex/worktrees/b7b2/oc-ui/docs/effect-settings-slice.md): use Queue for FIFO ordering and Scope for request fibers inside the existing service, discard pending jobs on shutdown, and remove main's separate queue.

| Stage                 | Change                                                                                                                                                  | Proof needed before moving on                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1. Main ownership     | Put process coordination, Settings ordering and Quit under the main runtime; retain thin Electron adapters.                                             | Shared startup, timeout cleanup, failed-stop retry, pending-job cancellation and active I/O settlement before disposal. |
| 2. Renderer lifetime  | Move connection commands/state out of `App.tsx`; introduce the renderer runtime/registry and an explicitly owned Workspace with its existing SDK store. | Connect/change/forget, obsolete results, initial stream failure, remount and subscriber loss.                           |
| 3. Feature workflows  | Move sessions/recovery, composer and selections, forms, changes and drafts in small slices.                                                             | Existing behavior, correct operation identity and concurrency, useful pending/error states.                             |
| 4. SDK data ownership | Replace retained SDK responsibilities with verified Effect equivalents, then remove the adapter/store.                                                  | Cache, optimistic updates, rollback, acknowledgement, ordering and reconnect parity.                                    |

Each slice removes the application-state owner it replaces and narrows its lint exceptions. Add platform, testing or observability integrations only where they replace required local machinery. Use the existing root checks and tests; keep new regression tests focused on real failure modes. Renderer slices also require the actual Electron UI checks in AGENTS.md; lifecycle changes require packaged startup/reload/crash/Quit acceptance. Documentation alone does not satisfy those implementation gates.

The [launcher investigation and source evidence](/Users/alex/.codex/worktrees/b7b2/oc-ui/docs/effect-ownership-map.md) record the current behavior that informed this design.
