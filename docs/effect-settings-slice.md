# Settings ordering and shutdown

Settings implements this contract with pinned Effect `4.0.0-rc.112`. Queue supplies FIFO ordering; Scope owns the requests. No semaphore ordering assumptions or retry policy are involved. The wider main and renderer migration is being integrated; historical verification below is not a result for that combined change.

## Owner and caller contract

Keep `load`, `save(target)`, `clear`, and the internal `shutdown` operation on the existing `Context.Service` class. Settings owns one FIFO queue, one worker, and a parallel scope containing every request fiber. Main continues to use the same service through its application runtime, providing Effect FileSystem and the native Node Path layer.

```text
caller → create owned request fiber, waiting for its start signal
       → enqueue: release start signal, then await request settlement
                         ↓
                    FIFO worker

caller ← Fiber.join(request) ← operation result

Settings.shutdown → discard queue + close request scope → join worker
```

The queue stores effects that start and await requests. Each request is registered in its scope before its queue entry is offered, so it remains owned even between dequeue and execution. There is no pending Set, active-job record, job interface, or manually completed reply Deferred.

A per-request `Deferred<void>` is only a start signal. The request fiber itself retains success, failure, or cancellation. Joining it waits for that execution; it never repeats the operation.

## Normal operation

1. Constructing `load`, `save`, or `clear` is lazy and does no I/O.
2. On execution, check admission, create the start signal, and fork the request into its scope. The fiber waits for its start signal, checks closing again, and runs the operation.
3. Offer an entry that releases that request's start signal and then awaits its fiber. Rejecting an offer interrupts and awaits the owned request rather than leaving it waiting.
4. The single worker takes entries in FIFO order and runs each to completion before taking another. It uses `Fiber.await`, so a request failure or defect does not fail the worker.
5. The caller uses `Fiber.join` to receive its request's result. Caller interruption explicitly interrupts and awaits that request fiber; joining alone does not propagate cancellation.

The request owns its I/O and cleanup. The worker cannot start a successor until the previous request has actually settled. Reads therefore observe earlier completed writes. FIFO applies to admitted requests that have not been canceled or discarded.

Protect only submission's admission/fork/offer sequence until the caller's cancellation handler is installed. The start-signal wait, queue wait, operation and normal result wait remain interruptible. The request fiber's scope registration covers the dequeue handoff without a second ownership registry.

## Caller cancellation

- **Before submission:** nothing is queued or written.
- **Waiting:** interrupt the request fiber while it waits for its start signal. A later worker visit to its entry observes an already-settled fiber and performs no I/O.
- **Active:** interrupt only that request. Its I/O adapter requests cancellation where supported and waits for actual native settlement and cleanup before the worker advances.

Closing a renderer window does not itself transmit cancellation through the current IPC contract. Settings shutdown explicitly cancels the requests owned by the departing service.

Cancellation does not prove a write was never applied. There are no retries. Each request executes at most once, and failure, completion or cancellation yields one fiber outcome.

## External I/O and cleanup

Use the current tagged file format (`kind: "local"` or `kind: "remote"`); records without `kind` are ignored. Keep validation, secure-storage behavior and atomic rename. Production supplies Electron's `safeStorage`; the dependency type selects its three required methods.

Settings uses the Effect `FileSystem` service for reads, directory creation, writes, rename and removal. Each save exclusively acquires a temporary directory with mode `0700` beside the settings file, writes a private file with mode `0600` inside it, then atomically renames the file to its destination. `Effect.acquireUseRelease` registers cleanup only after directory acquisition succeeds; no separate permission mutation is needed. The Node layer is pinned to the same RC as Effect. The separate filesystem boundary keeps native I/O owned through settlement; Settings contains no Node filesystem Promise adapter.

The pinned Node FileSystem read/write effects do not wait for native callbacks after interruption. The Settings filesystem layer therefore adapts the five native Promise operations it uses, forwarding AbortSignal to reads/writes and awaiting each Promise in the interruption finalizer. It extends the real Node FileSystem and regenerates its string helpers with `FileSystem.make`; it is not a production no-op filesystem. The directory-read fallback used by ConfigProvider remains owned until native completion. Other unused operations retain the upstream implementation.

Every successful directory acquisition registers removal of that directory and its contents after native work settles, on success, failure or interruption. Failed acquisition never removes the path, including when cancellation arrives before the native collision error. Protect directory acquisition and cleanup from interruption; keep writing and rename interruptible. If rename succeeds during cancellation, cleanup removes the now-empty directory without undoing the committed settings file. Cleanup remains best effort and preserves the original outcome.

On interruption, request abort and await native settlement, including temporary-file cleanup. If rename or other uncancellable work has already started, await it before allowing another mutation.

If active I/O never settles, shutdown remains waiting. A timeout cannot establish safe disposal or permit a conflicting mutation.

## Shutdown and worker lifetime

One cached close operation performs:

```text
close admission
  → Queue.shutdown: discard buffered entries and wake the worker
  → close the parallel request scope: cancel all requests and await cleanup
```

Queue shutdown does not finalize its discarded values. That is safe because their waiting request fibers already belong to the request scope. Scope closure cancels queued requests without first waiting for slow active cleanup. The second admission check prevents a dequeued entry from starting I/O after closing begins.

Every close path shares the cached operation. Bare concurrent `Scope.close` calls are insufficient: a second call can observe Closed before the first has finished finalizing.

The worker belongs to the outer service scope, outside the request scope. Its finalizer invokes the shared close on unexpected termination. Explicit shutdown awaits that close, then interrupts and joins the worker. Close never awaits the worker, avoiding a worker/finalizer join cycle. The service finalizer invokes the same shutdown path, registered before the service is returned.

## Configuration loading

Each load runs `Config.string(SETTINGS_FILE_NAME).pipe(Config.withDefault(""))` using `ConfigProvider.fromDir({ rootPath: userDataPath })`. The default applies only when the file is absent. The provider reads through the supplied FileSystem, and the existing strict JSON schema validates the returned contents. There is no cached settings snapshot, environment fallback, or second authoritative store. A later load observes earlier queued writes and clears.

The provider owns reading the configuration source; Settings still owns encryption, saving, clearing and FIFO ordering. Missing, malformed, untagged or unexpected-key records return no saved target. Configuration source failures remain errors instead of appearing as missing settings. Settings uses the same Effect URL schema for saves and stored records, allowing only plain HTTP origins and enforcing the existing trimmed length limit. Password length is schema-validated without trimming. Schema and filesystem failures become SettingsError once at submission; invalid input fails before encryption or I/O. IPC validates the payload shape and leaves these value rules to Settings.

## Main integration

Main has no separate Settings Promise queue. The shared `runIpc` boundary retains IPC validation and accepted-IPC tracking for Settings and LocalOpenCode.

After the local child has stopped successfully, main cleanup closes the renderer, calls Settings shutdown, waits for remaining tracked IPC settlements, removes handlers, and disposes the runtime. Calling shutdown before awaiting pending IPC allows queued callers to be canceled instead of deadlocking cleanup.

Cancel Quit and a failed child stop leave Settings operational. Preserve the current rule that local connects remain closed once child shutdown has started, even if stopping fails. Distinguish a child-stop failure from a later cleanup failure.

## Verification

Use `@effect/vitest` and the public service with controlled Promise gates and real temporary files, not timing sleeps or exposed queue internals. Build the service in the test scope and use Effect fibers directly; keep native Promises only at the filesystem boundary under test.

- Current tagged persistence, encrypted credentials and fallback remain unchanged; untagged records are rejected.
- Save/load/clear preserve FIFO; canceling alternating queued requests preserves survivor order.
- Failed and defective operations settle without retries or stopping later requests.
- Queued cancellation does no I/O; active cancellation holds successors until actual I/O and cleanup settle. Canceled directory creation finishes before later write steps can run.
- Cancellation across the temporary-write/rename handoff cannot orphan the owned temporary file. A collision during directory acquisition, including one settling after cancellation, preserves the other creator’s directory and contents.
- Shutdown discards pending requests, rejects new work, and makes simultaneous callers wait for active cleanup.
- Scope disposal and admission/shutdown races settle callers at ordinary and reduced scheduler budgets.
- Main tests retain Settings-before-IPC ordering, Cancel Quit, failed child stop, and distinct cleanup failures.

Unexpected private-worker termination is source-reviewed through its finalizer; tests do not expose a private worker solely for injection. Cooperative scheduler tests exercise interleavings without claiming exhaustive concurrency proof.

Historical verification of the temporary-directory refinement used `pnpm check` and `pnpm test` (598 tests across 80 files, including 31 Settings tests). Packaged startup, reconnect, restart and shutdown acceptance passed for the preceding implementation; it was not rerun for this filesystem correction.

That earlier correction added three net production lines and 24 net test lines; these counts do not describe the wider migration. It replaces the separate error and interruption cleanup handlers with `Effect.acquireUseRelease`, without adding a service, helper or dependency. The extra directory acquisition establishes ownership before cleanup can run.

See [the application design](./effect-architecture.md) for wider ownership and [the main cleanup](../apps/desktop/src/main/index.ts) for integration.
