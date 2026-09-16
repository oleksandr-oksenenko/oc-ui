# Product requirements and first-slice design

Status: milestone 1 historical design, with the current host and transport requirements below.

## Current host and transport requirements

Ocui supports Electron and Chromium browser hosts using the same renderer and
OpenCode client/store. The current pinned protocol is `2.0.3`.
Desktop retains its built-in server and remote connection; browser mode connects
to an independently managed server. Browser mode supports local serving and static
HTTPS hosting, with configurable UI base paths and root-origin APIs.

Both hosts accept HTTP and HTTPS server origins. HTTPS browser pages require an
HTTPS endpoint, including for loopback. The operator supplies certificates, TLS
termination, authentication, and server CORS permission for the UI origin.
Browser settings store only the last successful address. Passwords remain in the
current page; reload and new tabs require explicit Connect. Storage failures must
permit manual connection and must not tear down an established workspace.
Desktop retains secure password storage. Each page owns its workspace lifetime;
closing it does not stop the independent server or replay uncertain mutations.
See [Browser mode](browser-mode-design.md) for the complete current contract.

The remaining sections record the original milestone 1 scope. Later implemented
features and runtime ownership are described in their milestone documents and
the current source; old first-slice deferrals do not prohibit browser mode.

## Product direction

Ocui is a desktop and browser client for OpenCode. It is a place to
experiment with coding-agent interfaces while keeping OpenCode responsible for
agent execution and server-side state.

The long-term direction is to expose OpenCode capabilities when they become
useful in the desktop UI. These may include projects, worktrees, diffs, review
comments, tools, permissions, forms, todos, usage, costs, and other features.
That direction does not enlarge the first slice.

## First-slice outcome

A user can connect an Electron app to one authenticated OpenCode server, choose
or create a session, read its transcript, and send a text prompt while the
assistant response streams into the transcript.

The slice deliberately supports one exact protocol version:
`0.0.0-beta-18155`.

The connection is local-first. On startup the desktop app attempts to start a
managed loopback OpenCode sidecar from the pinned CLI. If that sidecar cannot
start or fails health/version validation, the user can connect to a remote
OpenCode server with the same client. The app does not expose a directory
picker in this slice: both local and remote connections use their server's
default directory.

## Agreed product decisions

- Build and run the flow inside Electron from the start.
- Prefer one managed local OpenCode sidecar over loopback, with one existing
  remote OpenCode server as the fallback connection.
- Support the Basic authentication used by the standard OpenCode server. The
  username is `opencode`; the user supplies the password.
- Require OpenCode CLI, client, UI, and server version `0.0.0-beta-18155`
  rather than attempting best-effort compatibility with other releases.
- Use SolidJS for the renderer, `@opencode-ai/client/solid` for OpenCode client
  state, and `@opencode-ai/ui` for optional visual primitives.
- Use OpenCode's Promise client under its Solid data layer. Keep Effect for the
  Electron main process and other services instead of maintaining a second
  OpenCode state model.
- Show existing sessions and allow creation of a new session.
- Scope the first picker to top-level sessions in the server's default
  directory.
- Render user text, assistant text, and a simple working state.
- Provide a multiline plain-text composer.
- Keep the composer editable while a session is running, but disable submission
  until it becomes idle.
- Save a successful connection automatically and reconnect on startup when its
  password was securely persisted.
- Treat message history as authoritative and the global event stream as a
  volatile source of live updates.
- Own the managed sidecar's process lifecycle: start it only for the local
  connection, keep it on loopback, avoid logging credentials, and stop it on
  app shutdown or connection change.

## User flow

1. Open the Electron app.
2. The app starts a managed local sidecar and verifies its health and exact
   version.
3. If local startup fails, enter an OpenCode server URL and password, or reuse
   a securely saved remote connection.
4. Connect and verify the server health and exact version.
5. See a flat, recent-first list of sessions.
6. Select an existing session or create a new one.
7. Read the selected session's complete transcript.
8. Enter and send a text prompt.
9. See the admitted user message and streaming assistant text.
10. Continue using the selected session after a temporary disconnection and
    resynchronization without duplicated transcript entries.

## Visible interface

The first slice has three main areas:

- A connection form and connection-state indicator.
- A recent-session sidebar with a **New Session** action.
- A selected-session transcript with a multiline composer at the bottom.

The connection state is one of:

- `disconnected`
- `connecting`
- `connected`
- `reconnecting`
- `failed`

The transcript renders only:

- User text.
- Assistant text, including text received incrementally.
- A simple indication that the selected session is working.

Tool calls, reasoning, permissions, forms, and unfamiliar content do not get a
specialized or generic UI in this slice. Complete OpenCode message records are
retained internally so later projections do not require changing the transport
boundary.

## Electron, Solid, and Effect design

### Chosen frontend stack

The renderer uses:

- SolidJS for components and reactivity.
- `@opencode-ai/client/solid` for connection state, API-backed caches, optimistic
  session and prompt admission, message pagination, and server-event
  application.
- `@opencode-ai/ui` for optional OpenCode visual primitives, styles, themes,
  icons, and assets.

The OpenCode UI package does not determine screen layout. Session lists,
session trees, timelines, cards, and other experimental presentations remain
application-owned projections over the same Solid data.

The Solid client is built on OpenCode's Promise client. The renderer does not
also run the Effect client or maintain a parallel reducer for OpenCode state.
Effect remains the service model for Electron main-process work and other
non-OpenCode application services.

### Process ownership

The Electron main process owns:

- The Effect runtime.
- Window, application, and desktop lifecycle.
- The managed local OpenCode sidecar: CLI resolution, startup, health/exit
  monitoring, and shutdown.
- Context isolation and the narrow preload boundary.
- Connection-setting and encrypted credential persistence.

The renderer owns:

- The authenticated OpenCode Promise client.
- `createClientConnection` and its event-stream reconnect loop.
- The event source consumed by `createData`.
- The `createData` Solid store and its API-backed caches.
- Session loading, selection, and presentation state.

The sidecar is a supervised child process, not a second OpenCode
implementation. The main process resolves the CLI from the desktop package,
which pins `0.0.0-beta-18155`; it does not depend on a globally installed
command. A sidecar failure is surfaced as a local connection failure so the
user can use the remote fallback.

The preload script exposes only target settings and the managed-sidecar
connect, disconnect, and unavailable-notification operations. Electron runs
with context isolation enabled and Node integration disabled in the renderer.
The packaged renderer is served from `oc://renderer`, an origin explicitly
accepted by the supported OpenCode server. Renderer sandboxing remains enabled.

```text
Solid renderer
      | OpenCode Promise client, client/solid, and opencode UI
      | authenticated HTTP and SSE
      v
OpenCode server

Electron main process and Effect runtime
      | narrow settings and credential IPC
      v
Solid renderer
```

### Application-facing API

Presentation code consumes the Solid data layer rather than wrappers that
mirror every OpenCode endpoint. The normal calls are:

```ts
data.session.list();
data.session.create({ location });
data.session.sync(sessionID);
data.session.message.sync(sessionID);
data.session.message.loadMore(sessionID);
data.session.prompt({ sessionID, text });
```

Connection setup owns API construction, authentication headers, the event
source, and reconnection. Individual visual components receive selected data
and actions through application contexts; they do not construct clients.

`data.session.list()` is a cache read, not a network operation. The application
hydrates it with paginated `api.session.list(...)` calls followed by
`data.session.remember(...)`. A small application-owned catalog retains only
the IDs in the current server snapshot so deletions missed during disconnection
can be reconciled without duplicating OpenCode session state.

### Authentication and persistence

The renderer's OpenCode client adds Basic authentication to every OpenCode
request, including the global event stream.

Basic authentication does not encrypt credentials in transit. With a plain
HTTP URL, the password is protected only by the surrounding network or tunnel.
Both hosts now accept HTTPS origins. Certificate and TLS configuration belong to
the server operator; an HTTPS browser page requires an HTTPS server endpoint.

The server URL may be stored as ordinary application data. The password is
encrypted with Electron's secure-storage facility before it is persisted. If
secure encryption is unavailable, the password remains in memory for the
current process and the app asks for it again after restart. There is no
plaintext password fallback.

The renderer necessarily receives the decrypted password when constructing its
authenticated client. It is kept in the client closure only and is not placed
in Solid application state, rendered into the DOM, or written to logs. This is
an explicit tradeoff of reusing OpenCode's renderer-side Solid client.

For the managed local sidecar, the server binds to loopback. Its generated
password is excluded from logs and saved target settings. OpenCode service mode
necessarily keeps it in the app-private registration file while the child is
running; that file has owner-only permissions and is removed when the service
stops. The password is passed transiently to the existing renderer client.
Replacing the local connection or closing the app stops the child process so a
stale server and registration file are not left behind.

### Version boundary

Connection begins with `health.get()`. The connection is accepted only when the
server reports version `0.0.0-beta-18155`. A different version produces a clear
compatibility error before session state or the event stream is used.

This explicit pin is necessary because the generated client and its event
schema can change between OpenCode beta releases.

The workspace catalog is the package-installation authority for
`@opencode-ai/cli`, `@opencode-ai/client`, and `@opencode-ai/ui`. Main and
renderer share one runtime protocol-version constant. The CLI is a desktop
runtime dependency so local development and the Electron main process resolve
the same executable.

## OpenCode synchronization model

### Initial connection

After authentication and version validation, the client:

1. Creates an authenticated OpenCode Promise client.
2. Fetches the server's default location with `location.get()`.
3. Starts `createClientConnection`, which attaches to `/api/event` and waits for
   `server.connected`.
4. Publishes stream events to the event source consumed by `createData`.
5. Calls `data.location.syncInfo()` so the Solid store uses the server location.
6. Fetches all top-level sessions for the default directory with the Promise
   API and remembers them in the Solid data store.
7. Calls `data.session.sync(sessionID)`,
   `data.session.pending.sync(sessionID)`, and
   `data.session.message.sync(sessionID)` for the selected session.
8. Calls `data.session.message.loadMore(sessionID)` until the complete history
   required by this slice is loaded.

The event stream starts before session hydration so live events can update the
store while snapshots are loading.

### Reconnection

The global event stream is volatile. Events emitted while disconnected are not
replayed.

After a stream failure, `createClientConnection` changes to `reconnecting` and
establishes a new stream. `createData` invalidates cached reads while the
connection is unavailable. When the stream reconnects, the active session view
syncs its session and message history again before treating hydration as
complete.

The experimental session log is not used. The ordinary beta-18155 CLI server
does not enable durable event-payload persistence, so its session log can
advance a sequence watermark while returning no historical event payloads.

### Transcript reconciliation

`createData` is the authoritative renderer state for OpenCode data. Its internal
Solid reducer applies API snapshots, optimistic prompt admission, pagination,
and live server events using server message identifiers and the active matching
content entry.
The application does not implement a parallel React or Effect reducer.

The first-slice presentation derives this small view from the complete OpenCode
messages returned by `data.session.message.list(sessionID)`:

```ts
type TranscriptItem =
  | {
      readonly kind: "user";
      readonly id: string;
      readonly text: string;
    }
  | {
      readonly kind: "assistant";
      readonly id: string;
      readonly textBlocks: readonly string[];
      readonly state: "streaming" | "complete" | "failed";
    };
```

`data.session.prompt` admits and renders the user message optimistically.
`createData` applies `session.text.started`, `session.text.delta`, and
`session.text.ended` to the assistant message. Assistant completion is derived
from `message.time.completed`, which is updated by the step lifecycle. After
reconnection, message sync reconciles the event-built state with server history
without duplicating message identifiers.

## Session behavior

### Session picker

- Show a flat list ordered by most recently updated first.
- Show top-level sessions from the server's default directory only.
- Show the session title and updated time.
- Show a minimal running indicator when the server reports the session as
  active.
- Do not group by project or worktree.
- Do not include search, rename, archive, delete, fork, or bulk actions.

### New Session

Connection setup obtains the server's default location. New Session calls
`data.session.create({ location })` without an agent, model, or title; the
connected server owns those defaults. The location is always owned by the
connected server. The pinned local service uses the user's home directory; a
remote connection uses that server's default. The desktop app does not choose
or persist a directory, expose a directory picker, or send a local directory
to a remote server.

The new session is inserted into the picker, selected, and opened with its
empty transcript.

### Composer

- Accept multiline plain text.
- Reject an empty or whitespace-only submission.
- Send to the currently selected session.
- Preserve the draft when submission fails.
- Clear the draft after the server admits the prompt.
- Keep drafts in memory per session.
- Allow editing while the selected session is running but disable submission.
- Submit from the button or with Ctrl+Enter/Cmd+Enter; Enter inserts a newline.
- Support the server-backed model and variant for the selected session and
  location.
- Show primary agents and all selectable agents for the selected session and
  location; exclude hidden and subagent-only agents.
- If `SessionInfo.agent` is absent, display `Default agent` to represent the
  server-owned default; do not infer a specific agent from list order.
- Use the session switch APIs for selection without local persistence, and
  block submission while a switch is settling.
- Discover commands and skills from the connected location in one suggestion
  menu. Commands are offered at the start of a message and their remaining text
  is sent as arguments; skills are inserted as inline mentions.
- Keep code-review comments and transcript annotations attached for the next
  prompt when a command runs, because the command endpoint has no metadata.
- Do not support file references, shell input, or other composer extensions.

## Managed sidecar boundary

The local connection starts the pinned CLI in server mode and routes the
renderer through the same authenticated HTTP/SSE client used by a remote
server. Startup waits for health and exact-version validation. Early process
exit, startup timeout, incompatible version, and app shutdown are connection
lifecycle events owned by the desktop main process.

The managed command runs OpenCode service mode (`serve --service`) and keeps
its registration file under the app-private Electron user-data directory. The
registration's loopback endpoint and Basic-authentication material are passed
transiently from the main process to the existing renderer client. They are not
user configuration and are never persisted for a local target.

The managed server is loopback-only. The app does not adopt an unrelated
process listening on the expected port, expose arbitrary server arguments, or
offer a directory picker. The pinned local service uses the user's home
directory; a remote connection uses that server's default. The desktop app
does not choose or persist a directory.

The repository packages a local macOS ARM64 app with electron-builder. The
pinned CLI executable is staged outside ASAR at
`Contents/Resources/opencode/opencode2`, signed with the app, and resolved from
`process.resourcesPath`. Development continues to resolve the package-local
CLI dependency. Public distribution, notarization, other platforms, and
updater behavior remain outside this boundary.

## Explicitly deferred

The first slice does not include:

- Compatibility with OpenCode releases other than `0.0.0-beta-18155`.
- Multiple saved servers.
- HTTPS-specific configuration or authentication methods other than Basic.
- Projects, worktrees, or directory selection.
- Diff viewing, comments, review flows, or file browsing.
- Tool-specific or generic event rendering.
- Reasoning display.
- Stop, interrupt, queue, or steering controls.
- Permissions, forms, questions, or other server requests for user input.
- Agent, model, provider, or server configuration screens.
- File references.
- Todos, task progress, token usage, or costs.
- An embedded terminal.
- Notifications and other desktop extras.
- Cross-platform installers, notarized public distribution, and auto-update.
- A plugin system or UI-variant framework.

Deferred means not required for the first integration slice, not rejected from
the longer-term product.

## Completion boundary

The slice is complete when the Electron app can, against a real authenticated
OpenCode `0.0.0-beta-18155` server:

1. Save and reconnect to the server without storing a plaintext password.
2. Reject an incompatible server version clearly.
3. List existing sessions in recent-first order.
4. Create and select a session in the server's default context.
5. Load the complete transcript of an existing session.
6. Send a text prompt to a real model.
7. Display the user message and stream the assistant's text response.
8. Recover from a forced event-stream disconnection.
9. Rehydrate without missing or duplicating transcript messages.

For the managed sidecar path, acceptance additionally requires a healthy local
`0.0.0-beta-18155` server, clean shutdown without a leftover child process,
clear fallback to a configured remote server when local startup fails, and no
directory picker. The local macOS ARM64 package must embed the exact pinned
CLI, load the renderer from the packaged `oc://renderer` origin, and quit even
if sidecar cleanup fails.

No other deferred feature is needed to satisfy this boundary.
