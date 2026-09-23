# Session deletion

## OpenCode capability

The OpenCode client pinned by this repository exposes
`session.remove({ sessionID })`. It sends `DELETE /api/session/:sessionID` and returns only after the
server accepts the deletion. OpenCode deletes the selected session and its child sessions, and
publishes `session.deleted` events so connected clients can clear their local state.

OpenCode also has an archival state in its session model, and its current API design describes
archival through a session update. The pinned generated client does not expose an archive or generic
session-update method. This application should not bypass that client with a hand-written request.
Archive can be added when it has a supported typed contract, along with an Archived Sessions view and
an unarchive action.

Sources:

- [OpenCode session API](https://github.com/anomalyco/opencode/blob/dev/specs/v2/api.html)
- [OpenCode server API reference](https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/server.mdx)

## User flow

Each session row ends with a small trash button. The button is disabled while disconnected or while
the session, or any child below it, is running.

Selecting the button opens a confirmation dialog. The dialog names the session, states that deletion
cannot be undone, says how many child sessions will also be deleted, and sends the destructive
request only after confirmation.

At confirmation, the application refreshes the full session catalog and active statuses, requires
every catalog record to be loaded, checks the selected subtree again, and sends `session.remove`.
The session remains visible until OpenCode confirms the request.

Deleting a session never deletes a worktree. Registered worktrees stay on disk and in the server's
inventory after their sessions are gone, so uncommitted work is preserved. This matches OpenCode
Desktop v2 (2.0.13), where session deletion is sessions-only and worktree deletion is a separate,
explicit action with its own checks. Removing a worktree requires the user to run
`git worktree remove` on the connected server, or a future worktree-management surface. This
application performs no automatic cleanup, no startup inventory scan, and no cleanup queue.

After confirmed removal, the application immediately clears the deleted subtree and its drafts.
There is no branch deletion, no worktree cleanup, and no second confirmation.

While deletion is in progress, the dialog cannot be dismissed. A failed request leaves the session
and its drafts untouched and keeps the dialog open for retry. A successful request removes the
deleted subtree from the catalog and clears its in-memory drafts. If the selected session was
deleted, the existing selection policy chooses the nearest surviving ancestor and otherwise the
newest remaining session.

## Why delete is not optimistic

The session remains visible until OpenCode confirms the request. Removing it first would make a
temporary connection failure look like data was deleted when it was not. Live `session.deleted`
events still reconcile deletions made by other clients.

Session deletion is the only mutation in this flow. Worktree removal is intentionally decoupled: the
pinned server's `worktree.remove` runs `git worktree remove --force` synchronously inside the HTTP
request, which takes seconds to tens of seconds for worktrees that contain installed dependencies.
Keeping it out of session deletion keeps confirmation fast and never discards uncommitted changes as
a side effect of deleting a session. No post-deletion catalog refresh is needed; local removal plus
the server's `session.deleted` events already reconcile the list.

## Worktree management follow-up

OpenCode Desktop v2 exposes worktree deletion as an explicit Settings action with pre-flight checks
(`vcs.status`, branch diff, and sessions whose location is inside the worktree) that keep `active`,
`linked`, and `dirty` worktrees unless the user force-confirms. If this application adds worktree
management later, it should reuse the pinned client's `worktree.list/remove` contracts and those
guards rather than reintroducing cleanup into session deletion.

## Archive follow-up

Archive should be reversible and should preserve the transcript. Once the pinned client supports it:

1. Add archive and unarchive through that typed client contract.
2. Hide archived sessions from the normal list.
3. Add one Archived Sessions view where they can be restored or permanently deleted.
4. Keep permanent deletion behind the same confirmation used here.

Until all four pieces exist, exposing archive would create sessions that this application cannot find
or restore.
