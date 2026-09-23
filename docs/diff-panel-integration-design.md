# Diff panel integration

Status: CodeView migration implemented
Evidence baseline: repository `HEAD`, `@opencode-ai/client@0.0.0-beta-18155`,
and `@pierre/diffs@1.2.10`
Date: 2026-09-18

## Authority and meaning

The Diff panel follows `selectedSession()?.location`. It does not fall back to
`ConnectedRuntime.defaultLocation` when no session is selected, and it does
not append `SessionInfo.subpath`. The selected session chooses a VCS location;
the returned changes are still workspace state, not changes owned by or
attributable to that session.

The available comparisons are:

| UI label                   | Client mode | Meaning                                                                                                                    |
| -------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Working changes**        | `working`   | Working copy compared with `HEAD`.                                                                                         |
| **Changes vs `<default>`** | `branch`    | Working copy compared with the merge base of the named default branch. This can include committed and uncommitted changes. |

`Working changes` is the default. Branch comparison is offered when `vcs.get`
reports a non-empty default branch name and the reported current branch name
differs from it. This includes detached `HEAD` worktrees, which report no
current branch, provided a default branch name is available.

## Exact client use

`VcsDiffStore` calls:

```ts
api.vcs.diff(
  {
    location: {
      directory: session.location.directory,
      ...(session.location.workspaceID ? { workspace: session.location.workspaceID } : {}),
    },
    mode: "working" | "branch",
  },
  { signal },
);
```

The `workspaceID` to `workspace` rename is required by the pinned generated
client. The response projects directly:

| `FileDiffInfo` | UI          |
| -------------- | ----------- |
| `file`         | `path`      |
| `patch`        | `patch`     |
| `additions`    | `additions` |
| `deletions`    | `deletions` |
| `status`       | `status`    |

The panel does not call `vcs.status`; `vcs.diff` already returns every field
needed for rendering. Branch metadata uses the existing
`data.location.vcs.sync(location)` and `info(location)` cache, whose pinned
implementation calls `vcs.get`.

## Ownership and boundaries

- `ConnectedRuntime` owns one `VcsDiffStore` beside the existing data and
  session stores. It supplies the client and private typed event source.
- `VcsDiffStore` owns raw response state, per-location/per-mode caching,
  loading, errors, stale state, request deduplication, refresh replacement,
  cancellation, and event/reconnect invalidation. The migration does not
  change this store.
- `ConnectedApp` remains the only owner of selected session and selected
  comparison. It passes `selectedSession().location` to the store, derives
  honest labels from branch metadata, and projects raw files to presentation
  props.
- `ContextPanel` remains presentation-only and keeps its optional `diff`
  capability boundary. It receives no session, location, API, or event source.
- `DiffView` owns the comparison control, aggregate, loading, empty, stale,
  refresh-error, and file-list presentation, plus the path-keyed expansion
  overrides behind the summary's Collapse all / Expand all control.
- `DiffCodeView` is the only adapter between Solid props and the vanilla
  `@pierre/diffs` `CodeView`. It owns one `CodeView` instance and its
  imperative item list.
- `diff-render-data.ts` stays the app-owned patch normalizer and selection
  mapper. It parses complete Git/unified patches with `parsePatchFiles`, and
  for the headerless single-file patch shape accepted by the OpenCode API it
  adds only synthetic `---`/`+++` filename headers and parses the original
  hunk body. The server's file path, status, and totals remain authoritative.

```text
selectedSession().location
        -> ConnectedRuntime.diffs
        -> vcs.diff(location, mode)
        -> ConnectedApp presentation projection
        -> ContextPanel -> DiffView -> DiffCodeView -> @pierre/diffs CodeView
```

No session identifier crosses into the VCS layer.

## CodeView integration

`@pierre/diffs@1.2.10` is declared directly by the desktop and is also used by
the pinned OpenCode UI dependency. The application uses the vanilla API; React
is not added. `CodeView` is the library's virtualized multi-item container: it
owns the scroll viewport, item measurement, sticky headers, and element
pooling. The panel adopts it instead of the previous per-file Solid list.

### Item model

`DiffCodeView` maps the `files` prop to one controlled `CodeView` item per
file, preserving server order:

| Item field    | Source                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------- |
| `id`          | `file.file` (server paths are unique within one diff response)                               |
| `type`        | `"diff"` when `prepareDiffRender` yields metadata, `"file"` for an unrenderable/empty patch  |
| `fileDiff`    | `prepareDiffRender(file).fileDiff`                                                           |
| `file`        | `{ name: file.file, contents: "This patch could not be displayed.\n" }` for the fallback row |
| `annotations` | review comments for that path, mapped through `getAnnotationTarget`                          |
| `collapsed`   | `!expanded(file.file)`, where `expanded` reads the path-keyed override map                   |
| `version`     | per-path revision derived from a content signature (see below)                               |

`collapsed` is caller-supplied item data with no internal disclosure and no
collapse-all API, so the panel keeps both. `version` gates controlled updates:
`CodeView` reuses a record and instance when the id and type match, and applies
new payloads only when `version` changes. `DiffCodeView` computes a signature
per path from the Pierre content cache key, the collapsed state, and the
annotation identity/selection signature. A matching signature reuses the
previous version, so typing a comment body does not re-render its file, while a
content, collapse, or annotation change does.

### Header, sticky behavior, and collapse

`disableFileHeader` stays `false`, `stickyHeaders` is `true`, and
`renderCustomHeader(fileOrDiff, context)` returns the panel's own header:
a real `<button>` with `aria-expanded`, a truthful `Collapse <path>` /
`Expand <path>` label, the path with its `title`, and the compact
`DiffChanges` markup with an `sr-only` totals label. Pierre projects the
header content through its custom header slot, so light-DOM CSS keeps styling
it, while Pierre owns the sticky shell and its background. The header content
is rebuilt whenever the item renders; a toggle records the path as a pending
focus target and `onPostRender` restores focus to the rebuilt header button.
The same restoration runs when a refresh replaces a header that currently owns
focus.

`itemMetrics` matches the rendered CSS (`diffHeaderHeight: 30`,
`lineHeight: 18` from `--oc-type-code-line-height`, `paddingTop: 8` for the
body gap Pierre removes when a header exists, default `spacing`) so
virtualization estimates line up with measured content. A collapsed item
renders the same 8 px below its header, because CodeView measures every item
with `paddingTop` whether or not a body is rendered; without it the list
bottom-aligns in the leftover space and pushes the first row down. Every item
therefore ends with the same 8 px — the body's bottom padding, or a collapsed
header's restored padding — so `layout.gap` is 0 and that trailing 8 px is the
card gap. The card border is a pointer-transparent shadow pseudo-element that
stops above it, which keeps every header exactly 30 px in both states. Line
hover highlighting stays `both`, matching the previous per-file renderer. The
CodeView root is the scroll viewport
(`oc-scrollable`), is exposed as `role="region"` with an accessible
"Changed files" label, and is the only scroll owner while files exist.

### Review interaction

- Annotations: each item carries only its own comments. The existing
  imperative annotation element (`createReviewAnnotation`) is unchanged and
  remains slotted by Pierre; comment bodies stay out of the version signature
  so an inline editor keeps its caret.
- Gutter utility: `enableGutterUtility` is true while review is enabled and no
  editor is open; `onGutterUtilityClick` resolves the selected code through
  `getSelectedCode` before calling the owner.
- Selection: the review draft still owns the selected range. `DiffCodeView`
  publishes it with `CodeView.setSelectedLines({ id, range })` and clears it
  when the draft clears. `controlledSelection` stays `false`, so Pierre keeps
  its native drag behavior and the app restores its own selection after
  re-renders.
- Post-render accessibility: `enhanceRenderedDiff` (focusable code lines,
  truthful labels and keyboard activation for Pierre's expand controls) and
  `syncGutterCommentIcons` move from the per-file renderer to the shared
  `onPostRender` callback. `onPostRender` also adds the `diff-file` class used
  by panel CSS and browser acceptance selectors, and marks fallback rows.

### Renderer lifecycle

The worker pool is fixed at construction, so `DiffCodeView` recreates the
`CodeView` when the highlight manager's identity changes (initialization
success or watchdog failure) and calls `cleanUp()` on disposal or replacement.
A theme or review-availability change goes through `CodeView.setOptions`,
which bumps the option revision and re-renders the rendered items. `CodeView`
pools item elements and cleans them when they scroll out, so a collapsed or
off-screen file keeps no rendered code even though its record and metadata
remain.

### Fallback rows

An empty or malformed patch cannot produce `FileDiffMetadata`, so it becomes a
`file` item whose single line is “This patch could not be displayed.” The row
keeps its server path and totals in the same custom header, stays in list
order, and is marked so its body renders muted. One bad file never discards
valid files or turns a successful VCS response into a network error.

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

### Refresh remount behavior

A refresh replaces the `files` array. `DiffCodeView` reconciles the new item
list by id through `CodeView.setItems`: unchanged files keep their record and
version, changed files get a new version and re-render, removed files are
released, and appended files are measured in place. The path-keyed expansion
map is app state, so a collapsed file stays collapsed across a same-path
refresh even when its row remounts. Closing the panel unmounts `DiffView`, so
the expansion overrides reset on reopen; this matches the previous behavior
and is stated here as the owner's lifetime.

## UI, tests, and stories

`DiffViewPresentation` uses `comparison`, `comparisonOptions`, and
`onComparisonChange`. The selector's accessible label is “Diff comparison” and
remains available during loading, empty, and error states when both
comparisons exist. Session-attribution wording is absent. The file list travels
as its own `files` prop, so presentation updates never invalidate patch parsing.

The summary exposes one icon control with a truthful label: it reads
“Collapse all files” while any file is expanded and “Expand all files” when
every file is collapsed. Overrides are keyed by file path, so collapse state
survives a refresh even when a changed file's row is remounted, and toggling a
single file updates the control's label. Mixed `defaultExpanded` fixtures
still decide the initial state of each file.

While files exist, the summary and refresh state stay above the CodeView
viewport; the file list itself scrolls with sticky headers. Empty, loading,
and error states keep their previous layout. At the supported 280-560 px panel
widths, diffs stay unified and horizontally scrollable inside Pierre.

Coverage:

- exact request location/mode mapping and `AbortSignal`;
- deduplication and working/branch cache isolation;
- same-key refresh replacement;
- scoped and unscoped event invalidation;
- cached files retained after refresh failure;
- comparison control and honest empty copy, including detached `HEAD` metadata
  and the on-default reset;
- stale files and Retry presentation;
- complete, headerless, and empty patch handling;
- item derivation: fallback rows, annotation mapping, and version signatures;
- controlled header DOM: labels, totals, and toggle callbacks;
- collapse and expand from the header, Collapse all / Expand all across mixed
  default expansion, the summary label after a single file toggle, and
  collapse survival across a same-path refresh;
- focus restoration to a replaced header, and no restoration after an
  unchanged refresh once focus moved elsewhere;
- collapsed-row markers and `CodeView` construction, recreation on a highlight
  manager change, and disposal cleanup.

Removal and off-screen behavior are covered by the browser acceptance
scenario that deletes and recreates a file, and by `CodeView`'s own element
pooling; no unit test drives the virtualization window directly.

The ContextPanel, AppShell, and AMOLED stories use real unified patch fixtures,
including mixed `defaultExpanded` values and a fallback row. Browser
acceptance covers comparison switching, external disk edits without watcher
events, preserved collapse of an unchanged file, and review annotations across
panel remounts.

## Migration sequence

1. Design: this document.
2. Implementation: add `DiffCodeView` and its helpers, move the file list to
   one `CodeView`, carry the Collapse all / Expand all control forward, delete
   `DiffFile` and `PierreDiffBody`, migrate the unit tests and stories, and
   update the browser acceptance selectors that referenced the per-file host.
3. Verification: root checks and tests plus the browser acceptance scenario
   for refresh and collapse preservation.

## Removed machinery

- `DiffFile` (oc-ui `Collapsible` card, per-file header Solid markup, and the
  per-file Pierre mount/unmount).
- `PierreDiffBody` (per-file `FileDiff` lifecycle, options/annotation/selection
  effects, and per-file `cleanUp`).
- The per-file scroll containers (`.context-panel-body` scrolling the whole
  panel) and the `.diff-file-list` Solid list.

## Deferred until evidence requires it

- LRU eviction or persistence;
- polling or event debounce;
- per-file fetching;
- a generic resource/cache abstraction;
- session attribution;
- collapse persistence across panel close/reopen.
