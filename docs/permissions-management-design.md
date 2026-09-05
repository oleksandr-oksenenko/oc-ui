# Permission inbox and saved approvals

Status: implemented and independently reviewed; final verification recorded below.
Builds on `b87343d` and targets OpenCode
`0.0.0-beta-18866`. The previous request cards and their concurrency safeguards
remain the only reply surface.

## Caller-facing API

Rename `Conversation/createSessionPermissions` to `Permissions/createPermissions`.
Keep the existing selected-session surface (including `pending`, `sync`, and
`reply`) and its `SessionPermissionsController` type, then extend it:

```ts
type PermissionsController = SessionPermissionsController & {
  inbox: {
    entries: Accessor<readonly PermissionInboxEntry[]>;
    state: Accessor<"loading" | "ready" | "failed">;
    error: Accessor<string | undefined>;
    sync: () => Promise<void>;
  };
  saved: {
    rules: Accessor<readonly PermissionSavedInfo[]>;
    projects: Accessor<readonly Project[]>;
    state: Accessor<"loading" | "ready" | "failed">;
    error: Accessor<string | undefined>;
    removing: (ruleID: string) => boolean;
    errorFor: (ruleID: string) => string | undefined;
    sync: () => Promise<void>;
    remove: (ruleID: string) => Promise<void>;
  };
};
type PermissionInboxEntry = {
  readonly session: SessionInfo;
  readonly requests: readonly PermissionRequest[];
};
```

Add `recoveryError: Accessor<string | undefined>` to the selected-session interface
for the shared blocked-mutation barrier. `pending()` and `recoveryError()` are
workspace-global; ordinary selected-session state/row errors describe only session
reads/replies, and saved state/row errors describe only saved reads/revocation.
Show this distinct recovery notice with a working refresh action in both the
conversation and management dialog, so closing the dialog cannot leave disabled
cards without an explanation. Do not mislabel a revoke block as a failed card load.

Construct once in `createWorkspaceModel` using `effects`, `api`, `data`,
`selectedID`, `connected`, `defaultLocation`, a `sessions` accessor, and
`catalogState` from the existing server-global catalog. The conversation still
receives the selected-session interface. The management view receives the full
controller, `connected`, and `onOpenSession(sessionID)`.

Examples: refresh the inbox with `permissions.inbox.sync()`; confirm one saved
approval then call `permissions.saved.remove(rule.id)`. Opening an inbox row
closes the management dialog and calls the existing session selection flow. Disable
Open session while disconnected; the selection API otherwise silently does nothing. It
does not approve, reject, create, or restore a session.

## User experience

Add one compact shield/count Permissions launcher in the sessions header, through
a controlled `secondaryAction` slot before Create session. It stays outside the
scrolling session list and is available with no selected session. It shows the
number of pending requests, never a count of saved approvals. Keep it separate
from global forms and preserve the titlebar's host-dependent sizing.

The launcher uses the upstream shield icon and badge. It opens one upstream dialog
with line-style Pending and Saved approvals tabs.
Pending groups requests by session and shows the session title (falling back to
ID), server directory, workspace ID when present, requested action, and resource
details. Each group has an explicit Open session action. Reply actions remain
in the conversation, avoiding parallel mutation controls.

Saved approvals lists the server's projects and their saved rules, showing the
project `name ?? canonical`, canonical path and ID, exact action, and exact resource pattern. There is
no implicit filtering to the selected session's project. Each row offers Revoke;
inline confirmation repeats the project/action/pattern and explains that revocation
affects future permission checks, not work already approved. Cancel and Escape
send nothing. No rule editing, bulk revocation, or agent-configuration editing is
introduced. Empty strings, if present in old server data, must be shown explicitly
as an empty value rather than silently omitted or normalized.

Refresh on dialog open, provide explicit Refresh controls, and make loading,
disconnection, partial failure, and retry visible. Cached rows remain inspectable.
Do not claim an empty inbox while discovery is incomplete or failed; the launcher
must say loading, unavailable, or cached/disconnected as appropriate. Revoke is
disabled while disconnected, before successful saved refresh, or during any
permission mutation/reconciliation. Keep the dialog dismissible while work is
pending because work belongs to the workspace; reopening shows its current state.

Use upstream dialog, buttons, tabs, and icons; adapt established modal ownership
and focus-return behavior. Use Solid only for tab selection, confirmation UI,
focus, and layout. Resource state, errors, and pending mutations belong to Effect.
Long values wrap; lists scroll; controls remain accessible at 390, 820, and 1440px.

## SDK boundaries and inbox ownership

The global session catalog already paginates all sessions and remembers their
records in the SDK. Pending-request maps are scoped to the server's loaded,
in-memory locations and are cleared when a location unloads. Use the pinned
`api.debug.location.list` inventory (`GET /api/debug/location`) as the authority
for those loaded location references, then add the default location and deduplicate
with the SDK's `locationKey`. `permission.request.list` is scoped to exactly one
location; omitting its location uses the server's default directory, not the entire
server, and there is no pagination. Preserve directory and workspace ID; do not
use host filesystem rules or directory-only deduplication.

Discover pending session IDs from only that current location inventory, with
bounded concurrency, and discard raw request payloads after discovery. Filter IDs,
hydrate per-session permission caches, and label rows through the complete catalog.
The inbox projection reads only SDK caches through the same settled-ID fences as
selected-session cards; it retains identity hints, not a second request store. A
successful authoritative inventory excludes unloaded locations, hides
their cached rows, and avoids hydrating their historical sessions. A catalog
loading/failure state cannot produce a ready empty inbox.

If inventory fails, keep cached rows visible, mark the inbox incomplete, and offer
retry. An `asked` event retains its session identity as a temporary hint so that a
failed inventory refresh can still hydrate and reveal the request. Effect latest
reads prevent obsolete discovery from publishing over a newer refresh; a later
successful inventory retires hints for locations that are no longer loaded.
Initial catalog readiness, location changes, reconnect, explicit refresh, and
permission events refresh the relevant data. Treat any failed location/session
read as an incomplete inbox with visible retry while preserving successful caches.
`permission.replied` is published before settlement, so keep existing fences;
an event alone must never resurrect or prove completion of a request.

## Saved approvals and mutation ownership

`permission.saved.list` without a project ID means the current project, not all
projects. Sync the SDK's global project list, then invalidate/sync each project's
permission cache with bounded concurrency. Render those SDK-owned rules, with
`?? []` for runtime-uninitialized caches. Preserve raw upstream IDs and values.
No separate rule store or optimistic rule deletion is needed.

There is no SDK remove helper or saved-rule change event. Call the existing typed
`api.permission.saved.remove({ id }, { signal })` through `WorkspaceOwner.request`.
Removal is idempotent SQL deletion. Capture the rule's originating project before
mutation, then invalidate/sync that project after settlement. An ambiguous failure
requires reconciliation: absent means settled; present means show a row-scoped
retry error. Failed reconciliation keeps the shared mutation lock blocked and a
visible retry path until the originating project refresh succeeds, even after
closing/reopening the dialog or selecting another session. Do not automatically
retry the mutation.

Every public refresh entrypoint first recovers a blocked mutation's originating
resource (session for replies, project for revocation). Refreshing an unrelated
resource never clears that block. Only then refresh the requested view. This gives
both the conversation retry and management retry a working recovery path.

Extend the existing workspace mutation state to represent either a reply identity
or a saved-rule identity; do not add an independent coordinator. A pending revoke
disables replies, and a pending reply disables revocation. Keep unrelated feature
work independent. Existing reply failure/fence behavior and shutdown ownership
must be preserved. A successful own Always reply refreshes its originating
project's saved cache after the reply Promise settles. External replied events
invalidate saved caches, but cannot prove a saved write has finished. Refresh on
open and explicit refresh covers that SDK limitation; do not add polling or claim
immediate cross-client saved-rule synchronization.
If the reply and session reconciliation succeeded but this additional saved-cache
refresh fails, report stale saved data and disable revocation until refresh; do not
turn the completed reply into an ambiguous mutation or block further replies.

Direct APIs receive AbortSignal; SDK helpers without cancellation stay owned until
settlement. Dialog disposal does not interrupt workspace mutations. Workspace
shutdown interrupts owned fibers and awaits SDK cleanup. Expected request failures
become useful UI errors; unexpected defects stay observable.

## Review and verification

Review this design before implementation. Delegate controller, UI/wiring, and
real-server acceptance to separate Sol Medium workers with non-overlapping files.
Then perform independent controller and UI reviews plus parent code inspection.

Controller tests cover multiple locations/workspaces, preexisting and live
permissions, event/snapshot races, catalog changes, partial discovery failure,
reconnect, removed sessions, SDK-only projection, saved project coverage, revocation,
ambiguous settlement, blocked recovery, shared mutation ordering, navigation and
dialog remount, and shutdown. Retain prior controller regressions.

Stories cover empty/loading/error/cached/disabled states, multiple projects and
sessions, long and empty values, confirmation/cancel, Escape, focus return, and
narrow layouts. Extend the existing production browser acceptance using disposable
projects and the pinned server: discover requests in two locations without first
opening their sessions, navigate from the inbox and reply, create saved approval,
inspect it, cancel revoke, revoke it, reopen/refresh and confirm it is gone on the
server. Check keyboard focus after dialogs and existing permission replies.

Run root `pnpm check` and `pnpm test` after final edits and inspect Storybook/full
browser flows. No native boundary changes are planned. Report production growth
separately from tests/docs, and remove the superseded controller path rather than
leaving compatibility wrappers. Do not commit the new feature automatically;
the user's explicit commit request applies to the already-verified first phase.

Independent design review required mutation-kind-specific ordinary errors, an
explicit disconnected guard for Open session, and using Project.canonical rather
than an invented directory field. All three are accepted. A shared recoveryError
notice exposes the global lock honestly without mixing the two resource errors.

## Implementation and final verification

Implemented by three Sol Medium workers with separate controller, UI, and
real-server acceptance ownership. Independent controller and UI reviews and parent
source inspection found and resolved stale-cache authority races, shared recovery
ordering, unnecessary fallback rendering, and keyboard focus issues. Saved freshness
now distinguishes an owned refresh from stale data; a narrow project refresh cannot
erase a newer external invalidation or leave an abandoned loading state. Reply event
matching includes the response value so another client's Always cannot be mistaken
for a local Once or Reject. The shared mutation lock is released after authoritative
reply reconciliation, before ancillary saved-cache work.

Final verification on 2026-09-06:

- Root `pnpm check` passed, including formatting, lint, types, styles, component
  layout, and unused-code checks.
- Root `pnpm test` passed: 90 files, 747 tests, including 22 controller tests,
  12 permission management stories with Chromium accessibility checks, and all
  eight production-browser acceptance scenarios.
- Real pinned-server acceptance covered cold discovery in two distinct projects,
  navigation and replies, saved approval creation, cancellation, keyboard revoke,
  focus restoration, refresh/reopen, and server-side absence after removal.
- Manual in-app browser checks covered the full workspace, first open/reopen,
  narrow sidebar navigation, automatic Cancel focus, Escape, keyboard confirmation,
  post-removal Refresh focus, and return to the launcher. A direct SDK read also
  confirmed that the manually revoked fixture rule was absent.
- Story inspection covered 390 × 760, 820 × 900, and 1440 × 900 layouts, long and
  empty values, scrolling, and cached/disconnected partial failures. Storybook's
  static build passed. No native, settings, server-process ownership, or packaging
  boundary changed; Electron/package checks were not required for this phase.

The initial acceptance-only run hit one transient failure in the existing review
provider-state assertion. Its immediate full rerun and subsequent complete root
runs passed without changes to that assertion. JSDOM scrollTo and dependency
optimizer notices were non-failing. Fixtures use disposable projects and a scripted
provider, not personal projects or a live model provider.

Production changes relative to `b87343d`, treating the moved controller as an edit:
1,425 lines added, 144 removed, net +1,281. Tests, fixtures, and stories add 1,611
and remove 140 lines, net +1,471; generated code is unchanged. The two new UI
components are PermissionsRegion and PermissionsDialog; the existing controller
is expanded and relocated, not duplicated. Growth implements inbox discovery,
saved-rule management, their failure/recovery behavior, and responsive accessible
controls. No compatibility wrapper or temporary duplicate coordinator remains.

External saved-rule edits still have no SDK change event. Refresh on open and
explicit refresh are intentional; immediate cross-client synchronization and agent
configuration editing remain outside scope. This phase is left uncommitted.
