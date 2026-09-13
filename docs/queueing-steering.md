# Queueing and steering

This extends the original milestone-one composer behavior using OpenCode
`0.0.0-beta-19271` inbox contracts.

- Enter and Send submit with `delivery: "steer"`; Cmd+Enter uses `"queue"`.
  Shift+Enter inserts a newline. While running, the shared button shows Stop
  when there is no sendable text, attachment, review, or annotation, and Send
  otherwise.
- Pending user messages appear above the composer, with steering messages first
  and SDK order preserved within each delivery group. Rows use one line with
  equal vertical padding. The red × calls `session.inbox.cancel`;
  Steer now calls `session.inbox.steer`. Pending IDs are excluded only from
  transcript rendering and become visible there when delivered.
- The server owns queue persistence, ordering, execution, interruption, and
  restart behavior. There is no local scheduler, saved queue, editing,
  reordering, or custom pause/resume policy.

The retained workspace owns prompt admission and inbox mutations. The SDK owns
optimistic admission, pending messages, transcript messages, and event updates;
no atom mirrors those collections. Existing transcript hydration synchronizes
the inbox on selection and reconnection.

Each mutation captures its session and inbox identity before starting. One
workspace-scoped semaphore excludes concurrent inbox actions while local atoms
expose only busy/error state. View disposal and selection changes do not cancel
accepted work. Shutdown cancels external requests where supported and awaits
settlement before releasing the owner.

After a mutation settles, invalidate and synchronize the SDK pending collection,
including after conflicts and uncertain failures. Report failures without
automatically retrying mutations; delivery can race cancellation or steering.
Prompt retries retain their ID and delivery when the captured request is
unchanged. Changing delivery creates a distinct submission.

Verification covers controller races, captured-session ownership, shutdown,
delivery-aware retries, Storybook keyboard actions, and a real pinned-server
browser flow for cancel/steer actions, reload recovery, and sequential queued
delivery. The scripted provider holds a response until the browser test releases
it, avoiding timing-dependent queue setup.
