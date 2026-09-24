# Permission request integration

Status: implemented; final verification recorded below. Targets OpenCode `0.0.0-beta-18866`.

## Public surface and use

The workspace constructs `createSessionPermissions({ effects, data, selectedID,
connected })` once beside `createSessionForms`. It exposes `requests()`,
`state()` (`loading | ready | failed`), `error()`, `submitting(requestID)`,
`errorFor(requestID)`, workspace-wide `pending()`, `sync()`, and `reply(requestID, reply)`.
`reply` uses the upstream `PermissionReply` union and returns `Promise<void>`.

The conversation passes each upstream `PermissionRequest` to a controlled
`PermissionRequestCard` with `disabled`, `submitting`, `error`, and
`onReply(reply)` props. For example, clicking “Allow once” calls
`permissions.reply(request.id, "once")`. The controller captures the originating
session and request before starting work.

## User behavior

Pending permissions appear in the selected session's existing pending-interaction
area, before questions, without replacing questions or the transcript. Each card
shows the requested action, every resource, the optional explanatory message,
and the source tool-call ID when supplied. Long strings wrap and resource lists scroll.
Content is rendered as text, never HTML. No approval happens on arrival, focus,
Escape, or dismissal.

Actions are “Reject all”, “Allow once”, and “Always allow”. Only show “Always allow”
when the server supplies a nonempty `save` array with no empty entries; display those exact patterns
and explain that this saves permission for that action and those patterns in the
project, and can resolve other matching pending requests. “Reject all” rejects
other pending requests in the same session; explain this next to the controls.
These behaviors come from the pinned core permission service, not UI policy.
Saved-rule management and a cross-session permission inbox were deferred from this
first phase. The later [management feature](permissions-management-design.md) has been retired; requests are answered inside sessions.
Agent configuration remains outside scope; opening a session loads its pending requests.

The existing titlebar launcher counts global forms only. Label it “global forms”
explicitly so its empty count does not imply that no session permissions await
an answer; its behavior and ownership stay the same.

Disable replies while disconnected, submitting, or before a successful refresh.
Loading and refresh failures have visible status and an explicit refresh retry.
Mutation failures stay on the affected card. Keyboard users can reach and activate
all actions; removal of a focused card restores focus to the next pending card or
the conversation's prompt without stealing focus from another control.

## Ownership and lifecycle

The pinned client's `createData` remains the only permission-request store. Its
`session.permission.list/sync/invalidate/reply` helpers own API calls, cache
publication, event reduction, and removal of settled requests. The controller
owns only loading/error and pending-mutation state in Effect atoms. Do not mirror
requests or introduce a generic forms/permissions framework.

Initial selection, selection changes, reconnect, and explicit refresh invalidate
and sync the selected session. Keep obsolete reads in the workspace's ownership
until the SDK Promise settles, using `WorkspaceOwner.latest/request`; these SDK
helpers do not expose AbortSignal. Obsolete results must not publish controller
status into the new selection. On `permission.asked`, invalidate and sync: the
server inserts requests before publishing that event. On `permission.replied`,
record a fence keyed by session/request identity, invalidate, and filter that ID
from the projected list. A racing snapshot can still contain the request because
the server publishes the event before removing it. Clear a fence only after a
later successful snapshot omits its ID. These fences are coordination metadata,
not copied request data. Reconcile after an active snapshot where necessary;
reuse the SDK's serial invalidated reads rather than another read queue.

Replies are workspace-owned and survive conversation unmount or session changes.
Prevent conflicting replies across the workspace while one is pending, including
navigation away and back: always can settle requests across sessions. Expose
workspace-wide `pending()` so every reply control is disabled until the mutation
and reconciliation settle. Keep `submitting(requestID)` keyed by originating
session/request identity for the spinner.
Preserve originating identity for settlement; never apply old errors to a
new selection. Workspace shutdown interrupts owners and awaits outstanding SDK
operations through the existing request finalizer.

Do not automatically retry mutations. A transport failure may follow an applied
reply: invalidate and reconcile against the server before enabling a manual retry.
If reconciliation also fails, keep the response disabled until a successful
explicit refresh. If reconciliation succeeds and the request is absent, treat it
as settled and clear the error. If it remains, show the error and permit manual
retry; clear its event fence because the failed own mutation has now settled and
the subsequent snapshot proves the request remains pending. `sync()` clears the
blocked state only after successful reconciliation of
the originating session, even if another session is now selected.
The SDK treats PermissionNotFound as already settled; replies
from another client remove cards through the shared event reducer. Invalidate
and refresh after successful replies too, since one reply may settle multiple
requests. The server emits replied events before it finishes applying a reply;
do not treat that event alone as proof that a mutation has settled. Failures remain
visible and unexpected Effect defects are not swallowed.

## Verification and implementation boundaries

Controller tests cover initial/select/reconnect loading; stale reads and
event/snapshot races; once/always/reject; duplicate responses; navigation during
reply; applied-but-response-lost reconciliation; refresh failure and recovery;
external settlement; and shutdown waiting for non-cancellable SDK work.

Controlled stories cover each reply, missing save patterns, long content, loading,
disconnected, submitting, failure, keyboard/focus, and narrow layouts. Conversation
tests prove permissions and questions coexist. Extend the existing browser
acceptance suite with a real pinned-server permission request and reply, including
a request created before UI loading and navigation away/back. Use disposable
server state. Run `pnpm check` and `pnpm test`, then visually inspect Storybook and
the browser app. No native boundary changes are planned.

Implementation assignments: (1) controller and controller tests; (2) card, stories,
conversation and workspace wiring and associated fixtures; (3) existing browser
acceptance extension. Parent owns this design, design review resolution, combined
review, and final verification. All implementation is delegated to Sol Medium.

## Design review

Independent Sol Medium review identified cross-session effects of saved approval,
event-before-settlement snapshot resurrection, ambiguity recovery after navigation,
and misleading rejection wording. Accepted corrections: one workspace mutation
lock; settled-ID fences; explicit blocked-refresh recovery; and “Reject all” with
session scope explained. Parent verified these against the pinned server and SDK.
Include regression tests for an external replied event during a stale snapshot
and an always response in one session while attempting a response in another.

## Implementation review and verification

Independent Sol Medium controller review found no actionable issues. Independent
UI review required an explicitly named group for focus restoration and hiding
saved approval when an empty pattern would make scope disclosure incomplete.
Both corrections have dedicated regression coverage; the controller also rejects
saved approval with empty patterns. No request data is duplicated outside the SDK.
Real-browser keyboard verification also caught focus loss when the reply button
became disabled. Move focus to the named card before submission, then restore it
on removal; this needs no extra focus coordinator. Browser acceptance covers the
keyboard reply and prompt focus. Its connection setup waits for a settled screen
instead of treating a transient render as a disconnected state.

The implementation adds one workspace controller and one controlled card, with
settled-ID and mutation metadata for races and recovery. It replaces no existing
coordinator: permissions were previously absent from the UI. Questions retain
their existing controller and rendering. This is feature growth, not a temporary
parallel implementation.

Verification includes root checks, unit tests, Storybook interaction tests, and
the production browser acceptance suite against the pinned server. Manual in-app
browser inspection covers the full workspace card and narrow long-content story;
keyboard checks cover resource scrolling, action focus, and Escape without reply.
No Electron-native or packaging boundary changed, so those checks are not part of
this renderer-only integration.

## Subagent bubbling

Subagent sessions run in child sessions, and the server raises their permission
requests and question forms on the child session, not the parent. Without help a
blocked subagent is invisible while the parent transcript waits on its tool call,
so descendant requests now surface in the selected session's pending area.

- The selected session's own permissions and questions render first, unchanged.
- Descendant sessions with pending items render as always-visible groups titled
  `Subagent: <title>` (falling back to the agent ID, then `Subagent`). Ordering is
  the selected-first tree order from `sessionSubtreeIDs`; each group shows its
  permissions before its questions. Groups are keyed by session ID and resolve
  their cards and label reactively, so an unrelated update cannot remount a form
  and erase a draft. The sidebar attention rollup shows “Subagent permission
  required” or “Subagent question awaiting answer” on every ancestor row,
  including collapsed ones; it reads the unfiltered tree, so a search query cannot
  hide a blocked descendant; unread completions never roll up.
- Replies, cancels, and reconciliation still target the owning session. The pinned
  reply API already takes `sessionID`; mutation keys, fences, and blocked recovery
  were already session-keyed, so `createPermissions` now projects
  `selectedID + subagentIDs` and resolves an item's owner from `request.sessionID`.
  A replied event fences every visible descendant, not only the selected session,
  so a racing snapshot cannot resurrect a request answered by another client.
- `createFormController` gained an optional `relatedIDs` accessor. The primary
  session keeps the loading/failed status; related sessions are projected and
  mutable but never publish controller status. Form operations carry the owning
  `sessionID`, so the same form ID in two displayed sessions can never misroute a
  reply or indicator. `createSessionForms` passes the subtree and invalidates plus
  syncs a related session on `form.created`.
- `SessionWorkspace.subagentIDs` owns the descendant projection. Descendant caches
  are hydrated only when missing, on connect, selection, and subtree changes.
  Descendant reads share one four-permit pool per controller; event reads re-check
  connection and membership after a permit is granted, one `latest` runner owns
  the related batches, and a selection or subtree change cancels queued hydration
  while in-flight SDK reads stay owned until settlement. Recovery retries union the
  failed sessions with still-unloaded caches so it never discards queued work. The
  pinned client remains the only request store; no projection or inbox cache is
  added.
- A descendant read that fails surfaces as “Some subagent requests could not be
  loaded.” with a combined retry in the pending area. Only current descendants can
  record or show that state; it clears on the next successful sync, including a
  reply's reconciliation sync.

Verification: `session-attention-rollup.test.ts` covers priority and origins;
`createPermissions.test.ts` and `createSessionForms.test.ts` cover projection
order, owning-session routing (including duplicate form IDs), event syncs,
descendant fencing and fence clearing, the read bound, subtree cancellation,
queued-read re-checks, retry that preserves queued hydration, failed-load
recovery, and blocked recovery; `SessionTree.test.tsx` and
`ConversationRegion.test.tsx` cover rollup labels, search-independent rollup,
grouped rendering, draft retention, per-owner disabling, and cross-session focus
restoration across ancestor navigation. The production browser acceptance scenario
“bubbles a running subagent's permission request into the selected parent” runs a
real subagent through the scripted provider, asserts the group, the sidebar
rollup, navigation away and back, and an inline reply that lets the subagent
finish. `TranscriptView.stories.tsx` carries the grouped pending state for visual
inspection.
