# Project and new-session flow

This renderer flow uses the connected OpenCode server as the source of projects,
directories, worktrees, and sessions. It never opens an Electron host file picker.

## Component stack

`ConnectedApp` opens one `NewSessionFlow`. The flow controller owns the short-lived
form state and the OpenCode mutations. It renders either `NewSessionDialog` or
`AddProjectDialog`.

`ServerDirectoryBrowser` is the shared server-filesystem component. It calls
`file.list` with the absolute open server directory as its location and `.` as its
relative path. Child and parent navigation first derive another absolute server
location, then re-root the next listing there. One server-path module owns POSIX,
Windows-drive, and UNC path operations; the Electron host's path rules are never
used. The browser reports a location only after that location lists successfully.
It preserves server workspace scope across browsing, project lookup, and session
creation. It owns loading, listing errors and retry, stale-request protection,
and the `..` parent entry.

Add project starts at the server's exact default location. It does not infer a
home directory from the server path.

The dialogs own modal behavior, accessible focus, keyboard handling, fields, and
mutation presentation. They do not repeat server transactions.

## Add project

The open folder in `ServerDirectoryBrowser` is the selected project directory.
`NewSessionFlow` registers it through `project.current`, refreshes the shared
project data, selects the returned project, and returns to the new-session dialog.

Adding a project does not ask about worktrees. Add-project errors preserve the
open folder. While the request is running, the dialog cannot be dismissed or
submitted again. While a directory is loading, submission is disabled so the
previously open folder cannot be selected by mistake.

## New session

The project list comes from the runtime project data. A non-Git project creates a
session directly in its canonical directory. A Git project offers:

- **Use the project directory**: commands and changes happen directly in the
  project directory on the connected server.
- **Create a worktree**: choose a server parent directory and required folder
  name, then create an isolated detached Git worktree.

The worktree request uses the pinned client contract with strategy `git`, the
project directory as `from`, and the chosen parent and name. Session creation uses
the directory returned by the server, not the path preview.

Mutation phases are `creating-worktree` and `creating-session`. During either
phase, dismissal and repeat submission are blocked. If worktree creation fails,
the inputs remain available for retry. If session creation fails after the
worktree exists, its returned path is retained and retry creates only the session;
the renderer does not delete the worktree.

Created sessions are admitted to the shared catalog immediately. A definite
create failure removes the optimistic catalog entry. If a server event already
acknowledged the session before the request failed, that session is kept and
selected instead of creating a duplicate on retry. The sidebar catalog contains
every top-level server session, independent of directory.

The created session's `SessionInfo.location` remains the location authority. The
flow does not create a second mutable session-location model.

## Storybook coverage

Stories cover server browsing, loading and listing/add-project failures; project
loading, failure and empty states; Git and non-Git direct choices; the worktree
form and path preview; both mutation phases; validation; worktree failure; direct
session failure; and session failure after a worktree exists.
