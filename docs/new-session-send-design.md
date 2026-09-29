# New-session Send design

Status: implemented. Verification evidence is recorded below.

## Caller and normal path

The draft controller gains one operation, `submit(draftID)`. The existing
Composer's `onSubmit` calls it. A second action, `openSession(draftID)`, is shown
only when an attempt has a confirmed server session. Neither operation reads
the selected conversation to determine its destination.

Conceptual calls:

```ts
onSubmit: () => controller.submit(draftID);
onOpenSession: () => controller.openSession(draftID);
```

Send captures the draft, saves it, prepares its location, creates the session,
and submits the captured message. Keep the centered layout until first-message
admission succeeds. If the draft is still selected, select the conversation;
otherwise update the sidebar and use existing notification presentation without
changing selection or focus. Admission means the server accepted the message,
not that the assistant finished responding.

## Owners and code boundaries

- The connected workspace owns submission fibers, independently of mounted views.
  Each draft can have one active submission. Other projects can prepare in parallel.
- The existing renderer-owned draft service owns durable content and attempt
  records. Extend its existing write queue and revision checks; do not create
  another database, persistence service, or saved snapshot store.
- The SDK owns sessions, optimistic messages, per-session admission ordering,
  rollback, and event reconciliation. Continue using `data.session.create` and
  `data.session.prompt`. Commands continue through `api.session.command`.
- Extract the common dispatch path from `createSessionComposer`: command parsing,
  prompt construction, file encoding, and SDK calls. Its input is an explicit
  session ID and captured payload; it returns admission or a typed failure.
  The conversation adapter retains review/annotation capture and its own draft
  clearing/restoration. The new-session owner retains durable attempt handling.
- Change the composer's single active-request slot to per-session admission
  state. Reuse the SDK's send ordering; add no competing send queue. Background
  first messages must not disable an unrelated conversation's composer.
- Extend `createSessionWorktree` with the selected starting revision. Factor the
  existing shell boundary only enough to support local-ref reads and branch
  mutations, preserving its resource ownership. Do not add a repository interface
  or a separate preparation service.

The public workflow surface stays draft-oriented. Internal storage operations
are `beginSubmission(id, attempt)` and `updateSubmission(id, sessionID, next)`:
the first captures and commits the locked draft; the second records a workflow
transition or atomically removes an accepted draft and its attachment bytes.
Both use the existing worker. Keep their transition types within this feature.

## Capture, persistence, and two tabs

Freeze local editor, attachment, setup, and deletion actions synchronously when
Send is accepted. File picker and paste callbacks must obey the same guard.
Continue navigation and creation of other drafts. Keep the original record and
attachment bytes until admission is positively confirmed.

Acquire an exclusive Web Lock named by server identity and draft ID, using
`ifAvailable` so a second tab cannot queue an unintended later submission. Inside
the lock, reread the saved record and perform the capture through the existing
storage worker. Compare the expected revision before committing the attempt.
Any earlier queued saves settle first. A concurrent edit wins or conflicts; it
must never silently replace the message captured by Send.

Use the current draft record as the immutable submitted content; there is no
second copy of its text or file bytes. Persist a small optional attempt:

- Generated `sessionID`, before any server mutation.
- Phase: `preparing`, `creating`, `sending`, or `accepted` (local cleanup only).
- Resolved location when known.
- Classified first request when known: prompt with generated message ID, or
  command with its parsed name and arguments.
- Failure/interruption result and useful message, when terminal.

Classify the original slash-command intent against the selected project's ready
command catalog before preparation. If that catalog cannot be loaded, stop before
mutations. Carry this classification forward and validate it at the destination;
do not first decide whether it was a command after switching the checkout.

The generated session ID also identifies the attempt for conditional updates.
No separate attempt UUID, retry counter, lease timestamp, or heartbeat is needed.
Check revision and attempt identity on every transition. Persist each next phase
before dispatching that phase's server mutation. A phase records intent; it is
not proof the corresponding server resource exists.

Autosave, edit, delete, conflict resolution, and capture all check attempt state
inside their transactions. UI disabling alone is insufficient. Another tab's
dirty edits remain available as a separate copy; they cannot overwrite the
submitted record. Copies are idle drafts with new IDs and no attempt.

BroadcastChannel remains an invalidation hint. On hydration or activation, probe
the draft lock with `ifAvailable`, then reread under it. A held lock means another
tab owns the work. Only an acquired lock plus an unfinished stored attempt permits
marking it interrupted. Do not infer abandonment from timestamps or a lock query.
This is a storage update only; it never dispatches server work.

Keep the lock until owned I/O and final storage updates settle. Web Locks
coordinate contexts sharing the same storage bucket; they do not coordinate
different app origins, browser profiles, machines, or external Git tools.
See the [Web Locks specification](https://www.w3.org/TR/web-locks/).
If the platform cannot provide this lock, report the unsupported submission
capability instead of inventing a second locking protocol.

## Preparing the checkout

Resolve the selected location through the server and check it still belongs to
the selected project. Preserve its complete location context. Acquire a second
exclusive Web Lock for the server and canonical project before preparation.
Always acquire draft then project, and hold the project lock through initial
message admission so another oc-ui preparation cannot switch branches between
checkout and Send. Show a waiting status when another draft holds this lock.
Local sessions still share their checkout after admission; this lock does not
make them isolated.

Recheck branch refs at execution time. Offer and accept local branches only:

- Existing Local branch: validate the local ref, then use ordinary `git switch`
  with remote guessing disabled. No force, automatic stash, or hard reset.
  Preserve changes Git can carry; report Git's refusal otherwise.
- New Local branch: validate the name using Git, resolve the server-reported
  default branch's local ref to a commit, then use `git switch -c` from that
  commit. No literal `main`, fetch, or guessed fallback. A pre-existing name is
  an error, not permission to switch to an unrelated branch.
- Worktree: resolve the selected local ref to a commit and pass it to the native
  `worktree.create` API. Keep strategy, placement, generated name, startup, and
  returned location owned by OpenCode. The result remains detached.
- Non-Git project: retain Local and skip Git operations. An existing detached
  Local checkout with no branch choice can be used as-is; do not invent a name.

Validate and quote every user argument at the shell boundary. Use fixed commands
and Git's argument boundaries; branch text must not become shell syntax.
Keep existing native worktree restrictions for logical workspaces. Windows
worktree support and remote branches remain outside this slice.

Mutating Git commands have a server-side deadline and remain owned until they
settle. The pinned server's `shell.remove` only removes bookkeeping and cancels
its timeout; it does not kill a running process. Remove a shell only after normal
process exit. On a lost connection or uncertain timeout, leave its server timeout
intact and report the uncertainty. Never claim an aborted HTTP request reverted
the checkout. Apply this rule to the shared read boundary as well when factoring
it, rather than extending its current early-removal behavior into mutations.

After preparation, invalidate and synchronize the SDK's agent, model, command,
skill, and VCS catalogs at the destination. Validate the captured agent, model,
variant, skills, and any command there. Do not use the catalogs of the conversation
currently on screen or silently change an unavailable choice. Preserve existing
slash-command semantics: an unknown slash token is ordinary text; a recognized
command remains a command and cannot silently become a prompt after checkout.

The verified server timing constraint is that local
branch changes can update configuration through asynchronous server watchers.
Client cache invalidation alone does not establish that those watchers finished.
The real branch-specific configuration fixture verifies the supported event
boundary before the new session can be created. No arbitrary sleep
or retry of a mutation substitutes for that evidence.

## Creating and sending

Persist `creating` and the prepared location before calling the SDK's
`data.session.create` with the already saved session ID, project, agent, and model.
Await its request, using the existing workspace request owner to retain SDK work
that lacks an AbortSignal. Record the server-returned location before Send.

Encode attachments using `readPromptFile`. Persist `sending` and the request
classification before dispatch. Normal prompts use one saved message ID, existing
prompt formatting, the captured skills/files, and the SDK's admission helper.
Commands use existing parsing and command dispatch; the current command API does
not offer the same client-supplied idempotency ID.

On positive admission, delete the draft and attachment records atomically under
the existing revision checks. A stale save cannot recreate the missing ID. No
completion tombstone is needed. If deletion fails, retain the attempt and report
the storage failure; never offer a fresh session creation from that record.
Optimistic SDK rows alone are not positive admission evidence. Use the request
response, the matching durable inbox event, or a positive server read. Read-only
reconciliation may clear an already accepted record; it must not resend it.

## Failures, interruption, and explicit actions

| Failure boundary                              | Result and available action                                                                                                                                                                                             |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Storage or validation before preparation      | Preserve the draft; release the local input lock; allow correction and Send. No server mutation occurred.                                                                                                               |
| Checkout/worktree preparation                 | End the attempt, preserve the draft, report any known retained location. Leave server resources alone. An explicit new attempt may prepare again; it is not a resume or cleanup and may leave another worktree.         |
| Session creation dispatched but unconfirmed   | Keep the generated ID and frozen draft. Offer a read-only session check. Do not issue another create or return this record to fresh Send. A missing response or one negative read is not proof creation never occurred. |
| Confirmed session, message not yet dispatched | Keep the binding to that session. Explicit Send validates its actual location and submits there; it never prepares or creates again.                                                                                    |
| Prompt admission unconfirmed                  | Preserve the frozen payload and message ID. Explicit Send checks admission and, if needed, sends the identical payload with the same ID to the same session. This uses the SDK/server's existing prompt idempotency.    |
| Command dispatch unconfirmed                  | Preserve the payload and session binding. Offer Open session and inspection; no replay through this draft's Send action.                                                                                                |
| Admission confirmed, storage cleanup failed   | Keep the session binding and display the storage error. Retry only local cleanup.                                                                                                                                       |

Server switching and explicit workspace shutdown interrupt further steps, await
owned request settlement/cleanup where possible, and persist interruption. They
do not roll back branches or worktrees. Actual window destruction may prevent
finalizers; the last committed phase and saved IDs make the unfinished attempt
visible on return. No automatic resumption or resubmission after restart.

An idle failed/interrupted record can be deleted, removing only draft storage,
or copied to edit. A copy never claims to undo the original operation. Active
records cannot be deleted. Session-bound originals stay frozen to preserve the
identity and payload of any potentially accepted request.

## UI reuse and verification

Reuse NewSessionScreen's existing preparing/error/interrupted status, Composer's
readOnly/action/error props, the compact setup strip, and DraftList/SessionRow's
spinner and warning. Use stage text such as Preparing worktree, Creating session,
and Sending message. Keep navigation enabled. Extend existing button and notice
presentation for explicit actions; add no shell, permanent save label, or new
visual token system.

Verify capture against queued saves and attachment callbacks; two-tab duplicate
Send and stale writes; same-project preparation ordering; dirty Git switching;
default branch creation; selected-ref detached worktrees; navigation and server
switch during every phase; SDK settlement without AbortSignal; admission before
storage failure; uncertain create; prompt retry with identical ID and bytes;
command non-replay; reload with every persisted phase; and background completion
without selection theft. Extend existing native IndexedDB, controller, Storybook,
real-server browser, and packaged Electron suites. Run root check/test gates after
implementation. Runtime verification results are recorded below.

## Self-review

The review changed five decisions: retain mutating shell ownership rather than
assuming remove kills it; hold the project lock through admission rather than
only checkout; distinguish durable admission from optimistic transcript rows;
record classification so a command cannot turn into prompt text on retry; and
keep session-bound failures tied to the original ID rather than recreating them.

The remaining mechanisms cover reachable failures: revision checks protect
cross-tab edits, Web Locks protect submission ownership, stored phases survive
window destruction, and saved IDs protect uncertain server mutations. Reuse the
existing queue, database, scopes, SDK state, and UI. No recovery engine, heartbeat,
lease, generic Git framework, extra send queue, or second payload store is added.
The real-server fixture verifies configuration refresh after a branch switch,
including refusing Send when the destination hides the saved agent.

## Implementation notes

The workspace submission owner uses the existing renderer storage queue and SDK
admission helper. Web Locks retain draft and project ownership through settlement;
no SDK queue, session cache, or optimistic transcript state is duplicated.

Local branch configuration changes wait for the applicable server config, agent,
catalog, command, and skill events before validation. New locations also await the
server's plugin activation API before reading catalogs. When a tracked configuration
change emits no refresh event within the deadline, preparation stops visibly without
sending; it does not assume stale configuration is current.

SDK session creation retains its input objects in its optimistic store. The handoff
therefore copies model and location values, and stored server-returned locations are
copied too, keeping SDK reconciliation from changing the captured draft.

The initial draft capture waits for its queued storage commit before an interruption
can release its native lock. Files, setup, and input remain locked until that settles.
Known retained worktree locations stay on the attempt. Preparation failures can be
edited explicitly; session-bound originals remain frozen and can be copied to edit.

The implementation review also removed the old dialog-current cancellation callback
from worktree creation. Workspace interruption is the single cancellation owner;
the real request-settlement test replaces the synthetic dialog-flag scenarios.
The failure-state browser check verifies one notice, actions inside the shared
Composer, and returning a failed preparation to editing without submitting it.

Astra review found and verified three follow-up fixes: preserve the busy state
when resetting a preparation attempt for retry; retain attachment files when a
pending save finishes after navigation during Send; and wait for agent reloads
when checkout changes Markdown files under `.opencode/{agent,agents,mode,modes}`.
Deterministic Chromium regressions cover both ownership races. Real-server branch
fixtures cover all four Markdown directories. The final re-review found no
remaining P1 or P2 issues. These fixes introduce no abstractions or new styles.

## Verification results (2026-09-30)

- Root `pnpm check`: formatting, lint, types, styles, component layout, and unused
  exports pass. Root `pnpm test`: 1,511 desktop tests plus 67 package tests pass.
- The desktop run includes 32 native Chromium storage/workflow tests, 36
  real-server browser/API tests, and the existing component/Storybook suites.
- The real-server fixture verifies Local creation from the default branch with
  dirty changes preserved, a detached worktree from a selected branch, navigation
  during pending worktree creation without selection theft, and stopping before
  session creation when branch configuration hides the captured agent, including
  Markdown sources in each supported agent/mode directory.
- The failure screenshot has one notice and actions inside the shared Composer.
  Editing a preparation failure does not submit it. No feature CSS was added in
  the Send slice. Preparation and failure screenshots are in
  `apps/desktop/dist/web-artifacts/browser-new-session-{preparing,failed}.png`.
- `pnpm test:acceptance:mac`: all seven packaged Electron scenarios pass,
  including actual new-draft Worktree Send through the built-in server, native
  locks, admitted prompt, retained worktree after session deletion, and text/file
  restoration across renderer reload and server restart. Packaging also verifies
  the app signature and bundled runtime.
- The full root gates and packaged acceptance were rerun after the review fixes.
  All seven native scenarios pass on the final code candidate.

Logs: `/tmp/ocui-review-fixes-check.log`, `/tmp/ocui-review-fixes-test.log`, and
`/tmp/ocui-review-fixes-mac.log`. Earlier failures were resolved: an unused export,
generated failure screenshots mistaken for source, and a diff-hover race already
handled by the browser fixture. The native fixture now uses that same bounded
hover/click behavior; unrelated production diff code was not changed.

## Change size and ownership

These counts cover the entire current uncommitted change relative to HEAD,
including the earlier persistent-draft slice. Relocated files are counted as
removal/addition where Git has not yet staged their rename.

| Category           | Added | Removed |  Net |
| ------------------ | ----: | ------: | ---: |
| Production         |  2769 |    1503 | 1266 |
| Tests and stories  |  1885 |    1918 |  -33 |
| Documentation      |   825 |      59 |  766 |
| Test configuration |    14 |       0 |   14 |

The earlier slice adds the small IndexedDB service, durable draft owner, and
workspace adapter. This slice adds one workspace-owned Send workflow, thin native
lock and server-shell boundaries, and shared prompt/command dispatch. Composer
has an optional actions slot for actual failure/conflict controls.

Removed machinery includes the creation dialog/coordinator, obsolete dialog
styles/stories/tests, duplicated attachment encoding and dispatch, the global
admission bottleneck, and the dialog-current cancellation flag. The remaining
growth implements durable drafts/files, transactional revision checks, saved
submission phases/IDs, branch preparation and destination validation. Existing
SDK session state, optimism, ordering, and reconciliation stay authoritative;
there is no new send queue, Git framework, or recovery engine.
