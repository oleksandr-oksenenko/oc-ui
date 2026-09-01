# Code review comments

Status: implemented design

## Goal

Let a user attach single-line or multi-line review comments to the Diff panel,
send them with the next prompt, and see the same review as a collapsed
attachment in the transcript.

Drafts live only in renderer memory. Persistence across app restarts is
deferred.

## Interaction

Pierre owns line hover, the gutter `+`, pointer drag, and the completed line
range. oc-ui does not add a second gutter control or implement drag handling.

When the user activates Pierre's gutter utility:

1. Pierre returns a `SelectedLineRange`.
2. oc-ui captures the selected code from the rendered diff metadata.
3. An inline editor appears below the final selected row.

The editor contains:

- one multiline plain-text field;
- a red `×` in the top-right corner.

Text is saved on every input event. There are no Save or Cancel buttons. A
nonempty editor collapses when focus leaves it or Escape is pressed. An empty
editor is removed. Clicking `×` removes an empty editor immediately and asks
for confirmation before deleting a nonempty comment.

Only one editor is open at a time. Existing nonempty comments remain visible
and can be clicked to reopen.

Keyboard-only discovery of Pierre's hover utility is out of scope.

## Data

```ts
type ReviewComment = {
  id: string;
  path: string;
  selection: SelectedLineRange;
  selectedCode: string;
  body: string;
};

type ReviewDraftKey = {
  sessionID: string;
  comparison: "working" | "branch";
};
```

The key prevents comments from leaking between sessions or between working-tree
and branch comparisons. The workspace-changes controller owns this key because
it owns both the displayed session and the selected comparison; the composer
uses the same key instead of reconstructing it independently. The store
supports only the operations used by the UI:
begin, edit, update, remove, capture for send, clear after a successful send,
and clear a deleted session.

There is no stale-anchor relocation, reconciliation protocol, persistence
adapter, or server-side draft API.

## Composer and send

Nonempty comments appear as a quiet row above the composer field:

```text
Code review · 2 comments                                      ×
```

The label is not interactive. The `×` asks before discarding the review. A
review can be sent with or without ordinary prompt text.

Sending uses the existing single `session.prompt` call. The visible text is a
Markdown prompt containing the instruction, file and range, selected code, and
comment body. The same call carries namespaced metadata:

```ts
{
  "oc-ui/code-review": {
    kind: "code-review",
    version: 1,
    instruction: string,
    comments: Array<{
      path: string,
      selection: SelectedLineRange,
      selectedCode: string,
      body: string
    }>
  }
}
```

The instruction is trimmed once at the code-review protocol boundary and the
same canonical value is used in the prompt, metadata, and transcript.

After a successful send, the captured review is cleared only if the user did
not edit it while the request was pending. A failed send keeps both prompt text
and comments.

## Transcript

User-message metadata is validated before use. Valid review metadata renders:

- the original instruction, when present;
- a collapsed “Code review · N comments” card;
- each comment's path, range, selected code, and body when expanded.

Malformed or absent metadata falls back to the ordinary user-message display.

## Ownership

- Pierre: native gutter utility and transient selection.
- Workspace changes: the active review key and stable file projections. Review
  edits must not replace file identities or remount Pierre.
- Diff adapter: selected-code capture and inline annotation DOM.
- In-memory store: draft comments and the current editor.
- Composer controller: admission, one prompt call, and safe clearing.
- Transcript: metadata decoding and immutable review display.

No new IPC, persistence, OpenCode endpoint, or generic attachment framework is
introduced.
