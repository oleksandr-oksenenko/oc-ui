# Milestone 1: remote session client

Status: Implemented.

This document turns the first-slice product requirements into an implementation
contract. It is deliberately limited to connecting to one existing OpenCode
server, choosing or creating a session, reading its transcript, and sending
plain-text prompts.

The supported OpenCode protocol and package version is exactly
`0.0.0-beta-18155`.

## Application contracts

### Desktop bridge

The preload exposes one narrow settings API. It does not expose generic IPC,
filesystem access, Electron objects, or an HTTP proxy.

```ts
type LoadedConnection = {
  readonly serverUrl: string;
  readonly password?: string;
};

type SaveConnectionResult = {
  readonly passwordSaved: boolean;
};

type DesktopApi = {
  readonly connection: {
    load(): Promise<LoadedConnection | undefined>;
    save(input: { serverUrl: string; password: string }): Promise<SaveConnectionResult>;
    clear(): Promise<void>;
  };
};
```

The main process validates every IPC input. `load()` decrypts a saved password
before returning it to the renderer. `save()` persists the URL and encrypts the
password with Electron `safeStorage`. If encryption is unavailable, it saves
only the URL and returns `{ passwordSaved: false }`. There is no plaintext
password fallback.

A successful connection is saved automatically. A failed attempt never
overwrites the last known-good connection. On startup, the app auto-connects
when both a URL and encrypted password are available. If only the URL is
available, the form is prefilled and asks for the password.

### Renderer connection state

The app owns the states that are visible to the user:

```ts
type ConnectionState =
  | { readonly status: "disconnected" }
  | { readonly status: "connecting" }
  | { readonly status: "connected" }
  | {
      readonly status: "reconnecting";
      readonly attempt: number;
      readonly message?: string;
    }
  | {
      readonly status: "failed";
      readonly reason:
        | "invalid-url"
        | "unauthorized"
        | "unreachable"
        | "incompatible-version"
        | "stream-handshake"
        | "setup";
      readonly message: string;
    };
```

OpenCode's `createClientConnection` supplies only `connecting`, `connected`,
and `reconnecting`. The application supplies `disconnected` and terminal
`failed` states for URL, health, authentication, version, and initial stream
setup failures.

An initial event-stream failure is a connection failure. After the stream has
connected at least once, a stream failure is `reconnecting` and retries until
the user changes the connection or closes the app.

### Connected runtime

`ServerProvider` owns one connected server runtime inside a Solid owner. Its
children consume this focused contract:

```ts
type ConnectedRuntime = {
  readonly api: OpenCodeClient;
  readonly data: Data;
  readonly defaultLocation: LocationRef;
  readonly stream: {
    status(): "connected" | "connecting" | "reconnecting";
    attempt(): number;
    error(): string | undefined;
  };
  readonly sessions: SessionCatalog;
  syncTranscript(sessionID: string): Promise<void>;
};

type SessionCatalog = {
  ids(): readonly string[];
  state(): "loading" | "ready" | "failed";
  error(): string | undefined;
  sync(): Promise<void>;
};
```

This is coordination, not a second OpenCode state model:

- `data` remains the only store for `SessionInfo`, message records, active
  status, optimistic sessions, and optimistic prompts.
- `SessionCatalog` stores only membership IDs because the public Solid client
  can remember sessions but cannot fetch or replace the session list.
- Transcript rows are a pure projection of `data.session.message.list(id)` and
  are never stored separately.

The normal OpenCode calls remain direct:

```ts
const api = OpenCode.make({ baseUrl, headers });
const health = await api.health.get();
const location = await api.location.get();

await runtime.sessions.sync();
await runtime.syncTranscript(sessionID);

const created = runtime.data.session.create({ location: runtime.defaultLocation });
selectSession(created.id);
await created.request;

await runtime.data.session.prompt({ sessionID, text });
```

## Process and security design

```text
Electron main process
  Effect runtime
  window and application lifecycle
  encrypted connection settings
  oc://renderer asset protocol
          |
          | narrow preload bridge
          v
Solid renderer
  OpenCode Promise client
  @opencode-ai/client/solid
  @opencode-ai/ui primitives
          |
          | Basic-authenticated HTTP and SSE
          v
OpenCode 0.0.0-beta-18155 server
```

The Electron application is one workspace app under `apps/desktop`, with
separate main, preload, shared-contract, and renderer source directories. Main
and renderer use separate TypeScript configurations because their platform APIs
differ.

The production renderer is served from `oc://renderer`. This matches an origin
explicitly accepted by the beta-18155 OpenCode server. Development uses the
local Vite HTTP origin, which the server also accepts. The app does not disable
Electron web security.

The browser window has:

- context isolation enabled;
- Node integration disabled;
- renderer sandboxing enabled;
- navigation away from the renderer denied;
- new windows denied;
- no permissions enabled for this milestone.

The server URL must be a plain `http://` origin with no path, query, fragment,
or embedded credentials. It is normalized without a trailing slash. HTTPS,
custom certificates, reverse-proxy path prefixes, and other authentication
methods are outside this milestone.

The client sends `Authorization: Basic ...` on both requests and SSE. The
username is fixed to `opencode`; it is not a form field. The password is encoded
as UTF-8 before Base64 encoding. The header and password are never logged.

Plain HTTP does not protect the password in transit. The connection form shows
a persistent warning for non-loopback HTTP servers. This warning does not block
connection because plain HTTP is an explicit milestone constraint.

## Visible interface

### Disconnected view

The disconnected view is a centered connection form containing:

- server URL;
- password;
- plain-HTTP warning when applicable;
- **Connect**;
- the last connection error, when present;
- **Forget saved connection** when saved settings exist.

While connecting, fields and Connect are disabled. A failure restores the form
with its values intact. Forget clears persisted settings and the form.

### Connected view

```text
+---------------------------------------------------------------+
| server URL       Connected / Reconnecting       Change server |
+----------------------+----------------------------------------+
| New Session          | selected session title                 |
|                      +----------------------------------------+
| recent session       | transcript                             |
| recent session       |                                        |
| recent session       |                                        |
|                      +----------------------------------------+
|                      | multiline composer             Send   |
+----------------------+----------------------------------------+
```

The first layout uses a fixed-width session sidebar and a flexible transcript
area. Exact spacing, typography, colors, and responsive breakpoints remain UI
implementation decisions.

`@opencode-ai/ui` supplies primitives such as Button, TextInput, Textarea, and
Loader where they fit. The app owns the layout, session-row presentation,
transcript bubbles, error states, and CSS. This keeps later experiments such as
a session tree independent of the data integration.

**Change server** tears down the current Solid owner and event stream and
returns to the prefilled connection form. It does not erase the last known-good
saved settings. Those settings change only after another successful connection
or an explicit Forget action.

## Connection and hydration flow

### Startup

1. Load saved settings through the preload bridge.
2. If a decrypted password is available, attempt the saved connection.
3. Otherwise show the form, prefilled with any saved URL.

### Initial connection

1. Validate and normalize the URL.
2. Construct `OpenCode.make` with the normalized base URL and Basic header.
3. Call `health.get()` with a 10-second application timeout.
4. Require `health.version === "0.0.0-beta-18155"`.
5. Call `location.get()` with no location argument and retain the returned
   `{ directory, workspaceID }` as `defaultLocation`.
6. Create the application event source.
7. Create `createClientConnection(api, { onEvent: events.emit })`.
8. Create `createData` with the event source, stream status, and the returned
   server directory.
9. Require the stream's first `server.connected` event.
10. Call `data.location.syncInfo()` so the Solid store also owns the resolved
    default location.
11. Save the successful connection.
12. Hydrate the session catalog.
13. Fetch `api.session.active()`, mark catalog sessions idle, and then mark its
    returned session IDs running.
14. Select the most recently updated session, if one exists, and hydrate it.

The event source is subscribed by `createData` before the Solid owner mounts
and starts the stream. Events therefore cannot arrive before the reducer is
listening.

### Session catalog

The picker contains top-level sessions from the server's default directory
only. Child and subagent sessions are hidden in this milestone.

Catalog synchronization calls:

```ts
api.session.list({
  directory: defaultLocation.directory,
  parentID: null,
  order: "desc",
  limit: 100,
  cursor,
});
```

It follows `cursor.next` until all pages are loaded, passes every returned
record to `data.session.remember()`, and replaces the catalog ID set with the
snapshot's IDs.

`session.created` and `session.deleted` events update catalog membership. A
catalog sync records mutations received while its request is running and
replays them after replacing the snapshot. This prevents a create or delete
event racing the HTTP snapshot from being lost. Replacing the ID set also
removes sessions deleted while the event stream was disconnected.

Presentation maps catalog IDs back to `data.session.get(id)` and sorts by
`time.updated` descending. Each row shows:

- `title`, falling back to **Untitled session**;
- updated time;
- a running indicator from `data.session.status(id)`.

If no sessions exist, the transcript area shows an empty state with **New
Session**. If the selected session disappears, select the new most-recent
session or show the empty state.

### New session

New Session calls:

```ts
const { id, request } = data.session.create({ location: defaultLocation });
```

The catalog admits and selects `id` immediately, so the empty session opens
without waiting for the network. On success, the server record replaces the
optimistic record. On failure, the Solid client rolls back its record, the
catalog removes the ID, the previous valid selection is restored, and the UI
shows a retryable error.

No title, model, or agent is supplied. The server's defaults decide them.

### Selected session and transcript

Hydration performs:

```ts
await Promise.all([
  data.session.sync(sessionID),
  data.session.pending.sync(sessionID),
  data.session.message.sync(sessionID),
]);

while (data.session.message.more(sessionID)) {
  await data.session.message.loadMore(sessionID);
}
```

The first page can render immediately while older pages load. Older pages are
prepended without moving the reader's visible scroll anchor. Switching sessions
stops requesting further pages for the old selection after its current request
settles.

The transcript projection is:

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

Rules:

- A user record becomes one user item using its `text`.
- An assistant record becomes one assistant item containing its non-empty text
  content entries in order.
- Assistant completion comes from `message.time.completed`, not from
  `session.text.ended`.
- An assistant with an error renders any available text plus a simple
  **Response failed** state.
- Unsupported message kinds remain in `data` but do not produce transcript
  rows.
- A running session displays a separate working indicator even when its current
  assistant record has no text yet.

Streaming changes the same assistant row in place because `createData` applies
events by server message ID. The viewport follows new text only while the user
is already near the bottom; scrolling upward suspends automatic following.

### Composer

The composer is a multiline Textarea and Send button.

- Enter inserts a newline.
- Ctrl+Enter or Cmd+Enter submits.
- Whitespace-only input is rejected locally.
- Submit is unavailable without a selected session, while disconnected or
  reconnecting, while the selection is hydrating, during prompt admission, or
  while the selected session is running.
- The textarea remains editable while the session is running, but the draft
  cannot be sent. This avoids implicitly choosing OpenCode's steering or queue
  behavior in this milestone.
- Drafts are held in memory per session and are not persisted across app
  launches.

Submission captures the current text and awaits
`data.session.prompt({ sessionID, text })`. The Solid client optimistically
admits the user row. If admission fails, it rolls the row back and the draft is
preserved. If admission succeeds, the draft is cleared only when it still
equals the submitted text; edits made while the request was in flight are not
discarded.

## Reconnection and reconciliation

The global event stream is a volatile live-update source. It is not used as a
durable replay log.

On a post-connection stream failure:

1. Keep the current catalog, transcript, selection, and drafts visible.
2. Show a reconnecting banner with the attempt count.
3. Disable New Session and Send.
4. Let `createClientConnection` retry the stream.
5. When it reaches `connected`, synchronize the default location and full
   session catalog again.
6. Refresh active-session statuses from `api.session.active()`.
7. If the selected session still exists, synchronize its info, pending inputs,
   and complete message history again.
8. Preserve the selected ID when valid; otherwise choose the most-recent
   session.

`createData` invalidates its request cache while disconnected, but it does not
perform this resynchronization itself. The application owns these calls.

If reconnection occurs while the selected session is running, perform one final
selected-session message synchronization after its terminal execution event.
This closes the snapshot-versus-live-event race without maintaining a parallel
message reducer.

Message history is authoritative after synchronization. OpenCode message IDs
and the Solid client's merge behavior prevent duplicate transcript rows. The
application does not rely on content ordinals; beta-18155's Solid reducer
targets the active message and latest matching content entry.

## Loading and error behavior

Each independently retryable area owns its error:

- The connection form handles invalid URL, authentication, network, version,
  and initial stream failures.
- The sidebar handles session-catalog loading and retry.
- The transcript handles selected-session hydration and retry.
- New Session reports creation failure without losing a valid selection.
- The composer reports prompt-admission failure and preserves the draft.
- An admitted assistant failure appears in its transcript row.

Exact prose and visuals are implementation-owned. Errors shown to users must be
short and actionable; raw exception objects, authorization headers, and
passwords are never rendered or logged.

Permission and form requests remain unsupported. A server configuration that
requires them can leave a run waiting. This is a known milestone limitation,
not a hidden promise that the app can answer them.

## Source layout

```text
apps/desktop/
  src/main/
    index.ts
    window.ts
    renderer-protocol.ts
    connection-settings.ts
  src/preload/
    index.ts
  src/shared/
    desktop-api.ts
  src/renderer/
    App.tsx
    connection/
    opencode/
      event-source.ts
      server-provider.tsx
      session-catalog.ts
      transcript.ts
    sessions/
    transcript/
    composer/
```

This is a guide to ownership, not a requirement to create one file per type.
Small files should be combined when separation does not protect a boundary.

## Implementation sequence

1. Convert the scaffold into the Electron desktop package and secure window.
2. Add the Effect-based connection-settings service and typed preload bridge.
3. Implement URL validation, authenticated health/version checks, and the Solid
   server provider.
4. Implement the reconciled default-context root-session catalog.
5. Implement selection, complete transcript hydration, and transcript
   projection.
6. Implement New Session, per-session drafts, and prompt admission.
7. Implement reconnect rehydration and operation error states.
8. Verify with both controlled integration tests and a real server/model.

## Verification and acceptance

Automated tests cover:

- URL normalization and Basic-header encoding;
- exact-version rejection and connection-error mapping;
- secure-storage available and unavailable behavior;
- session snapshot plus concurrent create/delete reconciliation;
- transcript projection and assistant completion/error states;
- composer whitespace, busy-state, and draft-clearing rules;
- reconnect selection and duplicate-free rehydration.

The milestone is accepted only after running the built Electron application
against a real authenticated OpenCode `0.0.0-beta-18155` server with a working
default model. It must demonstrate:

1. Successful connection over plain HTTP and clear wrong-password behavior.
2. Automatic restart connection without plaintext password persistence.
3. Clear rejection of another OpenCode version.
4. Complete recent-first listing of top-level sessions in the default server
   directory.
5. Automatic selection of the most recent session and a correct empty state.
6. Optimistic creation and selection of a session in the default location.
7. Complete loading of a long, paginated transcript.
8. Submission of a multiline text prompt to a real model.
9. Immediate user-message admission and streamed assistant text.
10. Draft-only behavior while the session is running.
11. Recovery from a forced event-stream disconnection.
12. Rehydration with no missing or duplicate transcript messages.

No project, worktree, diff, comment, permission, form, tool, reasoning, model
picker, cost, todo, or local-server feature is required for acceptance.
