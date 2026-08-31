# OpenCode session form integration

Status: implemented
Evidence baseline: repository `4760e66` and
`@opencode-ai/client@0.0.0-beta-18155`
Date: 2026-08-31

This is a post-first-slice extension. The original product-requirements slice
deferred forms; this design adds session forms without changing the other
deferred areas.

## Goal and scope

Connect `QuestionForm` to pending forms owned by the selected OpenCode
session. The renderer fetches the selected conversation's forms, reacts to
server events, submits answers, cancels forms, and recovers after reconnecting
without creating a second form model.

The first implementation covers session forms only. Each form is owned by one
`sessionID` and appears in that session's transcript. Global forms are
location-owned rather than session-owned; they remain deferred to a separate
app-level dialog design so they are never attributed to the selected session.

The server is authoritative for fields, order, and settlement. The renderer
owns loading and mutation presentation only.

## Pinned client and data-layer contract

The generated Promise client exposes:

| Operation          | Client call                                     |
| ------------------ | ----------------------------------------------- |
| List session forms | `api.form.list({ sessionID })`                  |
| Reply              | `api.form.reply({ sessionID, formID, answer })` |
| Cancel             | `api.form.cancel({ sessionID, formID })`        |

The Solid data layer is the application boundary and projects these as
`data.session.form.list`, `sync`, `invalidate`, `reply`, and `cancel`. The
renderer does not call raw Promise endpoints. `FormInfo` and `FormAnswer` are
the pinned upstream types consumed directly by `QuestionForm`.

The event stream publishes `form.created`, `form.replied`, and
`form.cancelled`. `createConnectedRuntime` passes that stream to `createData`,
whose reducer appends and deduplicates created forms and removes settled ones.
The controller does not duplicate that reducer.

## Ownership

- `ConnectedRuntime` owns the client, event stream, and `createData` store.
- `createSessionWorkspace` owns session selection and transcript hydration.
- `createSessionForms` owns selected-session form sync state, per-form
  mutations, user-facing errors, and the scoped `form.created` subscription.
- `ConversationRegion` projects the controller into transcript content.
- `QuestionForm` owns answer editing, conditional-field visibility, validation,
  and invalid-control focus.

The connected lifecycle is the sole owner of reconnect synchronization. It calls
the selected-feature syncs when connectivity is restored. The forms controller
only disqualifies late presentation completions when disconnected, so a stale
request cannot update its state or errors.

## Public controller contract

The controller exposes upstream form objects rather than a parallel schema:

```ts
type SessionFormsController = {
  readonly sessionForms: Accessor<readonly FormInfo[]>;
  readonly state: Accessor<"loading" | "ready" | "failed">;
  readonly error: Accessor<string | undefined>;
  readonly submitting: (formID: string) => boolean;
  readonly errorFor: (formID: string) => string | undefined;
  readonly sync: () => Promise<void>;
  readonly reply: (formID: string, answer: FormAnswer) => Promise<void>;
  readonly cancel: (formID: string) => Promise<void>;
};
```

`sessionForms` preserves the server order. With no selected session it is
empty, state is `ready`, and `sync()` is a no-op. While disconnected, cached
forms remain visible but controls and retry are disabled.

Selection generation and an owner-alive flag guard presentation state: only a
completion for the current selection, while connected and mounted, may update
loading or error state. A late request may warm its old cache, but cannot affect
the current presentation.

## Sync and event rules

The selected form context is `sessionID`. A selected-session change calls
`data.session.form.sync(sessionID)`. A location change within the same session
does not change form identity.

For every non-global `form.created` event, immediately invalidate the owning
session in the data layer. If that session is selected, call the controller's
direct `sync()` as well; the SDK/data-layer scheduler handles the active
invalidated read. If it is not selected, leave the invalidated cache for the
next selection. Ignore `sessionID === "global"` in this controller. Keep the
subscription scoped to the controller and remove it on cleanup.

## Rendering and mutation behavior

Render every pending session form in server order in the pending assistant
interaction area. Key rendering by the stable pair `[sessionID, formID]`, not by
object reference: a list sync may replace surviving `FormInfo` objects, and
reference keys would remount `QuestionForm` and erase its local draft. Including
`sessionID` also prevents a draft leaking when another session reuses a form ID.

Reply and cancel capture the selected session ID at mutation start and route
through the data layer. Do not remove forms optimistically; settlement removes
them after the server operation. An absent selection, disconnection, selection
change, or missing current form sends no request. Track in-flight work by
`[sessionID, formID]`: one form disables only itself, different forms mutate
independently, and repeated operations for one in-flight key are ignored.

Ordinary failures retain the form and set an error for that form. Invalid-answer
failures use the same form-level error boundary; local validation remains in
`QuestionForm`. Clear visible mutation errors when the selection changes.

## External fields

Leave `QuestionForm.onOpenExternal` disabled until oc-ui has an existing,
reviewed desktop URL-open contract. This integration does not invent Electron
IPC or call a browser global.

## Verification evidence and requirements

The evidence baseline above identifies the pinned repository and SDK contract.
The implementation must retain focused coverage for:

- selected-session sync, no-selection no-op, and stale
  selection/disconnect/unmount completion guards;
- immediate data-layer invalidation and direct selected-session sync for
  `form.created`, invalidated unselected sessions, and ignored global events;
- reply/cancel routing, disconnected mutation guards, per-form errors, and
  independent mutations with duplicate in-flight operations ignored;
- multiple forms in order, stable `[sessionID, formID]` draft preservation, and
  reset when a different session reuses a form ID;
- pending-area loading/error states and disabled cached forms while
  disconnected.

Live UI verification should cover submit/cancel removal, selection changes,
disconnect/reconnect, scrolling, keyboard navigation, first open/reopen, and
draft preservation across sibling settlement. It should also confirm that a
real pending session form receives `form.created` through the pinned data layer.

## Deferred

Notifications for unselected sessions; global forms as app-level dialogs with
location context; client-side reordering, persistence, or history;
cross-form mutation serialization; automatic composer focus; and a new
URL-opening IPC contract remain separate product decisions.
