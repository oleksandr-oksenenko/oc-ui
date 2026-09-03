# Transcript annotations: implementation design

Status: implemented in the `e0a3` worktree, 2026-09-03; final desktop/server acceptance is pending. The production transcript, Composer, popup, draft store and send flow now share the implementation used in Storybook. The implementation and review removed the separate prototype behavior, formatting-only clones and duplicate active-request/error state. See the acceptance status below before treating the feature as fully verified.

## Caller-facing shape

Use the existing session composer to submit everything together:

```ts
const prompt = createSessionPrompt({
  instruction: textSnapshot,
  reviewComments: reviewSnapshot?.comments ?? [],
  annotations: annotationSnapshot.comments,
});
await runtime.data.session.prompt({ sessionID, id: requestID, ...prompt });
```

`createSessionPrompt` is a local function, not an OpenCode API. Its input explicitly names the two supported comment types. Its result uses the SDK's existing text and JSON metadata contract. Both comment sections reuse one fence formatter; annotation creation and metadata decoding reuse the domain schema. There is no generic attachment plugin system.

The real Composer keeps its existing annotation interface:

```tsx
<Composer
  // Existing text, model, agent, submit, stop and review props remain.
  annotations={{
    count: comments.length,
    onOpen: (opener) => annotationUI.openDrafts(opener),
    onDiscard: () => annotationDrafts.clear(sessionID),
  }}
/>
```

Pass `undefined` for an empty collection. The UI coordinator owns popup positioning; the draft store owns the comments. Neither Composer nor the store inspects the transcript DOM.

## Product contract

- Create annotations only while the selected conversation is idle, connected, fully loaded without a transcript error, and neither submitting nor switching model/agent. Recheck this when adding, not just when selecting. Use the existing running-to-idle transcript reload; no settling timer.
- Select visible message content across message types. A selection stays within one explicitly marked content block. Multiple paragraphs, formatting, tables and code inside that block are allowed. Separate messages or content blocks need separate annotations.
- Preserve normal selection and copying during a running turn. Existing highlights and their comments remain readable. Annotation additions and popup edits/removal are disabled while sending/running/loading so the submitted snapshot cannot be edited through an open popup. This does not disable the composer textarea or change code-review editing: their existing snapshot guards preserve newer edits made during admission.
- Selection shows Add note. Adding a nonblank comment creates a draft annotation. Annotations can be sent without additional composer text.
- Before sending, show one annotation-count control alongside the existing code-review count. Clicking either a highlight or the annotation count opens the approved popup.
- Keep the approved comment card, direct text editing, red trash icon, neutral focus outline, padding and equal viewing/editing dimensions. Enter finishes an existing edit; Shift+Enter inserts a newline; IME Enter does not submit. Outside click or Escape keeps existing edits and dismisses. Finishing an empty existing comment removes it.
- After sending, keep source highlights and display the annotations in their own collapsed-by-default card, following the user bubble within the same server-message entry. Each comment comes first, its source quote below. Do not fabricate an extra SDK message.
- Sent comments are read-only, as in the approved prototype: editing a comment already delivered to the agent would require a separate message-editing feature.
- Drafts survive conversation switches within the connected workspace. No disk store is needed. Sent data uses ordinary message metadata, so it can be restored wherever that metadata is returned; source highlighting still requires the original block to be available and unchanged.

An unfinished Add-note editor is temporary popup state, not a saved annotation. Only Add puts it into the session draft store. Cancel, Escape, outside dismissal, navigation, source removal, scroll/resize dismissal or replacing the selection discards the unadded text and candidate highlight. Edits to an already added annotation remain saved on dismissal. This gives conversation-switch persistence to added annotations without introducing a second recoverable draft collection.

Clicking a source quote opens the same comment popup anchored to that quote, without scrolling the transcript. Clicking an original source highlight anchors the popup to that passage. Neither path automatically expands hidden sections. This avoids competing programmatic scrolling and popup dismissal.

## Ownership

```text
ConnectedApp (one connected server workspace)
  annotation draft store, keyed by session ID
  createSessionComposer: captures and sends text + review + annotations
  ConversationRegion
    annotation UI coordinator: active selection, popup, focus
    annotation DOM helper: selection, ranges, transcript listeners
    TranscriptView: existing SDK messages and marked content blocks
      UserMessage: instruction, code-review card, annotation card
    Composer: existing input and one annotation count control
```

| Owner                                                 | Responsibility                                                                                                                                                                   |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain/annotation-drafts.ts` (new)                   | Shared annotation schema and added comments per session; update/remove/take/restore submitted values. No DOM nodes or SDK calls.                                                 |
| `Conversation/createSessionComposer.ts`               | One submission owner and admission guard. Move submitted annotations into an immutable request snapshot; restore on failure without overwriting newer drafts.                    |
| `opencode/session-prompt.ts` (new)                    | Compose the two known comment sections and their metadata; decode one coherent display representation for user messages.                                                         |
| `Conversation/createTranscriptAnnotations.ts`         | One interaction state, draft operations and the popup view.                                                                                                                      |
| `Conversation/createAnnotationHighlights.ts`          | DOM selection, source lookup, highlight rebuilding/hit testing and the transcript listener lifecycle.                                                                            |
| `Conversation/AnnotationPopover.tsx` (new)            | Approved popup, implemented with installed OpenCode primitives. Its comment-row component owns editing and local focus; stable IDs preserve textarea focus/caret across updates. |
| `TranscriptView/UserMessage/AnnotationCard.tsx` (new) | Collapsed sent group using OpenCode `Collapsible` and `LineComment`.                                                                                                             |
| Existing message renderers                            | Mark eligible content roots and stable source keys. They do not each implement selection handlers.                                                                               |

Instantiate the draft store beside `reviewDrafts` in `ConnectedApp`, and pass it to composer and conversation owners. Clear a deleted session through the existing session-flow cleanup. The connected workspace already scopes stores to one server; do not introduce another global server/session registry. Dispose DOM state and highlight registrations on navigation/unmount without clearing another session's drafts.

`ConversationRegion` creates the UI coordinator once. A small optional root-ref callback on `TranscriptView` gives it the actual transcript element and returns its unmount cleanup; content markers supply source identity. The coordinator returns the count-control callbacks and controlled popup data/actions. Keep the popup outside message rendering so transcript updates do not remount its editor. Storybook mounts these same production components with controlled fixture data.

## Source identity and stored data

Reuse SDK message types for transcript data. Add only the local type needed to describe a selection:

```ts
type TranscriptAnnotation = {
  readonly id: string;
  readonly source: {
    readonly messageID: string;
    readonly block: string;
    readonly textDigest: string;
    readonly start: number;
    readonly end: number;
  };
  readonly quote: string;
  readonly body: string;
};
```

The containing draft or sent message supplies the session. `block` is a renderer-owned key, not an arbitrary CSS selector or the message's position in the transcript. Centralize its construction and interpretation in the annotation module. A metadata version fixes the block-key and text-offset conventions.

- `start` is inclusive and `end` exclusive, measured in UTF-16 code units across the block's DOM text nodes. This matches browser Range text offsets, including emoji.
- `quote` is the readable native selection captured before popup focus changes. Preserve its whitespace, including code indentation and table separators; trim only to reject an all-whitespace selection.
- `textDigest` is a SHA-256 digest of the complete concatenated block text captured at selection time, using browser Web Crypto. Its only purpose is to verify the unchanged-source rule without storing a second complete tool output in every annotation. The full text snapshot is temporary candidate state and is released after Add or dismissal. It is not a search or recovery mechanism.
- Allocate IDs with the existing platform UUID facility. Sent identity is scoped by sending message plus annotation ID; two messages carrying the same local ID must not overwrite each other.
- Do not store a live Range, DOM path, pixel coordinates, Markdown source offsets, quote prefix/suffix, or edit history in the draft/metadata.

Suggested block keys, emitted on existing content elements:

| Content                                             | Key within its message                                                            |
| --------------------------------------------------- | --------------------------------------------------------------------------------- |
| User instruction                                    | `user/text`                                                                       |
| Assistant text or reasoning                         | `content/<completed-content-index>/text` or `/reasoning`                          |
| Tool details                                        | `tool/<tool-id>/input`, `/output/<index>/text`, or `/output/<index>/<file-field>` |
| Shell output                                        | `shell/output`                                                                    |
| Skill, system or synthetic context                  | `body`                                                                            |
| Compaction summary/recent or completed error body   | Separate field keys                                                               |
| Noninteractive timeline text                        | Separate label/detail keys                                                        |
| Attachment labels and expanded sent comment content | Stable item index/ID and field, separately from controls                          |

Text/reasoning have no part IDs in the pinned SDK. A completed content index is sufficient under the agreed unchanged-message rule; it is not an identity promise across message edits or reordered duplicate parts. Tool IDs are already available and should be reused.

Exclude collapse triggers, buttons, links acting as controls, form fields, images, client status/error/loading UI and hidden content. Text within ordinary Markdown links may be selected, but an ordinary link click must retain navigation behavior; annotations remain accessible through the count or sent card. For tool fields that remain running/streaming despite a session transition, wait for their completed snapshot before allowing annotation.

## Selection and highlight mechanics

1. Delegate selection handling from the active transcript root. On pointer selection completion or keyboard selection, validate both endpoints, the common marked content block, and the full interval. Reject crossing into nested blocks or excluded controls. A selection outside the root clears the old Add-note candidate.
2. Capture the full projected source text, readable quote and text-node offsets together, synchronously, before focus moves. Keep that immutable source-text snapshot for hashing on Add; never substitute later DOM text as the fingerprint's input. Keep this candidate while focus moves to Add note. An unrelated selection supersedes it; the open editor uses its captured candidate, not the current browser selection.
3. On Add, compute the digest of the captured text, then recheck candidate identity, conversation, availability and source. Rebuild the current text projection and require exact equality with the captured full text before adding. A changed source or new running state disables Add; it must not replace the saved offsets or fingerprint with new values. Keep text only while that editor remains open so the user can copy it; dismissal follows the temporary-editor rule above. Navigation, source removal or replacement invalidates the candidate, and a late hash result cannot add an annotation or reopen a popup.
4. Reconstruct a Range by walking that block's text nodes to the saved offsets. Verify the full text digest and bounds first. This handles repeated words and different inline formatting nodes without searching for the quote.
5. Apply CSS Custom Highlights. Keep separate draft/sent data but a shared visual treatment. Scope highlight ownership to a transcript instance, with cleanup, so two Storybook instances or remounted transcripts do not clear each other's highlights.
6. Watch child/text changes inside the transcript root to invalidate affected block ranges. One scoped MutationObserver, with updates batched to a microtask, covers current `messages.map`, Markdown `innerHTML`, and collapsible remounts. Rebuild only annotated/selected blocks; do not scan or hash the full transcript on every pointer move. Compute each annotated block's projection/digest once per rebuild, sharing it across annotations in that block. Rebuild when source descriptors or transcript DOM change; editing only a comment body does not invalidate highlights. Decode sent annotations separately from reactive draft comments. Popup/form changes are outside the observed root. Transcript mutations dismiss an open popup because they can move its anchor even without changing its own text.
7. For hover/click, hit-test the registered annotation ranges using current client rects. Never use stored pixel locations. Overlapping ranges open all matching comments in stable order. Do not open a comment when the user just completed a text selection.
8. Use OpenCode Popover's `getAnchorRect`, portal, placement and dismissal. Anchor to the selected or clicked range's bounding rectangle; a quote click anchors to the quote without scrolling. Dismiss anchored popups on transcript/ancestor scrolling, resize, navigation or anchor removal, retaining added annotations and discarding unadded editor state. Scrolling inside the popup must still work.
9. Escape returns focus to the actual opener, or an available transcript/count fallback if the original node remounted. Outside clicks keep focus on the clicked control. The popup owns hidden-trigger focus forwarding and relies on OpenCode to suppress autofocus after outside clicks. The controller has no global Escape listener. The composer supplies its fallback button reference explicitly.

Collapsed bodies have no live Range. Their records stay in memory/metadata and restore when the unchanged body remounts. Missing messages, changed digests, unknown block conventions or invalid offsets produce no highlight; the quote and comment remain usable. Do not add fuzzy matching, streamed-text tracking, a replay layer, or DOM text wrapping.

CSS highlights are not focusable controls. Provide keyboard access through the real count control and the sent card's comments/source controls. Ensure keyboard-created selections can reach Add note without the candidate being cleared by that focus transition.

### Exact text mapping and restoration procedure

The annotation record above is the stored highlight description. A browser `Range` and its rectangles are disposable rendering objects derived from it. Sending or rolling back an annotation changes who owns that record; it does not change its source offsets.

Use one text-mapping function for both capture and restoration. Its version-1 projection walks text nodes in document order within the marked block, excluding explicitly non-source subtrees and nested source blocks. It concatenates their node values without trimming, whitespace normalization, or inserted paragraph/table separators. Keep a table of `{ node, start, end }` for the mounted block. CSS wrapping and viewport size must not change this text projection. Selection eligibility separately rejects hidden content and excluded intervals.

**Capture:** normalize a backward selection to the browser Range's ordered start/end. Map a text-node boundary to `nodeStart + localOffset`. For an element boundary, sum eligible text before its child boundary; handle the block start/end the same way. Reject endpoints outside the same block, an excluded interval, or an empty range. In that same synchronous capture, save both the complete projected source text and the readable `Selection.toString()` before focus changes. Hash only that immutable text snapshot, asynchronously if needed. At Add, compare the current full projection to the snapshot and store its already captured offsets and digest. Do not derive offsets from the readable quote, trim the quote to compute positions, or hash a newer DOM snapshot for an older selection.

**Restore:** locate the exact message and block, build its current node table, and verify its digest. Require integer bounds `0 <= start < end <= text.length`. Resolve the start to the first node whose end is greater than `start`; resolve the end to the first node whose end is greater than or equal to `end`, skipping empty nodes. Subtract each node's start to get local offsets and construct the Range. This boundary convention handles selections ending exactly between two nodes. Assert that `range.toString()` equals the projected slice before registering the highlight. Never find a replacement occurrence using `indexOf(quote)`.

Example: nodes `"one "`, `"two"` inside a bold element, and `" three"` concatenate to `"one two three"`. Offsets `[4, 7)` select `two` before and after the DOM is recreated, even if its text is split across different nodes. A second occurrence of `two` has different offsets. A table's readable quote can contain tabs/newlines that differ from this projection without affecting the saved positions.

**Invalidation:** the DOM helper has one rebuild revision. Transcript text/children changes or marked visibility changes invalidate its ranges immediately; root replacement and cleanup do the same. Source descriptor changes also schedule a rebuild. Batch reconstruction in a microtask. Hash results are checked against the revision, mounted root and source connectivity before applying them; discard stale results. Check current connectivity and revision before pointer hit testing, so an old range is never used while rebuilding. Resize changes rectangles, not text offsets; read fresh rectangles on interaction.

**Unavailable source:** an unmounted/collapsed block has no painted highlight, but retains its annotation record. On remount, perform the same verification and restoration. A different digest or invalid block/bounds leaves the record readable without a highlight. This procedure deliberately cannot distinguish historical identities after reordered identical content parts; such edits are outside the unchanged-source contract.

Focused acceptance cases: cross-node formatting and node-boundary endpoints; repeated phrases; table separators; code indentation; emoji/backward selection; unchanged remount with different node splitting; collapse/reopen; source changed between selection and Add; stale async hash completing after navigation or replacement. These need actual browser/Electron Range tests, not only string-array tests.

### Interaction handling

| Interaction                           | Concrete handling                                                                                                                                                                                                                                                                                               |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dragging across an existing highlight | Track the pointer gesture. Mark it as selection when it creates a noncollapsed selection or becomes a drag; suppress that gesture's highlight click even if focus subsequently collapses the selection. Only an ordinary primary click with no selection opens a comment. Preserve link/control defaults.       |
| Clicking Add note                     | Retain the captured candidate through focus entering the action/popup. Pointer activation can prevent the action's pointer-down focus change while its click opens the editor. Keyboard focus into the action is also allowed; do not clear the candidate merely because the browser selection collapses.       |
| Clicking outside the popup            | Use upstream dismissal without cancelling the outside pointer event. Save an existing annotation edit; discard an unadded editor. Do not restore focus for this path, so the clicked control receives its normal click and focus.                                                                               |
| Escape                                | Close through Popover, save an existing edit or discard an unadded editor, then forward trigger focus to the saved opener. If it is gone, resolve the same source block in the active session, otherwise the annotation count, otherwise the transcript focus target. Never focus another conversation.         |
| Scroll/resize                         | Listen to scroll in capture phase for the transcript and its ancestors, plus window resize. Dismiss the anchored action/popup; keep added annotations but discard unadded editor state. Ignore popup-internal scrolling. Clean listeners on root replacement/unmount.                                           |
| Clicking a source quote               | Open the comment popup using the clicked quote's rectangle. Do not scroll or expand the original source. The popup therefore cannot dismiss itself through a navigation-induced scroll.                                                                                                                         |
| Typing a comment                      | Key comment rows by immutable annotation ID and read the current body through an accessor. Keep the same textarea mounted during edits; body changes must not change its key. Focus once when entering edit mode. Preserve the approved identical font, padding and content sizing between display/edit states. |
| Transcript remount while editing      | Keep the popup outside the message list. If its anchor disappears, dismiss; save existing annotation edits and discard unadded editor state. A source-anchored popup reopens against newly resolved content. A quote-anchored popup does not require the original source to be mounted.                         |

These are implementation rules, not claims that the full production integration has already passed them.

## Prompt and transcript representation

The agent must receive readable annotation content in `text`; do not assume it sees metadata. Format each item with its comment first, quoted source beneath, and a source message reference for context. Treat selected text as quoted context. Use escaped/length-safe delimiters rather than interpolating arbitrary quotes into markup. Do not introduce a special response-directive protocol as part of this feature.

Use one proposed `oc-ui/session-prompt` metadata envelope for newly sent messages containing comments:

```ts
{
  version: 1,
  instruction: "Please address these comments.",
  reviewComments: [], // Existing SentReviewComment shape.
  annotations: [],   // TranscriptAnnotation records, in creation order.
}
```

At least one comment array must be nonempty. Plain prompts continue using their existing text-only path. This is an oc-ui convention carried by the existing OpenCode prompt API, not a new server endpoint. Validate version, nonempty bodies/quotes, finite integer bounds, source fields and unique annotation IDs before custom rendering. Render user strings through normal escaped JSX. An unsupported or malformed display payload falls back to the original message text instead of hiding content.

Keep existing `oc-ui/code-review` version 1 readable through a legacy fallback in the session-prompt reader. Existing sent history does not need a migration. New sends use one envelope with one instruction authority, avoiding two independently normalized copies. One composition function controls section order: instruction once, code-review section if present, then annotation section if present. Reuse the existing review comment schema and formatting, moving its section generation under this composition rather than concatenating two complete prompts. Remove the obsolete review-only write path once callers/tests use the new entrypoint; retain the legacy read path. Do not teach each card to decode competing envelopes.

Render the original instruction once in the user bubble, retain the existing code-review card, and render the annotation card as a sibling below the bubble inside the same `data-message-id` article. An annotation-only send has no empty bubble. Existing attachment labels remain. The transcript's SDK message list remains the authority for message ordering and sent cards.

## Submission, retries and highlight continuity

The pinned Solid SDK already inserts an optimistic user message with the submitted metadata. Its durable inbox event updates that same ID; a rejected call retracts its local row only if no durable echo acknowledged it. Reuse this behavior. Do not build another optimistic transcript or keep a second permanent collection of sent annotations.

1. `createSessionComposer.submit` rechecks the complete availability condition, including transcript loading/error. Today the visual disabled state and imperative submit guard differ on loading; integration must close that gap.
2. Finish any existing inline annotation edit and close the popup first, discarding any unadded new-note editor. Then capture instruction, review comments and added annotation comments together for the originating session. Own one immutable request snapshot and set submitting state before calling the SDK.
3. Give the request an explicit SDK-compatible message ID and retain it with the exact payload until admission is confirmed or the user replaces/discards that request. The installed schema package supplies `SessionMessage.ID.create()`; declare that package as a direct dependency at the same pin if using its factory, rather than importing a transitive filesystem path or inventing an ID format.
4. Move the captured annotations out of the active draft collection into the immutable request snapshot. The composer count disappears for those annotations immediately. In the same synchronous turn, call `runtime.data.session.prompt`; its optimistic message supplies the transcript card and the same source highlights. The snapshot is rollback data only: do not render it as another draft collection or another transcript message. Handle a synchronous throw through the same restoration path. This replaces the earlier proposal to keep the submitted annotations visible in both composer and transcript while awaiting admission.
5. On success, call the single request-completion operation described below. Source highlights continue to come from the SDK message metadata. Completion updates only the originating session, even if another conversation is open.
6. On ordinary failure, the SDK retracts its unacknowledged optimistic message. Restore the captured annotations, with their original IDs, order, source positions and comments, to the originating session's active drafts. Merge without replacing newer entries. The count returns and the same source highlights are reconstructed from the restored records. Keep the exact request ID/payload for an unchanged retry. The failed SDK card is gone, so there is no duplicate draft/sent presentation.
7. Account for the narrower response-loss case separately: the SDK may keep the message after rejecting the HTTP call because a durable server echo already acknowledged it. After the SDK's rejection handler has completed, a retained matching row for this request is evidence under this pinned SDK rollback contract; an optimistic row seen while the promise is still pending is not. Call the same request-completion operation rather than restoring a second composer copy. If acknowledgement arrives later, after restoration, call that operation to remove only unchanged restored entries belonging to that exact failed request and finalize its text/review/error state. Use the existing reactive SDK message data; do not introduce another event stream or outbox. Suspend failed-request acknowledgement checks while a retry is pending, so its new optimistic row is not mistaken for a server acknowledgement. This ordering is a required focused integration test.
8. When admission remains unconfirmed and the draft was restored, show “Couldn't confirm the message was sent. Your draft has been restored.” Retrying unchanged content reuses the same ID and byte-equivalent payload. Editing the content constitutes a new message and needs a new ID; never reuse an old ID with a changed payload. Keep the failed-request association while its restored entries can still be reconciled; replace or clear it when a new send takes ownership or the session is deleted. Until then, late acknowledgement clears only unchanged restored entries; newer edits and removals are preserved. No automatic retry loop is needed.
9. Delete/dispose cleanup invalidates outstanding local completions, so a late result cannot recreate a removed session's drafts or popup. The SDK still owns the underlying request and server message.

`completeSubmission(request)` is one private operation in `createSessionComposer`, used by successful HTTP responses, acknowledged rows retained after rejection, and delayed acknowledgement of a restored request. It is safe to call more than once and uses the original session/request identity throughout. It:

- removes only unchanged annotations restored from this exact request, if restoration occurred;
- clears submitted composer text and code-review drafts only through their existing unchanged-snapshot guards, preserving newer edits;
- clears only the error and submitting state owned by this request, never those of a newer attempt or another session;
- releases its rollback payload, retry identity and failed-request associations after reconciliation.

Guard every callback with request identity and disposal/session-deletion state. No success branch repeats a partial version of these steps. A failed request whose acknowledgement is still unknown retains its snapshot for rollback/retry; it does not call completion.

| Phase                                          | Composer annotation count | Annotation card            | Highlight record used              |
| ---------------------------------------------- | ------------------------- | -------------------------- | ---------------------------------- |
| Draft                                          | Included                  | Absent                     | Active draft                       |
| Sending                                        | Submitted items removed   | SDK outgoing message       | That message's annotation metadata |
| Confirmed                                      | Submitted items absent    | Same SDK message           | Same metadata                      |
| Failed without acknowledgement                 | Restored                  | SDK removes failed message | Restored draft                     |
| Response lost, server acknowledgement received | Submitted items absent    | Acknowledged SDK message   | That message's metadata            |

The request snapshot necessarily contains a copy of the annotation data so rollback is possible. It is not a second visible ownership state. Browser highlight objects are always derived from the current owner and are never the backup.

The installed SDK source documents admission idempotency, but the implementation acceptance test must confirm same-ID retry and metadata round-trip against the pinned server. Its source also preserves optimistic/admitted rows during message sync races. These are reasons to use that SDK path, not to duplicate it in oc-ui.

## Verification and implementation slices

1. **Data and prompt composition.** Add the local annotation schema/store and explicit session-prompt composer. Cover plain text, review only, annotations only, both, malformed metadata and failed submissions. Preserve existing review rendering.
2. **Actual transcript integration.** Add source markers and the shared Range/highlight coordinator. Move the approved popup into production-owned components and reuse them in Storybook. Cover formatted multi-node selections, repeated words, tables, code, emoji, outside selections, excluded controls and collapse/remount.
3. **Connected flow.** Connect the shared draft store, real Composer count, prompt submission and sent card. Cover session switching during send, failure/retry, source highlight continuity, annotation-only sending, coexistence with reviews and deleted-session cleanup. Exercise shared completion through HTTP success, rejection after acknowledgement and delayed acknowledgement after restoration; verify unchanged text/reviews/errors are finalized and newer edits survive.
4. **Acceptance.** Exercise the real feature in Electron against the pinned server and confirm metadata round-trip. Check first open/reopen, narrow/resize/scroll, idle/running/loading/error/disconnected states, outside click, keyboard/IME/Escape/focus, overlapping annotations, remount and unchanged-source validation. Verify that added annotations survive navigation, unadded editors do not, and quote clicks open a popup without scrolling. Keep only the useful Storybook scenarios, backed by production components.

After implementation, run root `pnpm check` and `pnpm test` and resolve their findings. Tests should cover distinct failure modes, not duplicate every UI permutation. The implementation has unit and Storybook coverage; the real-server round-trip remains a separate acceptance gate.

## Evidence and limits

The design rechecked the current `ConnectedApp`, `ConversationRegion`, `createSessionComposer`, `createSessionWorkspace`, `TranscriptView`, message renderers, draft stores, and code-review codec. Verify-tier graph discovery/trace used the exact worktree project `Users-alex-.codex-worktrees-e0a3-oc-ui`, ready fast generation `2026-09-02T13:48:49Z`; relevant production paths had no recorded coverage gaps and matched metadata. Current source was also read directly. The prototype, documentation and installed packages were inspected directly where outside that graph scope. Coverage is best-effort, not proof of completeness.

The initial design inspected SDK/UI `0.0.0-beta-18155`; integration with main retains its upgrade to `0.0.0-beta-18866`. Popover supports a virtual rectangle anchor and has its own Escape/outside-focus behavior. LineComment exposes comment, selection and action slots; it does not supply the full inline-edit lifecycle. The approved local popup therefore retains meaningful behavior while reusing upstream controls.

The production implementation replaces the earlier selection experiments. No additional broad spike is needed. The concrete implementation gates are Electron Range/highlight behavior across real message blocks and the pinned server's prompt/metadata lifecycle. If either fails, investigate that bounded failure rather than restarting changed-source recovery research.

## Acceptance status (2026-09-03)

Root `pnpm check` and `pnpm test` pass (76 test files, 501 tests).

Integration with main also passes both root gates (77 test files, 537 tests). The combined version retains main's managed worktrees, SDK upgrade and shared focus rules. Native inspection confirmed the saved annotation and blue source underline load with the upgraded SDK. The annotation composer retains its scoped neutral focus color.

- Browser checks exercised real text selection, adding and reopening annotations, inline editing with a stable caret, outside-click focus, navigation persistence, failed-send restoration, successful simulated retry, read-only sent quote popups, sent-highlight restoration after conversation switching, 390px layout, resize dismissal and disabled running-state edits. Storybook uses the production components with a simulated SDK transport.
- Independent review corrections cover stale request completion, delayed acknowledgement preserving newer edits, popup focus fallback and transcript unmount cleanup. Regression tests cover these failure modes.
- The actual Electron app launched through `pnpm dev` with isolated app settings and connected to its pinned built-in server. Native checks passed for text selection, adding a draft, reopening from the count and highlight, inline editing, Escape focus restoration, outside-click composer focus, and edited-draft/highlight restoration after switching conversations. The broader layout and transport-failure cases above were checked in Storybook, not repeated fully in Electron.
- With explicit testing authorization, a dedicated `Annotation acceptance test` conversation (`ses_f985430a1ffeLJRG6YanUH4Cw5`) verified the live-server round-trip. An annotation-only message asked about a selected sentence; the model answered correctly, the composer count cleared, and the transcript card appeared collapsed. Reloading Electron restored the saved card and clickable source highlight; the popup showed the saved comment as read-only. An independent read through the pinned SDK confirmed the exact annotation ID, quote, body, source offsets and digest in message metadata. Repeating the original request ID and payload returned the existing message: the full context was unchanged, with one matching message and an empty inbox. This verifies server idempotence; no live network failure was injected. The first prompt used a model requiring an unavailable opt-in, so the test switched to the already configured GLM-5.3-Flash without changing provider consent settings.
- A root-suite accessibility finding exposed low contrast in existing code-review selection colors. The diff renderer now uses the existing neutral selected-surface token for its selection mix instead of the bright default selection color.

### Controller refactor

The interaction controller now uses one state and delegates DOM selection and highlight lifecycle to `createAnnotationHighlights`. Draft comment edits no longer rehash highlights or decode sent metadata. Selection hashing starts only when a note is added. The upstream Popover owns Escape and outside-click dismissal; its trigger focus is forwarded to an explicit opener or composer fallback. New regression coverage checks unchanged source descriptors and conversation switching during pending hashing.

The earlier controller-refactor verification was blocked by macOS screen capture error -3811. Screen capture worked during the later complexity-cleanup verification, allowing the native checks recorded above.

### Complexity cleanup

The composer now derives submitting state from its active request and error text from its error request. The failed-request collection and identity guards still reconcile uncertain sends. Discarding annotation drafts is one guarded controller operation shared by the connected view and Storybook. User-message rendering derives its display fields once, and tool states share their marked input rendering. Source text-node offsets use the existing node table directly; element boundaries retain their range comparison path.
