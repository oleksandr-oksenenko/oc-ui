# Automatic worktrees

## Current base policy — 2026-09-13

New Session worktrees now start from local `refs/heads/main`. The shell script
still discovers and fetches origin's default branch before creation, then captures
local `main` as an immutable commit. Fetch failure or confirmed timeout uses the
pre-fetch local `main` snapshot and shows "Could not update from origin. Using
local main." Missing local `main` stops creation. Fetch never pulls or moves the
local branch. Existing ownership, cancellation, and retained-worktree recovery
remain in the New Session flow and workspace scope.

This supersedes the origin-only base and cached-origin fallback policy in the
original design and historical verification below.

Status: Implemented for OpenCode `0.0.0-beta-18866`, 2026-09-02. Dependency
upgrade committed as `ee1735a`; feature verification is recorded below.

## Decision

Use the upgraded OpenCode server unchanged. Prepare the destination and fetch
through its shell API, then pass the selected immutable commit directly to
`worktree.create.branch`. OpenCode creates and registers the detached worktree
at that commit. No separate checkout, branch creation, or server extension is
needed.

One local helper hides this sequence from `NewSessionFlow`:

```ts
const created = await createSessionWorktree(
  {
    api: runtime.api,
    onShellExited: runtime.onShellExited,
    isCurrent: () => !closingFlow,
  },
  project.location,
);

if (closingFlow) {
  showRetainedWorktree(created.location);
  return;
}
if (created.fetchError) showFetchError(created.fetchError);
await createSessionAt(project, created.location, created.location);
```

`createSessionWorktree` is an oc-ui helper, not an OpenCode endpoint.
It returns the existing `LocationRef` shape and an optional `fetchError` string.
Its successful return means native creation, any configured startup command,
and location resolution succeeded; the worktree is ready for session creation.
`fetchError` reports a recoverable failure; it is not a failed helper result.
The small completion callback forwards the existing OpenCode event stream;
there is no new server, process manager, session catalog, or background job system.

## Agreed behavior

- Preserve the existing direct-directory/worktree choice. Non-Git projects use
  their directory directly.
- Choose the worktree directory automatically from the connected server's XDG
  environment, following OpenCode's existing storage convention. No path or
  folder-name input, setting, or ordinary-success path display.
- Omit the worktree `name` input and reuse OpenCode's generated names and
  collision handling.
- Discover and fetch origin's default branch before requesting the worktree.
  Capture a commit ID so another fetch cannot change the chosen starting point.
- On discovery/fetch failure, communicate the error and use the previously
  cached origin-default commit. Without that cache, fail without a session.
- Create the worktree detached at the selected commit, then let OpenCode finish
  any configured startup command before creating the session.
  Create no branch on worktree creation or first prompt. Branch creation belongs
  to a later push operation; this feature adds no push UI or Git-command interception.
- After confirmed session deletion, remove worktrees with no remaining known
  sessions, using `force: true`. Child and archived sessions count as usage.
- Keep session deletion successful even if cleanup fails. Show retained paths
  for manual handling. No cleanup queue, automatic cleanup retries, or
  cross-client locks.

## Existing implementations and verified contracts

| Existing piece                                          | Use in the revision                                                                           |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `api.shell.create/get/output/remove` and `shell.exited` | Run preparation on the connected server and collect its result.                               |
| `api.worktree.create`                                   | Generate the directory name, create the detached worktree, and register it.                   |
| `api.worktree.list/remove`                              | Registered inventory and forced cleanup.                                                      |
| `NewSessionFlow.createSessionAt`                        | Optimistic admission, acknowledgment recovery, and session-only retry.                        |
| `createSessionCatalog` and `workspace.syncCatalog`      | All-page enumeration, hydrated upstream sessions, mutation replay, and active-status refresh. |
| `sessionSubtreeIDs` and workspace removal               | Descendants, drafts, expansion, and surviving-session selection.                              |
| `@opencode-ai/ui/toast`                                 | Persistent errors with existing dismissal and accessibility behavior.                         |
| `createOpenCodeEventSource`                             | Forward shell completion without opening another event connection.                            |

The exact creation input requires `projectID`, `strategy`, and `directory`,
with optional `from`, `branch`, and `name`. `from` selects the registered source
repository; `branch` selects the starting ref or commit. Despite its name,
`branch` does not create a branch with the built-in Git strategy. The server runs
`git worktree add --detach -- <directory> <branch-or-HEAD>` and registers the
result. Always pass our captured commit ID; omitting `branch` would use source
HEAD. The response is still only `{ directory }`.

```ts
const { directory } = await api.worktree.create({
  projectID,
  strategy: "git",
  from: sourceRoot,
  directory: automaticParent,
  branch: selectedCommit,
});
```

`vcs.get`, `vcs.base`, and `vcs.branches` are read operations. Base inference
can use reflog or local default-branch heuristics, so it does not express our
origin-only fetch/fallback policy. None of these endpoints fetches or checks
out a ref. `worktree.refresh` reconciles registered directories; it is not a
Git fetch. No extra VCS or refresh calls are needed for creation.

The server's `Global.data` uses `$XDG_DATA_HOME/opencode`, falling back to
`$HOME/.local/share/opencode`. Its TUI already chooses `Global.data/worktree`.
The existing HTTP creation endpoint needs that parent supplied explicitly.

Shell creation accepts `command`, optional `cwd`, required `timeout` in
milliseconds, and optional metadata; location is a separate query context.
The server chooses the shell and environment. Results contain authoritative
location context and shell information. Output is combined stdout/stderr,
paginated by byte cursor. There is no shell-executable or environment override
in the public request. The Solid data layer tracks shells but supplies no
command-execution/wait helper to reuse.

Worktree endpoints are global and cannot accept a logical workspace ID.
Ordinary local or remote server filesystems can use them; a logical workspace
behind a server cannot silently be treated as that server's filesystem.

## Creation sequence

Keep all preparation policy in one new module,
`apps/desktop/src/renderer/opencode/create-session-worktree.ts`. Private command
construction, completion waiting, and output decoding belong there. Export only
the session-worktree operation and the minimal error information its caller needs.
Use upstream API and location types rather than parallel request models.

1. **Resolve and inspect.** Preserve the supplied location context and use the
   existing location API to obtain its project ID and actual root. Reject
   unsupported workspace routing before mutation. Check shell capability, then
   run one preparation script that reads the XDG destination and cached
   origin-default commit. A missing cache is allowed at this stage.
2. **Fetch.** In that same script, discover origin HEAD with
   `git ls-remote --symref origin HEAD`, validate its branch ref, fetch that
   branch into `refs/remotes/origin/<branch>`, and resolve its commit ID. Update
   `refs/remotes/origin/HEAD` only after successful fetch. Do not guess main/master,
   use the source checkout's branch, or select unrelated `FETCH_HEAD`.
3. **Choose the commit.** On success use the fetched immutable ID. On a confirmed
   discovery/fetch failure use the cached ID captured before the attempt and
   retain the fetch error for presentation. If no cached ID exists, stop before
   worktree creation. The script emits the cached snapshot before fetching, then
   its final result. Both use three fixed fields: hex-encoded destination,
   commit ID, and hex-encoded diagnostic. Only a confirmed successful command
   may select the final record; a confirmed timeout uses the cached snapshot.
   Hex encoding preserves whitespace and newlines without requiring a JSON
   encoder on the server.
4. **Create through OpenCode.** Call the API above with the resolved project,
   registered source root, automatic parent, and `branch: <validated-commit-id>`.
   Omit `name`. Wait for successful completion, including any server-configured
   startup command. Keep the returned directory immediately for failure reporting.
   Native creation owns checkout, naming, and registration; do not duplicate
   those operations or add a post-creation checkout/verification shell.
5. **Resolve and create the session.** Resolve the returned directory through
   OpenCode, preserving its authoritative location context. Emit any fetch error
   through the persistent upstream toast and reuse `createSessionAt`. If location
   resolution fails, retain the created directory and report it for manual
   recovery; do not create a session. Never checkout, reset, pull, or stash the
   source directory.

Use `<server XDG data>/opencode/worktree` as the parent, falling
back to `<server home>/.local/share/opencode/worktree`, matching the TUI convention.
Ignore a relative XDG value as required by the XDG specification. Construct and
validate the path in the server shell; do not use Electron's home directory,
platform rules, or environment. The final canonical directory comes from the
worktree API. The existing `serverPath` module remains for ordinary navigation.

The helper needs only a small, explicitly framed machine-readable result from
its scripts. Capture Git diagnostics separately from that result, consume all
output pages, and validate required fields and the commit ID before using them.
The cached symbolic ref must point under `refs/remotes/origin/` and resolve to
a commit. Encode variable text fields in an ASCII-safe form so arbitrary paths
and the API's byte-based pagination cannot corrupt the result.
Use shell-safe argument encoding, never string interpolation of unchecked paths
or branch names. No server-side Node/Python installation, script deployment,
or new package dependency should be assumed.

The first checkout is already detached at the chosen commit. Keep Git's normal
hooks and filters enabled. After registration, OpenCode runs the project's
configured `commands.start` through `bash -lc` in the new worktree, supplying
`OPENCODE_WORKTREE_BASE` and `OPENCODE_WORKTREE_PATH`, and waits for success
before returning. Do not run this command again in oc-ui or reset its changes.
The selected commit is the starting point before user-configured hooks/startup
commands; those commands remain free to modify their checkout. The usual path
with no custom command starts the session detached at the selected commit.

A startup-command failure can leave a registered worktree even though creation
returned an error. The error does not guarantee a created-directory field.
Retain an authoritative path if one is available; otherwise explain that a
worktree may remain and require manual inspection. Do not infer ownership from
new inventory entries, remove an unknown directory, or retry creation
implicitly. This replaces the previous post-checkout rollback path.

### Shell and location support

The helper first runs a harmless, portable probe and inspects the returned
`ShellInfo.shell`. Use one POSIX script implementation for sh, bash, dash, ksh,
and zsh. Do not send that syntax to an unknown shell. Check the actual returned
shell, including any plugin changes, rather than assuming a platform default.

The Windows artifact can select Git Bash through its existing configuration,
but can also prefer PowerShell or cmd; the shell API cannot override that choice.
Git Bash needs explicit POSIX/native path conversion, including XDG and UNC
paths, verified on a Windows server before enabling this flow there. This
revision does not add PowerShell/cmd implementations or reconfigure the server's
shell. Unsupported shells return a clear error and leave direct-directory
sessions available. The live proof is macOS; Windows support remains a required
platform verification gate, not a claim based on the Darwin binary.

Reject nonempty logical workspace IDs for automatic worktree creation with
this pin. The existing global worktree API cannot preserve their filesystem
scope. Never substitute a local path or drop the workspace ID to make a call
succeed. This restriction does not exclude connecting to another machine's
ordinary OpenCode server filesystem.

## Completion and failure handling

Use the existing flow as the single owner, with one sequential operation in
flight. Keep `creating-worktree` across inspection, fetch, native creation
(including startup), and location resolution; do not add UI phases or another
form. Retain dismissal blocking during mutation. Every active preparation
shell has a server timeout; UI teardown must not start a
session or replay creation while the preceding operation is unresolved.

The exact pinned shell implementation sets its status to `timeout` before it
finishes killing the process. `shell.exited` is published after the termination
attempt and output drain. Therefore polling `status !== "running"` alone is
insufficient for timeout fallback or cleanup.

Expose one narrow `onShellExited` subscription through `ConnectedRuntime`,
backed by the existing event bridge. Subscribe before creating the shell and
buffer completion events until the create response supplies its shell ID;
consume the matching buffered event if it already arrived. Keep this buffer
only for the current request, not in a shared registry. Release the
subscription when the operation settles. Its lifetime follows the operation,
not the dialog mount; check that the flow still owns the action before starting
each subsequent mutation. Use a 30-second server command timeout and one
40-second client deadline covering shell creation, completion, output reads,
and cleanup through the SDK abort signal. Require the completion event before
progressing after a server command timeout. A client deadline reports an unknown
outcome and does not trigger cached fallback. `shell.remove` removes
records/output and does not itself terminate a running process; call it only
when execution is settled and its output has been collected. Do not add another
SSE connection or treat a client HTTP timeout as process cancellation.

If a disconnect loses the completion evidence, an ambiguous mutation must not
trigger fallback, session creation, worktree removal, or automatic recreation.
Report that completion could not be confirmed and retain any known directory
for manual recovery. A normal failed fetch with confirmed completion still
uses the cached commit. This is an uncertainty case, not a reason to add a
persistent recovery service.

Check the flow's existing `closingFlow` guard again after helper completion and
before calling `createSessionAt`. If ownership ended after worktree creation,
do not start a session: surface the retained directory through the root toast.
Use the same retained-path error when the helper stops between mutations.
Do not depend on a dialog-local message after that dialog has unmounted.

| Failure                                              | Result                                                                                                                                        |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Unsupported shell/location or inspection failure     | Error before worktree creation; keep direct-directory sessions available.                                                                     |
| Origin discovery/fetch failure with cached commit    | Continue and show the fetch error once.                                                                                                       |
| Origin discovery/fetch failure without cached commit | Error; create neither worktree nor session.                                                                                                   |
| Native creation or startup command fails             | Create no session. Report the actual failure and possible retained worktree, including its path if known. No automatic removal or recreation. |
| Location resolution fails after creation             | Create no session; report the known retained path for manual recovery.                                                                        |
| Shell completion or creation response is uncertain   | Do not mutate further. Report uncertainty and any known path.                                                                                 |
| Ready worktree's session creation fails              | Preserve the worktree and reuse the existing session-only retry.                                                                              |

A worktree is eligible for session-only retry only after native creation and
location resolution succeed. No second checkout, checkout retry mode, or
preparation rollback remains. If session creation fails, keep the existing path
in its failure view and a persistent retained-worktree notification. Dismiss
that notification when session-only retry succeeds.

## Renderer changes

- Collapse `NewSessionDialogState` to project selection and direct/worktree
  choice. The existing submit action starts the helper without another form.
- Remove the intermediate `step`, parent location, folder name, path preview,
  and form-only validation. Delete `NewSessionDialog/WorktreeForm.tsx` and only
  its unused styles/stories. Keep Add Project's directory browser unchanged.
- Wire the helper through the flow's existing narrow runtime dependency shape.
  Keep preparation errors distinct from session errors so retry cannot start
  a session in an unprepared checkout.
- Mount one upstream `Toast.Region` at the application-level provider, outside
  conditional modal content. Use `showToast({ persistent: true, ... })`; add no
  notification store or new toast component.
- Show fetch fallback as: "Could not update from origin. Using the last fetched
  default branch." It survives session creation failure or dialog closure and
  is not repeated by session-only retry.
- Keep fatal server errors meaningful and show retained directories only in
  failure/recovery messages.

## Last-session cleanup

### Scope and identity

Cleanup runs only as part of this app's confirmed session-deletion flow. Do not
start destructive cleanup from generic SSE events or from finding a worktree
with no sessions during startup. In particular, a worktree left by failed
session creation remains available for the existing session-only retry.

Use server session records and registered worktrees, scoped to this connected
server and full workspace context. Account for every location in the deleted
subtree, rather than only the selected parent's directory. A primary checkout
is never a cleanup candidate. A remaining archived, independent, or child
session counts as usage just like any other session.

For each stored session `projectID`, call `worktree.list` once per deletion.
From its registered entries, choose the deepest directory containing the session's
stored path, then require the `git` strategy. An unregistered directory, primary
entry, or non-Git entry is not a candidate. Deduplicate candidates by project ID
and registered directory. After deletion, compare remaining sessions' stored
paths against each candidate root and its descendants, regardless of project ID.

Do not resolve session locations during cleanup. In the pinned server,
`location.get` can persist a project for a missing directory before returning an
error. `worktree.list` only reads registered rows. Path comparisons normalize
trailing separators and Windows separators, but do not resolve symlink aliases;
sessions created by other clients with aliased paths can evade this usage check.

For the global worktree API, only use candidates whose locations are confirmed
to belong to that server filesystem. A nonempty workspace ID without supported
worktree routing means manual cleanup, not permission to call the global remove
endpoint with the same path. A failed worktree listing preserves affected paths
and produces a cleanup notice.

Do not persist a reference count. Keep a short-lived deduplicated list of
candidate worktree locations for one deletion. Preserve the original
server-returned paths for API requests and error messages; do not manufacture
paths with the Electron host's path library.

### Operation order

1. Keep the existing confirmation. Explain that unused worktrees may also be
   removed, including uncommitted changes. Remove the inaccurate blanket claim
   that a branch is deleted: these worktrees normally have no branch, and Git
   worktree removal is not branch deletion.
2. At confirmation, call the existing `workspace.syncCatalog()` to refresh
   all session pages and active statuses, then derive the
   selected subtree and candidate worktrees from current server records. Reuse
   the existing running-session check. If session/worktree association cannot
   be established, preserve the affected worktree rather than treating unknown
   data as zero users. If catalog/active-status refresh itself fails, keep the
   confirmation open with a retryable error before sending session deletion.
3. Call `session.remove`. On failure, preserve the existing retry behavior and
   do not attempt worktree removal. Handle externally confirmed deletion using
   the existing removed-session behavior and the captured candidate locations.
4. After confirmed session deletion, immediately apply `onDeleted(subtreeIDs)`
   to the catalog, drafts, expansion state, and selection. This must not wait
   for worktree cleanup to succeed.
5. Refresh the catalog after deletion and check remaining usage for each unique
   candidate. Skip candidates still used by another session. If this refresh
   fails or records are incompletely hydrated, skip affected cleanup and report
   the retained paths. The accepted cross-client race after this check remains.
6. Attempt each unused candidate once through
   `api.worktree.remove({ projectID, directory, force: true })`. Collect failures
   while allowing other candidates to complete. Do not separately delete a Git
   branch, recursively delete folders, or escalate a failed removal.
7. Close the flow after processing results. Show a persistent error with the
   failed/retained paths and the fact that the session was deleted. The user
   handles these manually. Remove the current "Finish deletion" cleanup retry
   state and button.

Keep this sequencing in the existing deletion flow and its owner. At most one
small private helper should own worktree identity and remaining-usage checks;
do not create a lifecycle manager or a second session catalog.

Expose the existing workspace refresh through the flow's narrow props. Use
upstream `SessionInfo`, `WorktreeDirectory`, and `WorktreeRemoveInput` types.
Candidates are removal inputs; do not add a separate identity wrapper.

## Change map and implementation order

1. Add the local preparation helper and the narrow completion-event callback.
   Verify its scripts against the unchanged pinned server in isolated state.
2. Simplify the creation dialog and wire the helper into `NewSessionFlow`.
   Preserve direct-directory creation, Add Project, and session-only retry.
3. Add the upstream toast region and failure messages.
4. Complete last-session cleanup in `createSessionFlows`, `SessionFlowsRegion`,
   `DeleteSessionFlow`, and `DeleteSessionDialog`.
5. Update affected tests, stories, `docs/new-session-location-ui.md`,
   `docs/session-deletion-design.md`, and `docs/component-inventory.md`.

The dependency upgrade is complete. No further OpenCode source changes,
dependency changes, compatibility relaxation, Electron IPC, or worktree
persistence are needed. Changes to `ConnectedRuntime` are limited to forwarding
the existing shell completion event. The creation
helper is the only new policy module; cleanup stays with its current flow.

## Verification

Test the helper with a non-main default branch, source HEAD different from
default, advanced origin commit, renamed default, custom/unset/relative XDG,
spaces and shell metacharacters in paths, generated names, detached HEAD, and
unchanged dirty source. Cover discovery/fetch failure with and without cache,
output pagination, fast completion before the create response, timeout status
before the completion event, and disconnected/ambiguous completion. Assert
that native creation receives the exact selected commit, not a moving branch
ref, and that no post-creation checkout runs. Cover invalid-ref rejection,
startup success/failure, retained-path reporting, and location-resolution
failure without a session or automatic removal. A startup fixture should
observe the chosen commit from its first invocation. Do not claim platform
support from a different host's test.

Renderer coverage should verify no directory/name input, one operation per
submit, persistent fallback errors, no session before native creation and
location resolution succeed, session-only retry, shared worktree preservation,
descendants in multiple
worktrees, archived sessions, workspace identity, incomplete refresh, and
session finalization despite partial cleanup failure. Reuse existing catalog
pagination/reconciliation and dialog tests rather than duplicating them.

After implementation run repository-root `pnpm check` and `pnpm test`, fix
all findings, and verify Storybook plus the actual Electron app. Exercise first
open/reopen, narrow and resized layouts, scrolling, empty/error and loading
states, keyboard/Escape, focus restoration, and sidebar collapse/remount.
Verify notifications remain readable and dismissible after their flow closes.

## Implementation verification — 2026-09-02

- Repository-root `pnpm check`, `pnpm test` (71 files, 457 tests), and
  `pnpm build` pass with the declared pnpm `11.23.0`.
- An isolated beta `18866` server and the actual Electron app verified an
  automatically named XDG worktree, detached at a freshly fetched non-main
  default branch. The source remained on its different branch with dirty files
  unchanged. No prompt or branch was created.
- Confirmed fetch failure used the cached commit and showed a persistent error.
  The missing-cache case created no session. Startup success observed the
  selected commit; startup failure kept its registered worktree, created no
  session, and showed manual-recovery guidance.
- Actual app deletion kept a worktree used by another session, removed it after
  its last session was deleted, and reported a locked worktree for manual cleanup
  while completing session deletion. The failed removal was not retried.
- Electron checks covered first open and reopen, resizing, busy/disabled controls,
  Escape blocking while busy, error focus and close-focus restoration, sidebar
  collapse/remount, and persistent notifications after the dialog closed.
  Storybook checks covered narrow layouts, long paths, picker search/empty
  results, loading/empty projects, and retained-worktree retry content.
- The static review's completion-status and location-validation findings were
  fixed and covered by focused regression tests. Windows remains unsupported
  for automatic creation; verification used macOS/zsh. Direct sessions remain
  available on unsupported server shells and locations.

## Research evidence

The dependency upgrade is committed as `ee1735a`. This revision checked the
installed beta `18866` client declarations and worktree, VCS, and shell schemas
in this checkout, plus the exact Darwin ARM64 binary's embedded implementation.
The binary SHA-256 is
`57662acc39c1436358f16d486686feb5373f5eaf36c966977b4f2417ed0970db`.
Verified source includes Git detached creation (byte 68528344), shell lifecycle
(73724471), VCS default heuristics (77845601), and worktree creation/registration
and startup ordering (77877960). Public shell creation still cannot select an
executable or override the environment.

The existing flow, catalog, and location integration findings come from the
prior graph/source exploration of this worktree. The graph project is
`Users-alex-.codex-worktrees-be1d-oc-ui`; it was confirmed ready for this revision.
Dependency packages and documents were inspected directly. No fresh exhaustive
application-code audit is claimed for this API-focused revision.

The earlier beta `18155` probe established XDG inspection, origin fetch,
cached-default fallback, and missing-cache rejection using isolated server
state. Its second checkout is superseded by the beta `18866` creation contract.
The old Windows binary inspection is historical evidence only; the upgraded
Windows flow still needs platform verification before enabling it.

The upgrade evaluation's isolated beta `18866` probe verified direct detached
creation at both a full commit ID and `origin/trunk`, generated names, unchanged
dirty source files, invalid-ref rejection, registration/listing, session
create/get/delete, and forced removal. Probe: `/tmp/ocui-beta18866-probe.py`.
Implementation verification also exercised startup success and failure against
the pinned server: the command observed the selected commit; failure left a
registered worktree and returned an error without its directory.

The upgrade itself passed root checks, all 467 tests, and production build,
including a rerun in this checkout with pnpm `11.23.0`. Those earlier results validate the dependency adoption. Feature validation
is recorded separately below.

Primary library references:

- [Pinned client types](https://unpkg.com/@opencode-ai/client@0.0.0-beta-18866/dist/promise/generated/types.d.ts)
- [Pinned worktree schema](https://unpkg.com/@opencode-ai/schema@0.0.0-beta-18866/dist/worktree.js)
- [Pinned VCS schema](https://unpkg.com/@opencode-ai/schema@0.0.0-beta-18866/dist/vcs.js)
- [Pinned shell schema](https://unpkg.com/@opencode-ai/schema@0.0.0-beta-18866/dist/shell.js)
- [Pinned UI toast](https://unpkg.com/@opencode-ai/ui@0.0.0-beta-18866/src/feedback/toast/toast.tsx)
- [Git origin HEAD discovery](https://git-scm.com/docs/git-ls-remote)
- [Git fetch and remote-tracking refs](https://git-scm.com/docs/git-fetch)
- [Git remote HEAD convention](https://git-scm.com/docs/git-remote)
- [Git worktree creation and removal](https://git-scm.com/docs/git-worktree)
- [XDG directory defaults and absolute paths](https://specifications.freedesktop.org/basedir/latest/)
