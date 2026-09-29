# Automatic worktrees

New Session delegates worktree creation to the connected OpenCode server. See
[Project and new-session flow](new-session-location-ui.md) for the complete flow.

## Base and placement

The helper resolves the registered project directory, asks `vcs.get` for its
reported default branch, and passes `refs/heads/<branch>` to `worktree.create`.
This selects the local branch's current commit. It does not fetch or pull.
OpenCode owns default-branch detection; oc-ui does not maintain a second policy
or fall back to the current branch when no default is reported.

The request specifies strategy `git` and the project root as `from`. It omits
`directory` and `name`, so OpenCode owns placement and naming. Its default parent
is `<OpenCode data>/worktree/<project-id-prefix>`. The built-in Git strategy
creates a detached checkout. The helper resolves the returned location before
creating the session there.

## Ownership and failures

The workspace owns the requests, forwards cancellation through the SDK's
AbortSignal, and waits for owned requests to settle during shutdown. The flow
blocks repeated submission while creation is pending.

Missing default-branch information stops creation. A missing local branch is
reported by OpenCode. Failed or uncertain creation does not trigger automatic
cleanup or recreation. When a created path is known, subsequent failure retains
that path. If session creation fails, retry creates only the session.

Session deletion leaves worktrees on disk and in the server inventory. Worktree
removal is a separate operation.

## Verification

Helper tests cover server-owned branch selection and placement, missing defaults,
request failure, cancellation, shutdown settlement, and retained paths. Flow tests
cover creation errors and session-only retry. Browser acceptance against the pinned
server verifies the local branch commit, default project-specific placement,
detached checkout, and preservation after session deletion.
