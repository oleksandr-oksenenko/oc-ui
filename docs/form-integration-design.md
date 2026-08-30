# OpenCode form integration

Status: proposed
Evidence baseline: repository `4760e66` and
`@opencode-ai/client@0.0.0-beta-18155`
Date: 2026-08-31

## Goal

Connect the existing `QuestionForm` presentation to pending forms owned by the
connected OpenCode server. The renderer must fetch forms for the selected
conversation, react to server events, submit answers, cancel forms, and recover
after reconnecting without creating a second form model.

The first implementation covers both form scopes exposed by the pinned client:

- session forms, owned by one `sessionID`;
- global forms, temporarily used for MCP elicitation and owned by an exact
  server `LocationRef` rather than a session.

The server remains authoritative for form fields, order, settlement, and
location. The renderer owns only loading and mutation presentation.

## Pinned client contract

The generated Promise client exposes:

| Operation          | Client call                                     |
| ------------------ | ----------------------------------------------- |
| List session forms | `api.form.list({ sessionID })`                  |
| List global forms  | `api.form.request.list({ location })`           |
| Read state         | `api.form.state({ sessionID, formID })`         |
| Reply              | `api.form.reply({ sessionID, formID, answer })` |
| Cancel             | `api.form.cancel({ sessionID, formID })`        |

The Solid data layer already projects that contract as
`data.session.form.list`, `sync`, `invalidate`, `reply`, and `cancel`. This is
the application integration boundary. The renderer should not call the raw
Promise form endpoints.

`FormInfo` supplies `id`, `sessionID`, `title`, optional metadata, and a
non-empty field list. `FormAnswer` is a string-keyed record of `string`,
`number`, `boolean`, or `string[]` values. The existing `QuestionForm` consumes
these types directly.

The event stream publishes `form.created`, `form.replied`, and
`form.cancelled`. `createConnectedRuntime` already passes that stream into
`createData`. The data layer appends newly created forms, deduplicates by form
ID, and removes replied or cancelled forms. No additional renderer event
listener is needed.

## Current gap

`QuestionForm` is a controlled presentation component. `TranscriptView` has a
controlled `pendingInteraction` slot, but production `ConversationRegion` does
not populate it.

`syncSessionTranscript` refreshes session metadata, pending inbox items, and
messages. It does not sync forms. No production controller currently reads
`data.session.form`, and the Storybook callbacks deliberately do nothing.

## Ownership

Add `createSessionForms` beside the existing composer, model-selection, and
agent-selection controllers.

- `ConnectedRuntime` continues to own the OpenCode client, event stream, and
  `createData` store. It gains no form-specific wrapper.
- `createSessionWorkspace` continues to own session selection and transcript
  hydration. It gains no form mutation state.
- `createSessionForms` owns selected-session/location form syncing, sync state,
  per-form mutations, and user-facing form errors.
- `ConversationRegion` projects the controller into transcript content.
- `QuestionForm` continues to own local answer editing, conditional-field
  visibility, validation, and invalid-control focus.

```text
selectedSession() + connected()
        -> createSessionForms
        -> data.session.form.sync/list
        -> ConversationRegion
        -> TranscriptView.pendingInteraction
        -> QuestionForm
        -> data.session.form.reply/cancel
```

This keeps each decision in one place. Form lifecycle does not leak into the
generic transcript renderer or the OpenCode runtime.

## Controller contract

The controller should expose the upstream form objects rather than a parallel
form schema:

```ts
type LocatedGlobalForm = FormWithLocation & { readonly location: LocationRef };

type SessionFormsController = {
  readonly sessionForms: Accessor<readonly FormInfo[]>;
  readonly locationForms: Accessor<readonly LocatedGlobalForm[]>;
  readonly state: Accessor<"idle" | "loading" | "ready" | "failed">;
  readonly error: Accessor<string | undefined>;
  readonly submitting: (form: FormWithLocation) => boolean;
  readonly errorFor: (form: FormWithLocation) => string | undefined;
  readonly sync: () => Promise<void>;
  readonly reply: (form: FormWithLocation, answer: FormAnswer) => Promise<void>;
  readonly cancel: (form: FormWithLocation) => Promise<void>;
};
```

Import `FormWithLocation` from the pinned `@opencode-ai/client/solid` entrypoint;
do not copy its fields into a local transport type.

`sessionForms` preserves the order returned by `list(session.id)`.
`locationForms` preserves the order returned by
`list("global", session.location)`. There is no server-defined ordering across
the two scopes, so they remain separate accessors rather than one sorted queue.

The upstream `FormWithLocation.location` property is optional at the type
level. A global form without a location is neither renderable nor mutable: omit
it from `locationForms`, report a sync error, and retry the exact selected
location. Never let `reply` or `cancel` fall back to the client's default
location. `LocatedGlobalForm` is only a narrowed upstream type that protects
this routing rule; it is not a second form model.

## Selection, initial sync, and reconnect

The selected form context is the selected session ID plus its complete
`LocationRef`:

```text
[session.id, session.location.directory, session.location.workspaceID]
```

On a newly selected session while connected, run both requests in parallel:

```ts
const results = await Promise.allSettled([
  data.session.form.sync(session.id),
  data.session.form.sync("global", session.location),
]);
```

Use the results to derive aggregate presentation state without discarding
partial success. If one scope fails, forms already available from the other
scope remain visible, `state` is `failed`, and one retry action calls both sync
methods again. The Solid cache will skip the completed key and rerun the failed
key.

The exact server-provided location is forwarded. The renderer must not
normalize, parse, or infer remote paths. Global `list`, `reply`, and `cancel`
must all receive the same location so the data layer can set the required
directory and workspace headers.

Use a selection generation and an owner-alive flag for controller presentation
state. A late sync for an old selection may warm that old cache entry, but it
must not change loading or error state for the new selection.

Session-form cache identity is only `sessionID`; location is not part of its
Solid sync key. A same-session location change therefore keeps the existing
session-form cache and syncs only `"global"` for the new exact location. A new
session syncs both scopes. Reconnect invalidation allows both scopes to fetch
again.

`createData` invalidates request caches while disconnected and does not fetch
them again. `createSessionForms.sync()` must therefore be included in the
existing reconnect refresh alongside the selected session controls. The
controller remains the sole owner of its sync policy.

The event reducer is live assistance, not a substitute for sync. SSE reconnect
has no replay cursor, and a concurrent list response can replace event-built
state. Initial selection and every reconnect require an explicit sync.

## Rendering both scopes honestly

Render every pending form; do not assume there is only one.

Session forms belong to the selected conversation and use the existing
assistant-message pending-interaction wrapper. Global forms are location-owned,
not session-owned. They reuse `QuestionForm` but use a neutral “workspace
request” wrapper inside the pending-interaction area rather than an assistant
message wrapper. This avoids falsely attributing an MCP elicitation form to the
selected session.

Within each scope, preserve the data-layer order and key each form by `form.id`.
Session forms render before the separate workspace-request group; this is a UI
grouping policy, not a claim about server chronology.

Loading and initial-sync failure belong in the pending-interaction area. They do
not replace transcript messages and do not reuse `TranscriptView.error`, which
means transcript loading failed. A form-sync failure shows a small retryable
state. Cached forms may remain visible while a reconnect refresh runs.

When there are no forms, `pendingInteraction` is absent and the transcript
behaves exactly as it does now.

## Reply, cancel, and concurrency

`reply` calls:

```ts
data.session.form.reply(
  { sessionID: form.sessionID, formID: form.id, answer },
  form.sessionID === "global" ? form.location : undefined,
);
```

`cancel` follows the same routing. A global form that lacks `location` is
rejected locally and never sent. The controller never removes a form
optimistically. The data layer calls the server first, then removes the form,
invalidates its cache, and starts a background sync. It treats not-found and
already-settled responses as successful settlement only when the error's form
ID exactly matches the submitted `formID`. The controller must not catch and
generalize those errors itself.

Track in-flight work by a stable key containing `sessionID`, form ID, and, for a
global form, its complete location. Do not assume IDs are unique across scopes
or locations. One form's mutation disables only that form; different pending
forms remain independent. Ignore a repeat reply or cancel for the same key
while it is in flight.

An ordinary request failure retains the form and sets an error for that form so
the user can retry. Server invalid-answer failures use the same form-level
error boundary; local validation remains in `QuestionForm`.

Selection changes clear visible mutation errors for the previous context. A
late failure is recorded only if the same selection generation and form are
still current. Unmount ignores late completions.

On successful settlement, Solid keyed rendering removes that form. Do not move
focus to the composer automatically. Add explicit next-form focus only if
Electron accessibility testing demonstrates a real focus-loss problem.

## External fields

`QuestionForm` already exposes `onOpenExternal`. Production wiring should leave
the Open action disabled until oc-ui has an existing, reviewed desktop URL-open
contract. The form integration must not invent Electron IPC or call a browser
global directly.

## Expected implementation files

- Add
  `apps/desktop/src/renderer/components/App/ConnectedApp/Conversation/createSessionForms.ts`.
- Add one focused `createSessionForms.test.ts`.
- Update `ConnectedApp.tsx` to construct the controller and include its sync in
  reconnect refresh.
- Update `ConversationRegion.tsx` to render session and location form groups.
- Add only the small pending-form loading/error presentation needed by the
  region.
- Keep `ConnectedRuntime`, `event-source`, and `syncSessionTranscript`
  unchanged.

## Verification

Controller tests should prove:

- exact session and global sync calls for the selected session location;
- same-session location changes reuse session forms and sync global forms for
  the new exact location;
- old selection completions cannot replace current presentation state;
- reconnect refresh syncs the current session and location;
- reply and cancel pass the correct IDs and global location;
- global forms without a location are not rendered or sent;
- partial sync success keeps successful or cached forms visible with a
  retryable aggregate error;
- the controller delegates matching settled/not-found identity checks to the
  data layer and does not swallow other errors;
- request errors remain scoped to one form;
- different forms can mutate independently;
- unmount ignores late promises.

Region tests should prove:

- multiple session forms render in server order;
- global forms use the neutral workspace-request wrapper;
- loading, retry, disconnected, submitting, and error props reach the correct
  form;
- no pending state produces no form surface.

Storybook should add live-controlled stories for multiple forms, session plus
workspace forms, loading, sync failure, per-form submission failure,
disconnected, and narrow layouts. Browser QA should cover submit/cancel removal,
selection changes, scrolling, keyboard navigation, first open and reopen, and
focus after settlement. Final verification must also inspect the Electron app
against a real pending OpenCode form.

## Deferred until evidence requires it

- notifications or sidebar badges for forms waiting in unselected sessions;
- a server-wide global-form inbox across every known location;
- client-side form reordering, persistence, or history;
- mutation serialization across different forms;
- automatic composer focus after settlement;
- a new URL-opening IPC contract.

These are separate product decisions and are not required to connect the
selected conversation to the pinned server contract.
