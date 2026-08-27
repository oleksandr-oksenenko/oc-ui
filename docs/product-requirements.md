# Product requirements and first-slice design

Status: Implemented for milestone 1.

## Product direction

Ocui is an Electron desktop client for OpenCode. It is a place to
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

## Agreed product decisions

- Build and run the flow inside Electron from the start.
- Connect to one existing remote OpenCode server over plain HTTP.
- Support the Basic authentication used by the standard OpenCode server. The
  username is `opencode`; the user supplies the password.
- Require OpenCode version `0.0.0-beta-18155` rather than attempting
  best-effort compatibility with other releases.
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

## User flow

1. Open the Electron app.
2. Enter an OpenCode server URL and password, or reuse a securely saved
   connection.
3. Connect and verify the server health and exact version.
4. See a flat, recent-first list of sessions.
5. Select an existing session or create a new one.
6. Read the selected session's complete transcript.
7. Enter and send a text prompt.
8. See the admitted user message and streaming assistant text.
9. Continue using the selected session after a temporary disconnection and
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
- Context isolation and the narrow preload boundary.
- Connection-setting and encrypted credential persistence.

The renderer owns:

- The authenticated OpenCode Promise client.
- `createClientConnection` and its event-stream reconnect loop.
- The event source consumed by `createData`.
- The `createData` Solid store and its API-backed caches.
- Session loading, selection, and presentation state.

The preload script exposes only connection-setting operations. Electron runs
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
The connection form must warn about this for non-loopback HTTP servers; HTTPS
and certificate configuration remain outside this slice.

The server URL may be stored as ordinary application data. The password is
encrypted with Electron's secure-storage facility before it is persisted. If
secure encryption is unavailable, the password remains in memory for the
current process and the app asks for it again after restart. There is no
plaintext password fallback.

The renderer necessarily receives the decrypted password when constructing its
authenticated client. It is kept in the client closure only and is not placed
in Solid application state, rendered into the DOM, or written to logs. This is
an explicit tradeoff of reusing OpenCode's renderer-side Solid client.

### Version boundary

Connection begins with `health.get()`. The connection is accepted only when the
server reports version `0.0.0-beta-18155`. A different version produces a clear
compatibility error before session state or the event stream is used.

This explicit pin is necessary because the generated client and its event
schema can change between OpenCode beta releases.

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
`data.session.create({ location })` without an agent, model, or title. The
location is the remote server's default context, not the Electron app's local
working directory.

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
- Do not support attachments, references, slash commands, skills, shell input,
  or model and agent selection.

## Explicitly deferred

The first slice does not include:

- Compatibility with OpenCode releases other than `0.0.0-beta-18155`.
- Multiple saved servers.
- Starting or managing a local OpenCode server.
- HTTPS-specific configuration or authentication methods other than Basic.
- Projects, worktrees, or directory selection.
- Diff viewing, comments, review flows, or file browsing.
- Tool-specific or generic event rendering.
- Reasoning display.
- Stop, interrupt, queue, or steering controls.
- Permissions, forms, questions, or other server requests for user input.
- Agent, model, provider, or server configuration screens.
- File references, commands, skills, images, or attachments.
- Todos, task progress, token usage, or costs.
- An embedded terminal.
- Notifications and other desktop extras.
- Installers and multi-platform packaging polish.
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

No deferred feature is needed to satisfy this boundary.
