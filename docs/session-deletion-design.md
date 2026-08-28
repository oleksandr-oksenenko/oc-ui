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
cannot be undone, and says how many child sessions will also be deleted. The destructive request is
sent only after confirmation.

When the session belongs to an OpenCode-managed git worktree, the same confirmation also names that
worktree and states that its uncommitted changes and branch will be deleted. After OpenCode removes
the session subtree, the application calls `worktree.remove` with `force: true`. There is no second
confirmation. Sessions in the primary checkout do not trigger worktree removal.

While deletion is in progress, the dialog cannot be dismissed. A failed request leaves the session
and its drafts untouched and keeps the dialog open for retry. A successful request removes the
deleted subtree from the catalog and clears its in-memory drafts. If the selected session was deleted,
the existing selection policy chooses the nearest surviving ancestor and otherwise the newest
remaining session.

## Why delete is not optimistic

The session remains visible until OpenCode confirms the request. Removing it first would make a
temporary connection failure look like data was deleted when it was not. Live `session.deleted`
events still reconcile deletions made by other clients.

Session removal happens before worktree removal. This keeps a worktree intact if the session request
fails. If the session is removed but worktree cleanup fails, the dialog stays open and retries only
the worktree operation.

## Archive follow-up

Archive should be reversible and should preserve the transcript. Once the pinned client supports it:

1. Add archive and unarchive through that typed client contract.
2. Hide archived sessions from the normal list.
3. Add one Archived Sessions view where they can be restored or permanently deleted.
4. Keep permanent deletion behind the same confirmation used here.

Until all four pieces exist, exposing archive would create sessions that this application cannot find
or restore.
