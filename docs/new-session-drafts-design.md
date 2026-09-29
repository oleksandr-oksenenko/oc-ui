# Persistent new-session drafts

Implemented after the approved Storybook UI. This document describes the runtime
integration. Checkout preparation and submission remain the next slice; Send is
disabled here.

## Caller contract

One renderer-owned `NewSessionDrafts` service owns editable new-session drafts,
their atoms, attachment bytes, remembered choices, and saving. The workspace
reads those atoms and adapts them to the existing controlled UI.

The service exposes only operations this slice needs:

| Operation                                         | Result and responsibility                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `hydrate(serverKey)`                              | Load that server's records and preferences; preserve local unsaved edits.            |
| `create(serverKey, choices)`                      | Return a stable ID for an in-memory empty draft.                                     |
| `open(id)`                                        | Load attachment bytes for an existing draft.                                         |
| `edit(id, patch)`                                 | Update text, skills, setup, or composer choices immediately; schedule saving.        |
| `attachFiles(id, files)` / `removeFile(id, file)` | Apply existing admission limits; use the existing Composer's File callback contract. |
| `flush(id)`                                       | Save pending edits; succeed only after transaction completion.                       |
| `delete(id)`                                      | Serialize against saves and delete metadata and files together.                      |
| `keepCopy(id)`                                    | Save the captured local version under a new ID and return that ID.                   |
| `useSavedVersion(id)`                             | Explicitly load the latest saved version; report if the original was deleted.        |

These operations return Effects; the existing runtime/owner adapts UI callbacks.
Revisions and IndexedDB transactions remain private to the feature. `create`
does not create a server session. The atoms expose load state, draft records,
opened files, and per-draft loading/error/conflict state; components do not own
another copy of them.
`attachFiles` only adds content to the local draft; it does not send or upload
anything. The workspace maps Composer's File callbacks to draft-owned attachment
IDs internally. The typed edit patch contains only editable fields; it has no
server identity, attachment-reference, or revision fields. Project choice is one
value containing both its ID and location, not independently patched fields.
Decode persisted data at the storage boundary; do not repeatedly validate trusted
UI edits.

Normal calls are direct:

```ts
const id = yield * drafts.create(serverKey, choices);
yield * drafts.edit(id, { text, skills });
yield * drafts.attachFiles(id, files);
yield * drafts.flush(id);
```

Workspace navigation selects `{ kind: "draft", id }` or
`{ kind: "session", id }`. It requests a flush when leaving a draft without
waiting to change views; the renderer retains the save and any unsaved edits.
The draft service never changes workspace selection, including after conflict
resolution. Callers decide whether a returned copy should be opened.

## Ownership and integration

Add two services to the existing renderer runtime in `renderer/connection.ts`:

- `Storage`: the IndexedDB connection and transaction boundary.
- `NewSessionDrafts`: feature policy, atoms, saves, and cross-tab notifications.

Database access is lazy. Storage denial must not prevent Connection, appearance,
or ordinary conversations from starting. Both services outlive a connected
workspace. Pass the draft service and a stable server key into
`createWorkspaceModel`; use its existing workspace owner for server reads and
Add Project. Do not introduce another runtime or a separate connection manager.
Accepted mutations and save workers run in the draft service's renderer scope,
even when a workspace-owned callback invokes them. Cancelling that caller's
wait cannot cancel the accepted mutation or lose its result. Read requests may
be cancelled when obsolete; their completion never changes navigation.
Compose their dependencies so awaited disposal settles Connection/workspace work first,
then flushes drafts, then closes Storage; do not rely on incidental finalizer
ordering between unrelated merged layers.
Wait for the initial local hydration attempt before applying remembered defaults;
after a read failure, allow an in-memory draft with a visible storage error.
This never depends on the server's session catalog becoming ready.

Extend the selection atom already owned by `createSessionWorkspace`, rather
than adding a competing draft-selection atom. Keep the existing session-facing
`selectedID` and `selectedSession` accessors, derived as undefined when a draft
is selected. Preserve session hydration, SDK memory, and deletion fallback.
Catalog refresh must never replace an explicitly selected draft with its normal
session fallback.

When a draft is selected:

- `ConnectedApp` renders `NewSessionScreen` with the existing `Composer`.
- The titlebar shows New session. Session context actions and the right panel
  are unavailable; the previous session's panels and browser are not displayed.
- Session features receive no selected session. Returning to a session restores
  its existing per-session context and conversation draft.
- `SessionsRegion` supplies `DraftList` above the existing session tree, inside
  its shared scroll area. Its rows use `SessionRow`; no project label is added.
- The existing sidebar filter also filters draft titles. Draft loading/failure
  is independent of server-session loading/failure.

Mount the draft composer by its stable ID, not its changing record object.
Bind callbacks to that ID and ignore chooser callbacks after disposal. This
isolates menus, drag state, undo history, and IME state between draft views
without adding a public contextID or passing draft IDs as session IDs.
Ordinary edits must not remount it. Data continues to live in the draft service.

New session creates a new draft when the current one has content. Reuse the
current untouched empty starting screen instead of creating empty rows on
repeated clicks. Text, files, or skill attachments make a draft meaningful.
Once saved, a draft remains until explicitly deleted, even if its content is
later cleared. Derive titles from the first nonempty line, then an attachment
name or skill name, with Untitled draft as the final fallback. Do not persist
derived titles or add selected-draft persistence in this slice.

## Stored data and remembered choices

Use one database, `ocui`, with initial version 1 and three object stores:

| Store         | Contents                                                                                                                                                                                                             |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `drafts`      | ID, server key, revision, created/updated times, project ID and complete location, setup, text, SDK skill attachments, attachment descriptors, agent and SDK model reference including variant. Index by server key. |
| `attachments` | Draft-owned file ID, Blob bytes, name, MIME type, and last-modified time. Index by draft ID.                                                                                                                         |
| `preferences` | Last project for each server; last Local/Worktree mode and existing branch for each server/project location.                                                                                                         |

Connection supplies the identity: the built-in server uses a stable built-in key,
independent of its changing port; remote servers use the existing normalized
origin. Include directory and workspaceID in project-location keys. Never infer
identity from a loopback hostname, strip workspace context, or save credentials.
Records are local to the UI origin/profile; no synchronization between devices
or different UI origins is implied.

Stored branch intent distinguishes an existing branch from a requested new
Local branch. Worktree mode cannot contain a new-branch request. Non-Git
projects use Local without branch intent. An existing detached Local checkout
may have no branch intent: show Detached checkout rather than inventing a name.
These cases require a small extension to the current setup props.

Save setup/model/agent choices with each meaningful draft. Setup-only edits on
an untouched composer update preferences without creating a draft row. Retain
an uncreated branch name only in its draft, not as a remembered existing branch.
Opening an older draft does not overwrite preferences; explicit setup changes
do. Update only the affected preference fields transactionally so changing a
branch cannot overwrite another tab's unrelated mode/project update.

Load remembered project/branch/mode first. Without remembered state, use Local,
its current branch, and the existing project selection fallback. A first
Worktree selection uses the server-reported default branch. Use `vcs.get`'s
existing current/default contract; never hardcode main. Missing remembered
projects, branches, models, or agents remain visible as unavailable until the
user chooses a replacement. Do not silently rewrite the saved draft.

Resolve absent branch/model/agent defaults independently of whether autosave
has persisted the draft. Apply them once both the selected draft's attachment
load and its project's catalogs are ready; fill missing choices without replacing
explicit or remembered choices. Project changes clear choices for that project
and resolve its missing defaults in the same way.
Automatic fills save the draft with `edit(..., { remember: false })`; they never
replace a newer remembered choice simply because an older draft was reopened.

Persist an optional `branchSource: "default"` marker with automatically chosen
branches. Changing Local/Worktree recalculates those branches from the current
or default branch respectively. An explicit picker choice clears the marker;
remembered choices also have no marker. This preserves chosen branches across
mode changes, including after reload. Selecting the displayed automatic branch
explicitly also counts as a preference update, even when its name is unchanged.
Creation establishes the remembered
project; branch/model/agent edits never write the server's project preference.

Keep attachment descriptors with draft metadata. Load bytes only when opening
the draft; reconstruct stable File objects for the existing Composer. Reuse
`admitAttachments` and the current count/byte limits for files and large pasted
text. Store Blobs, not base64 or local filesystem paths. Adding/removing files
and their draft references is one transaction; ordinary text edits do not
rewrite unchanged bytes. Read metadata and its bytes in one transaction before
publishing an opened version and enabling edits. A newer read cannot overwrite
dirty local edits. These atomic operations prevent partial attachment records
in the supported application flow. If an unexpected load or integrity error
occurs, leave the record untouched and report a draft-load error with retry;
do not invent individual-file repair controls or fake empty File objects.
Keep opened File objects while that draft has unsaved edits, even after
navigation, so another tab's deletion cannot destroy the local conflicting copy.
Release clean inactive file bytes and reload them on the next open.

Validate stored metadata through Effect Schema. Keep unreadable records and
their files untouched, report them separately, and load other valid drafts.
Existing localStorage preferences and existing conversation draft storage stay
unchanged. Future features can add stores through ordinary database versions;
there is no migration framework or pluggable storage backend.

## Saving, failures, and lifetime

`Storage` provides one scoped transaction adapter. Feature functions enqueue
native IndexedDB requests, including revision checks, inside that transaction.
Do not run network calls, timers, or arbitrary awaited Effects inside an active
transaction. Resume the caller on transaction complete/abort, not on an
individual successful request. On interruption, abort where possible and await
settlement; a completed transaction remains committed.

Edits update feature atoms immediately and request a save, without a timer
debounce. One renderer-owned worker serializes feature writes and deletes.
Each save captures an immutable draft value. If edits arrive during a write,
save the latest pending value afterward; queued work for an already saved value
does nothing. Do not cancel an active write because newer text arrived.
Only the captured value becomes acknowledged. Compare the current immutable
value with that saved snapshot to track dirty state; no extra edit counter is
needed. Persisted revisions still detect writes from another tab.

For first persistence, insert only if the ID is absent. Subsequent saves check
the expected revision, then increment it in the same transaction as writes.
Never turn a missing previously saved record into a new insertion. Delete
checks the revision, drops this renderer's pending save for that ID, and removes
the record and its file bytes atomically. Thus delayed work cannot resurrect it.
Serialize accepted deletion with this draft's already accepted edits. Prevent
new edits during deletion and restore editability if it fails; do not remove
the visible row before commit.

Internal clean/saving/error state is necessary, but the normal composer has no
permanent Saved or Saving label. Reuse the Composer error presentation for save
failure and an existing sidebar warning/status treatment for an affected row.
Denied storage, quota, and unreadable data retain edits and
show a useful error. Allow an explicit save retry; do not silently discard drafts
or claim persistence succeeded. A failed delete keeps the draft visible.
After a save failure, retain dirty state without starting an automatic retry
loop. Retry on a new edit or an explicit flush. Give DraftList a controlled
status message so a storage warning is not mislabeled Setup failed.

On a server switch, request a flush before the old workspace closes. Local
saving stays renderer-owned; failures remain in memory under the original
server key and become visible when returning. Workspace disposal cancels its
obsolete server reads and settles accepted Add Project work using existing
ownership rules. Draft persistence does not depend on view mounts.

On explicitly awaited renderer disposal, drain pending saves before closing the
database/channel. Actual desktop quit destroys the window, and pagehide does
not await renderer disposal in either host. Persistence therefore relies on
the prompt saves, not a promised final flush: uncommitted edits can be lost on
exit. Do not add a native shutdown handshake in this slice.
Keep ordinary IndexedDB open/error/blocked handling and close on versionchange.
Database-open cancellation closes a late successful result. There is no custom
upgrade/reload workflow before this feature has a schema upgrade to perform.

## Two tabs

Use transactional revisions for correctness and one feature-owned
BroadcastChannel for invalidation messages containing IDs/server keys only.
Notify after commit. Subscribe before hydration and reread when the page becomes
active; messages are hints, not the authoritative draft contents.

If the local draft is clean, adopt a newer saved version, including refreshed
attachment references. If it is dirty or currently saving, reread after the
write settles and compare revisions. Preserve local text, choices, skills, and
files on a real conflict; stop autosaving that version. Show a concise conflict
notice using existing alert/button styles, with Keep as separate draft and
Use saved version. The latter explicitly discards the local version. If the
saved draft was deleted, retain the local version as unsaved and offer copying
it; do not recreate the deleted ID. Copying must load/retain all referenced
bytes before saving under the new ID.
Conflict actions capture an immutable version. Freeze
edits to that draft for the action's duration, keep navigation available, and
retain the local version on failure. A successful copy returns a new ID;
Use saved version applies its completed read or reports deletion. Neither
operation selects a view, discards a newer edit, or steals focus. A controlled
caller selects the returned copy only if the originating draft is still viewed.

Do not add Web Locks yet: this slice has no server submission to protect. The
next slice will acquire a per-draft submission lock, reread the record, persist
an attempt, and hold ownership through Send. Revision checks already prevent
this slice's two tabs from overwriting each other's edits.

## Existing behavior reused and work deferred

Reuse the approved setup strip, NewSessionScreen, Composer/editor, attachment
pills, selection menus, DraftList/SessionRow, and sidebar scroll area. Reuse
`createComposerCatalog` for SDK-owned commands/skills at the selected project.
Expose model/agent catalogs by location using the existing SDK resources and
selection helpers; draft choices update local state, never a prior session's
`switchModel` or `switchAgent` API. Share catalog projection/default policy
only where it is actually reused. Keep existing session mutation controllers
session-specific; use SDK location resources for draft reads and extract small
pure choice helpers when necessary. Do not build a generic session/draft picker
framework, duplicate SDK caches, or fabricate SessionInfo records.

Reuse AddProjectDialog and ServerDirectoryBrowser as a separate dialog. Move
their real Add Project behavior out of the singleton NewSessionFlow into the
workspace draft adapter, preserving validation, full location context, focus,
and accepted-request settlement. Apply its result to the originating draft,
not whichever draft happens to be selected afterward.

The branch picker requires verified local refs; the SDK's string-only mixed
branch list is insufficient. The current code no longer has the earlier shell
coordinator, so add one small server-shell boundary using the pinned SDK's
`shell.create/get/output/remove` APIs and its configured-shell capability data.
List `refs/heads` with a fixed Git command; put the directory in the SDK's cwd
field rather than interpolating it into shell text. The workspace owns bounded
completion/output reads and removal of that temporary shell, including on
cancellation. Preserve returned location context and suppress obsolete results.
Reads may resolve catalogs/defaults but do not switch branches or create a
session/worktree. Unavailable reads have a controlled loading/error state.

Remove the modal new-session opener/state, NewSessionDialog and its styles,
stories, and creation coordinator when the centered entry replaces them. Keep
the separate Add Project dialog and deletion flow. Preserve the native worktree
helper and its boundary tests; move the removed controller's useful scenarios
to the following Send slice rather than leaving tests tied to deleted code.
Send is explicitly
disabled in this development slice. It must not invoke the old empty-session
workflow. This intermediate slice is not a finished replacement ready to release
without the following Send slice.

Do not add preparation stages, attempt records, generated session IDs, retry
recovery, or session-submission abstractions before their caller exists. The
following slice adds those around `flush` and the existing submission workflow.

## Implementation order and evidence

1. Add Storage and the validated draft records; test transactions, errors, and
   metadata/file atomicity against real browser IndexedDB.
2. Add renderer-owned draft atoms, saving, preferences, and conflict handling;
   test stale revisions, edits during saving, delete races, caller interruption,
   conflict-action ordering, failed-copy preservation, and retained failures.
3. Extend the existing selection owner and wire the controlled UI/catalogs/Add
   Project; remove the old modal path. Test session context clearing/restoration,
   late chooser results after draft switching, undo isolation, and stable editing
   without remounts.
4. Extend the existing browser acceptance suite for multiple drafts, text/skills/
   files after reload, server partitioning, two-tab conflicts/deletion, and missed
   notifications. Extend packaged Electron acceptance for restart and the built-in
   server's changed port. Use disposable state in both.

Run root check/test and affected packaged acceptance on the implementation.
Inspect only visual questions left by those tests, using the existing workspace
stories for errors/conflicts and the in-app browser for the actual draft screen.

The final review reproduced and fixed attachment loads cancelled by their own
loading updates, SDK model proxies rejected by IndexedDB, and remembered choices
overwritten by an in-flight refresh. Refreshes now merge unrelated saved fields
while preserving choices changed during the read.

Verification on 2026-09-29:

- Root `pnpm check` passes formatting, lint/types, styles, component layout, and
  unused-code checks.
- Root `pnpm test` covers unit, Storybook, native IndexedDB, and production browser
  acceptance. Nineteen storage/controller cases exercise real transactions, write/delete races,
  file restoration, cancellation, draining, conflicts, and preference ordering.
  The added cases cover late defaults after text/file autosave, reopening and
  changing projects, attached/detached mode defaults, explicit/remembered choices,
  and another window's project preference surviving branch/model/agent edits.
  Reopening incomplete drafts preserves newer preferences, and explicitly
  selecting an automatic branch is remembered across later checkout changes.
- All seven packaged Electron startup scenarios pass, including saved draft text
  and file bytes after renderer reload and a built-in server restart with a new
  port. The runner verifies the packaged application's signature and owns cleanup.
- The in-app browser visual check confirms the approved centered Composer,
  compact setup strip, folder labels, and shared project-picker styles. The browser
  acceptance screenshot is `apps/desktop/dist/web-artifacts/browser-new-session-drafts.png`.

## Change size

Compared with the committed UI slice, counting DraftList's move as a rename:

| Category           | Added | Removed |  Net |
| ------------------ | ----: | ------: | ---: |
| Production         | 1,703 |   1,331 | +372 |
| Tests and stories  | 1,183 |   1,893 | -710 |
| Test configuration |    14 |       0 |  +14 |

Documentation is counted separately in the implementation report; generated
artifacts are excluded. The two new services are Storage and NewSessionDrafts.
The workspace adapter binds their state to the existing components and SDK
catalogs, and a small shell boundary reads local Git refs. The old modal creation
coordinator, dialog, project selector, styles, and creation-only tests/stories
were removed. Remaining growth implements durable file storage, multiple drafts,
and cross-window conflicts. Checkout preparation and submission remain deferred;
the retained worktree helper will be used by that slice.

The simplification review removed the unused `markCreated` selection shortcut
and the duplicate flush when creating another draft. The selection observer
owns navigation flushing; `flushSelected` remains for server switching. Attach
and copy share one private pure attachment-descriptor projection, with UUIDs
still allocated independently at each operation.

## Defensive rules reviewed

These rules address concrete storage and lifecycle cases. The implementation
review checked the existing owners, callbacks, and native storage contracts.

| Rule                                             | Concrete trigger and conclusion                                                                                                                                                                                                                                                                           |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Renderer-owned saves                             | Switching servers disposes the workspace scope and its fibers. Keep accepted local writes outside that scope; reuse the existing renderer runtime.                                                                                                                                                        |
| Serialized writes and immutable snapshots        | A user can type while an IndexedDB write is pending. Acknowledging that write must not mark the newer text saved. Keep snapshots and one worker; remove the additional edit counter and timer debounce.                                                                                                   |
| Transaction completion and atomic file updates   | A request can succeed before its transaction aborts, including on quota failure. Keep metadata and bytes in the same transaction and acknowledge only completion.                                                                                                                                         |
| Revision checks and insertion rules              | Two tabs can load the same revision and later save different edits. A stale writer can also run after the other tab deletes the draft. Keep transactional checks; never reinsert a previously saved missing ID.                                                                                           |
| Deletion/action edit locks                       | An edit accepted during deletion could be lost; an edit during copy or replacement could be discarded. Serialize deletion with saves and briefly freeze that draft's editing for these explicit actions. Navigation remains available.                                                                    |
| Conflict copies retain files                     | Another tab can delete stored bytes while this tab has unsaved text referencing those files. Keep dirty drafts' opened File objects until saved or explicitly discarded.                                                                                                                                  |
| Notifications plus rereads                       | A tab can start after a notification was sent, or become inactive. Keep subscriptions before hydration and reread on activation; database revisions provide correctness. No polling or additional lock is needed here.                                                                                    |
| Draft-specific view lifetime                     | The current editor retains history when its session ID and document do not change; file-selection events are queued. Switching drafts can otherwise share editor state or accept a late chooser callback. Key the view by draft ID and ignore callbacks after disposal; remove the new public context ID. |
| Selection and asynchronous results               | The session catalog currently falls back to a session when selection is absent. Reads, Add Project, and conflict actions can also finish after navigation. Exclude draft selection from that fallback and target the originating draft without selecting it on completion.                                |
| Stable server/location identity                  | The built-in server uses an allocated port on each start, and server locations can carry workspace context. Keep a stable built-in key and complete locations, using existing connection/path contracts.                                                                                                  |
| Unavailable saved choices and local branch reads | Branches can be deleted externally and SDK catalogs can change. The pinned Git provider lists local and remote refs together. Keep unavailable choices visible and read actual local refs; do not guess from branch names.                                                                                |
| Owned server reads and temporary shells          | Reads can finish after their project changes, and a remote shell can stall or remain allocated. Reuse workspace cancellation and own bounded shell reads/removal at the SDK boundary. No additional read coordinator is needed.                                                                           |
| Attachment limits and storage errors             | Oversized files, exhausted storage, and denied database access are real inputs/failures. Reuse existing admission limits and one error path; keep edits in memory. Decode stored metadata at the boundary without repeatedly validating typed UI edits.                                                   |
| Missing attachment repair                        | Atomic application writes, reads, and deletes cannot leave half a file/reference update. Remove bespoke per-file repair states and controls. Unexpected load/integrity failure uses the ordinary load error without rewriting data.                                                                       |
| Database lifecycle                               | Version changes and a late successful open after caller cancellation are native lifecycle cases. Keep standard close/error handling. Remove custom upgrade/reload UI until an actual schema upgrade exists.                                                                                               |
| Exit saving                                      | The main process destroys the window; pagehide invokes disposal without awaiting it. Remove the guarantee of a final save on quit. Save promptly during editing; do not add a shutdown handshake to this slice.                                                                                           |
| Submission defenses                              | There is no Send workflow in this slice. Defer submission locks, attempt records, session IDs, and preparation failure handling until that workflow is implemented.                                                                                                                                       |

Repository evidence: [workspace scope](../apps/desktop/src/renderer/workspace-owner.ts),
[connection lifetime](../apps/desktop/src/renderer/connection.ts),
[selection fallback](../apps/desktop/src/renderer/components/App/ConnectedApp/Sessions/createSessionWorkspace.ts),
[Composer callbacks](../apps/desktop/src/renderer/components/App/ConnectedApp/Conversation/SessionPane/Composer.tsx),
[editor lifetime](../apps/desktop/src/renderer/components/App/ConnectedApp/Conversation/SessionPane/Composer/PromptEditor.tsx),
[desktop shutdown](../apps/desktop/src/main/index.ts),
[pagehide](../apps/desktop/src/renderer/main.tsx),
and [built-in server port](../apps/desktop/src/main/opencode-worker.ts).

Native API references: [IndexedDB transactions and database lifecycle](https://w3c.github.io/IndexedDB/),
[BroadcastChannel delivery](https://html.spec.whatwg.org/multipage/web-messaging.html#broadcasting-to-other-browsing-contexts),
and [queued file-selection events](<https://html.spec.whatwg.org/multipage/input.html#file-upload-state-(type=file)>).
