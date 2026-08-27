# Diff panel integration

Status: first production slice implemented
Evidence baseline: repository `HEAD`, `@opencode-ai/client@0.0.0-beta-18155`,
and `@pierre/diffs@1.2.10`
Date: 2026-08-27

## Authority and meaning

The Diff panel follows `selectedSession()?.location`. It does not fall back to
`ConnectedRuntime.defaultLocation` when no session is selected, and it does
not append `SessionInfo.subpath`. The selected session chooses a VCS location;
the returned changes are still workspace state, not changes owned by or
attributable to that session.

The available comparisons are:

| UI label | Client mode | Meaning |
| --- | --- | --- |
| **Working changes** | `working` | Working copy compared with `HEAD`. |
| **Changes vs `<default>`** | `branch` | Working copy compared with the merge base of the named default branch. This can include committed and uncommitted changes. |

`Working changes` is the default. The branch comparison is offered only when
`vcs.get` reports distinct, non-empty current and default branch names.

## Exact client use

`VcsDiffStore` calls:

```ts
api.vcs.diff(
  {
    location: {
      directory: session.location.directory,
      ...(session.location.workspaceID
        ? { workspace: session.location.workspaceID }
        : {}),
    },
    mode: "working" | "branch",
  },
  { signal },
);
```

The `workspaceID` to `workspace` rename is required by the pinned generated
client. The response projects directly:

| `FileDiffInfo` | UI |
| --- | --- |
| `file` | `path` |
| `patch` | `patch` |
| `additions` | `additions` |
| `deletions` | `deletions` |
| `status` | `status` |

The panel does not call `vcs.status`; `vcs.diff` already returns every field
needed for rendering. Branch metadata uses the existing
`data.location.vcs.sync(location)` and `info(location)` cache, whose pinned
implementation calls `vcs.get`.

## Ownership and boundaries

- `ConnectedRuntime` owns one `VcsDiffStore` beside the existing data and
  session stores. It supplies the client and private typed event source.
- `VcsDiffStore` owns raw response state, per-location/per-mode caching,
  loading, errors, stale state, request deduplication, refresh replacement,
  cancellation, and event/reconnect invalidation.
- `ConnectedApp` remains the only owner of selected session and selected
  comparison. It passes `selectedSession().location` to the store, derives
  honest labels from branch metadata, and projects raw files to presentation
  props.
- `ContextPanel` remains presentation-only and keeps its optional `diff`
  capability boundary. It receives no session, location, API, or event source.
- `DiffView` owns comparison, aggregate, loading, empty, stale, refresh-error,
  and file-list presentation.
- `DiffFile` retains the existing oc-ui collapsible header and totals.
  `PierreDiffBody`, mounted inside the collapsible content, owns one imperative
  Pierre `FileDiff` lifecycle and lets Pierre render only the patch body.

This is the smallest extension to the existing model:

```text
selectedSession().location
        -> ConnectedRuntime.diffs
        -> vcs.diff(location, mode)
        -> ConnectedApp presentation projection
        -> ContextPanel -> DiffView -> DiffFile -> PierreDiffBody -> @pierre/diffs
```

No session identifier crosses into the VCS layer.

## Cache, refresh, errors, and races

Cache keys are exactly `(directory, workspaceID, mode)` for the lifetime of a
connected runtime.

- An idle entry loads when Diff is visible, the right panel is open, bootstrap
  is complete, and the event stream is connected.
- A repeated sync joins the same in-flight request.
- A manual retry aborts and replaces only the same location/mode request.
- Responses commit only while their monotonic revision is current.
- Switching session location or comparison cannot put a response into another
  cache entry. An old-location request may finish and warm its own cache.
- Refresh keeps cached files visible. A refresh error keeps those files and
  shows a retryable warning; an initial error is blocking.
- Runtime cleanup aborts every in-flight request.

`filesystem.changed` and `vcs.branch.updated` mark both modes stale for the
event location. An event without a location conservatively marks every warmed
entry stale. `server.connected` does the same; the first connection is
harmless because no entries are warm, while later connections cover events
missed during reconnect. Only visible stale entries revalidate.

Automatic loading is limited to idle entries and `ready && stale` entries.
Failed entries wait for Retry, preventing an error loop.

## Pierre integration

The desktop declares `@pierre/diffs@1.2.10` directly. This matches the version
already used by the pinned OpenCode UI dependency and avoids shipping two
Pierre versions. The application uses the vanilla API; React is not added.

`DiffFile` parses complete Git/unified patches with `parsePatchFiles`. For
the headerless single-file patch shape also accepted by the OpenCode API, it
adds only synthetic `---` and `+++` filename headers and parses the original
hunk body. The server's file path and status remain authoritative.

The Solid-owned host is passed as Pierre's `containerWrapper`. Pierre owns the
generated `<diffs-container>`, open Shadow DOM, styles, syntax highlighting,
and line layout. The wrapper reuses one renderer for updates and calls
`cleanUp()` whenever the collapsible content unmounts. The initial layout is
dark, unified, and horizontally scrollable because the panel is 280-560 px
wide. Pierre cache keys are omitted so updates to the same path cannot reuse
stale parsed content.

Malformed or empty patches remain in the file list with their server totals and
show a local “This patch could not be displayed” fallback. One bad file does not
discard valid files or turn a successful VCS response into a network error.

## UI, tests, and stories

`DiffViewProps` now uses `comparison`, `comparisonOptions`, and
`onComparisonChange`. The selector's accessible label is “Diff comparison”
and remains available during loading, empty, and error states when both
comparisons exist. Session-attribution wording was removed.

Coverage added for:

- exact request location/mode mapping and `AbortSignal`;
- deduplication and working/branch cache isolation;
- same-key refresh replacement;
- scoped and unscoped event invalidation;
- cached files retained after refresh failure;
- comparison control and honest empty copy;
- stale files and Retry presentation;
- complete, headerless, and empty patch handling;
- collapsed open/close/reopen lifecycle and same-path patch updates.

The ContextPanel, AppShell, and AMOLED stories now use real unified patch
fixtures. Browser verification at a 360 px panel confirmed two Pierre Shadow
DOM renderers, syntax-highlighted rows, no panel overflow, comparison switching,
collapse behavior, and no console errors.

## Deferred until evidence requires it

- LRU eviction or persistence;
- polling or event debounce;
- virtualized rendering;
- per-file fetching;
- a generic resource/cache abstraction;
- session attribution.

These are not needed by the current client or UI.
