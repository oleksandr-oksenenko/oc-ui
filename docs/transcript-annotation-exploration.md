# Transcript annotations: revised design and feasibility

Explored on 2026-09-02 at `fd06a36` in worktree `e0a3`. This is historical investigation and browser-spike evidence. The feature was subsequently implemented; this report is not the current specification.

Revised after the user's clarification: **annotations are created only after the model turn finishes, against unchanged source text.** This document records the approved interaction and feasibility evidence. The [full implementation design](transcript-annotations-design.md) is the sole current specification and implementation record. All proposed flows and implementation suggestions below are historical. The [source-recovery spike](transcript-source-recovery-spike.md) is historical evidence; its streaming/changed-source recovery machinery is outside the feature's scope.

## Historical prototype

The original exploration used a fixed source passage and simulated sending. That prototype was subsequently replaced by production-owned annotation components, the real Composer and the real submission controller with a simulated SDK transport. The retained stories are Interactive, After Sending, Running Turn and Narrow Mode. The copied composer and duplicate highlight-comments experiment were removed.

Current behavior and acceptance status belong in the [implementation design](transcript-annotations-design.md). The findings and proposed flows below describe the investigation at the time, not an alternative implementation contract.

## Decision

We can support selectable content throughout the transcript. There is no technical requirement to restrict annotations to assistant replies.

The useful boundary is **rendered text content belonging to a server message**, rather than message role. User messages, assistant Markdown, expanded reasoning, tool input/output, shell output, and expanded context/skill/compaction bodies can share selection, annotation, and highlighting logic. Code blocks and tables are part of that same text surface. Ordinary timeline text is also selectable.

This is a modest extension over assistant-only support, not a free switch. Each content container needs a source marker, and highlights must return when collapsed content is reopened. A literal promise to annotate every pixel or label would need more work: collapsible headings are buttons with selection disabled, images are not text, and hidden/truncated data cannot be selected.

Approved scope: implement shared selection handling for explicit content containers across message types. Exclude interactive controls, transient loading/status UI, and pending forms. Keep a selection within one content surface and message; users can collect several annotations to cover separate sources. The user approved these boundaries before requesting the Storybook design exploration.

## Agreed product behavior

- Annotation is available after the model turn finishes. Original message content is unchanged by annotation and sending.
- Selection reveals an Add note action; it does not open the editor automatically.
- A small popup accepts a required question or note.
- Adding closes the popup and increments one annotation count row above the composer, using the existing code-review count treatment. Draft source highlights are clickable and reopen the same comment popup for editing or removal.
- The comment card is the popup's only visible surface, with no extra frame or Close footer. Clicking outside dismisses it. Clicking draft comment text edits it inside the same card, keeping the quote and red trash icon in place. Changes are kept as the user types, matching code reviews. Enter finishes editing in place; Escape or clicking outside dismisses the popup and keeps the edits. Shift+Enter adds a line break, and finishing an empty comment removes it. There is no separate editing dialog or Save/Cancel footer for existing comments; hovering an annotated passage shows a pointer cursor.
- Several quote/note pairs can accompany one message.
- Draft annotations survive switching conversations; restart persistence is unnecessary.
- Draft and sent source passages remain highlighted after sending. Clicking a sent highlight reopens the same comment; the current Storybook exploration keeps this state in memory, while reload persistence is unspecified.
- Sent annotations appear as a separate transcript element, collapsed by default. The comment is primary, with its quoted source shown at the bottom. Sent content is assumed to be read-only for implementation; this is an implementation assumption, not a new product decision.
- Assistant replies were the fallback scope if broader support proved difficult.

## Complete flow and proposed edge behavior

1. Once the selected conversation is idle and its transcript is loaded, the user selects text. Show Add note for an eligible selection. During a running turn, disable annotation actions while preserving normal text selection and copying.
2. Capture the full projected source text, selected positions, and readable quote together before the popup takes focus. Hash that immutable source snapshot and verify the current source still matches at Add. The popup accepts a required note; Add creates a draft highlight and updates the single annotation count row above the composer.
3. Clicking a draft highlight reopens its comment popup. The user can edit the note or remove the annotation there; removing it removes its highlight. Overlapping annotations remain separate pairs and the remaining ranges stay highlighted.
4. Keep added annotations in the existing conversation-level draft lifetime, keyed by session. Switching away removes that conversation's visible highlights; switching back rebuilds them against its unchanged content. No disk persistence is required.
5. Send the composer text and all added quote/note pairs together through the existing prompt path. Annotation-only messages are valid. Preserve existing code-review comments when both kinds of comments are present.
6. At submission, move the added annotations out of the composer count into an immutable rollback snapshot; the SDK's outgoing message supplies their card and source highlights. On unacknowledged failure, restore them to the originating session's drafts. Normal success and confirmed server acknowledgement use one completion operation to release the snapshot and clear only unchanged submitted text/reviews and request-owned errors. Preserve newer edits and other conversations. The full design specifies late-acknowledgement handling.
7. Render the submitted quote/note pairs in a separate transcript element, collapsed by default. Show the note first and the quoted source at the bottom. Clicking a source highlight opens its comment there; clicking its quote opens the same popup at the quote without scrolling or expanding the original source. If the message is unavailable, the captured quote and note remain readable.

The approved selection boundary allows multiple paragraphs inside one identified content block and message. Added annotations survive conversation switches. An unadded note is temporary popup state: dismissal, navigation or selection replacement discards it without sending it. Existing annotation edits remain saved on dismissal. Recheck annotation eligibility on Add as well as on selection; if a turn begins externally, retain added drafts and wait for idle before accepting a new annotation.

Use the existing running/loading/connection/submission state to determine availability, rather than a timer that guesses whether streaming has finished. The current composer already uses those states. The final integration must verify the transition from running to a loaded final transcript.

## Remaining complexity

| Area                     | Work that remains                                                                                                                                                                      | Assessment                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Selection and popup      | Preserve selection before focus changes; handle keyboard selection, Escape, focus return, scroll, resize, and screen edges. Reuse the installed popover's rectangle anchor.            | Ordinary UI work with careful interaction testing.                                        |
| Exact source highlights  | Capture offsets across formatted text nodes and reconstruct them when unchanged content remounts. Keep readable table/code quotes separate from DOM offset text, including after send. | The most technical part; basic feasibility already demonstrated.                          |
| Selectable scope         | Mark each eligible content block; exclude controls and transient UI. Expanded tool/reasoning text uses the same mechanism.                                                             | Bounded renderer integration; broader than assistant-only but no new selection algorithm. |
| Draft and send lifecycle | Isolate conversations, keep one composer count row, move submitted annotations into a rollback snapshot, restore unacknowledged failures, and share one confirmed-completion path.     | Existing composer and review-draft patterns cover the ownership model.                    |
| Sent representation      | Send readable quote/note pairs in a separate collapsed transcript element, with the comment first and quoted source at the bottom; retain source highlights and popup access.          | A local extension of the current prompt/display convention.                               |

No general changed-text matching, stream event correlation, append tracking, edit history, or reconnect replay is required. Sources are completed and unchanged when annotated. The current in-memory Storybook exploration retains post-send highlights; persistence across reload is unspecified. No further general spike is justified by the revised flow. Actual Electron selection/highlight behavior and the integrated lifecycle still need verification during implementation; browser feasibility alone is not full feature validation.

## Rendering and source map

All paths below are repository-relative.

`apps/desktop/src/renderer/components/App/ConnectedApp/Conversation/SessionPane/TranscriptView.tsx:31` owns the common scroll container. Its `renderMessage` function at line 103 dispatches the complete SDK message union. The graph trace is `ConnectedApp → ConversationRegion → TranscriptView → message renderers`.

All rendered server-message roots expose `data-message-id`. The separate changes/diff panel is outside this investigation; its rendering model must not be confused with transcript code blocks.

| Content                                                            | Existing implementation                                                      | Feasibility and extra work                                                                                                                                              |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User text                                                          | `TranscriptView/UserMessage.tsx:25`                                          | Plain DOM text; same selection mechanism as replies. Mark the body separately from attachments and nested review cards.                                                 |
| Assistant prose, headings, lists, inline code, code blocks, tables | `TranscriptView/AssistantMessage.tsx:29`, `AssistantMessage/Markdown.tsx:38` | Sanitized light-DOM HTML. Capture rendered text, not Markdown source offsets.                                                                                           |
| Reasoning                                                          | `AssistantMessage/ReasoningBlock.tsx:17`                                     | Ordinary paragraph once expanded. Add source identity and an expansion path.                                                                                            |
| Tool input/output                                                  | `AssistantMessage/ToolCall.tsx:67`                                           | JSON/text in `pre` elements. Distinguish tool input, each output item, and file metadata. Tool ID is available.                                                         |
| Shell output                                                       | `TranscriptView/ShellMessage.tsx:38`                                         | Ordinary `pre` once expanded. Only the currently supplied output is available. Command text lives in the nonselectable heading button.                                  |
| Skill, system/synthetic context, compaction summaries              | `SkillMessage.tsx:8`, `ContextMessage.tsx:12`, `CompactionMessage.tsx:12`    | Ordinary text inside collapsibles; same capture path with source and expansion markers.                                                                                 |
| Agent/model/location timeline                                      | `TimelineRow.tsx:11`                                                         | Plain text with a message ID. Selection works; these are generated summaries rather than raw message bodies. Inclusion is a product boundary, not a browser limitation. |
| Attachment names, tool file labels, sent code-review text          | `UserMessage.tsx:20`, `ToolCall.tsx:90`, `UserMessage/CodeReviewCard.tsx:23` | Text is ordinary DOM, but labels and nested items need explicit field/item identity. File contents and image pixels are not made selectable by this.                    |
| Expand/collapse headings                                           | Pinned UI `src/components/collapsible.css:16`                                | `user-select: none`; clicking toggles the section. Requires deliberate interaction changes to annotate the heading itself.                                              |
| Loading/error/working UI and pending forms                         | `TranscriptView.tsx:53`                                                      | Exclude transient client UI and form input; a containing transcript element alone is not enough to establish a source message.                                          |

The table uses `TranscriptView/` paths relative to the `SessionPane/` directory above; `AssistantMessage/` is inside `TranscriptView/`.

## Browser spike results

A temporary Storybook story imported the real `TranscriptView` and existing Rich/Markdown fixtures. It recorded native pointer selections, cloned a browser Range, replaced message objects, appended Markdown, and attempted to restore the selected text. The probe was removed from the repository after testing; its source is retained as a local artifact:

`/Users/alex/.codex/visualizations/2026/09/02/01a06255-3d5d-74e3-bb29-eb75229938d9/transcript-selection/TranscriptSelectionSpike.stories.tsx`

To reproduce, temporarily copy it into `apps/desktop/stories/`, run `pnpm storybook --ci`, and open `/iframe.html?id=spike-transcriptselection--probe&viewMode=story`. Remove the copied story afterward. It is a diagnostic fixture, not production-ready annotation code or an approved visual design.

| Experiment                                                   | Observed result                                                                                                                                                       |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Select user prompt                                           | Captured text with source `user-1`.                                                                                                                                   |
| Select reasoning paragraph                                   | Captured the sentence with source `assistant-1`.                                                                                                                      |
| Select tool output                                           | Captured `migrations: ready` with source `assistant-1`.                                                                                                               |
| Select shell, skill, compaction, synthetic context, timeline | Captured text with the corresponding message IDs.                                                                                                                     |
| Select code block                                            | Captured `const release = { status: "ready", checks: 3 };` with source `assistant-markdown`.                                                                          |
| Select across normal, bold, italic text                      | Captured the complete rendered sentence without Markdown punctuation.                                                                                                 |
| Replace message objects or append Markdown                   | The saved Range's text became empty. Its start node could still report connected, so `isConnected` alone is insufficient.                                             |
| Find a unique quote after remount                            | Reconstructed the correct Range and applied a CSS Custom Highlight.                                                                                                   |
| Select the second `Passed` in a table                        | Quote-only matching was ambiguous; saved text positions restored the occurrence in the `Tests` row.                                                                   |
| Select two table rows                                        | Native selection was `Types\tPassed\nTests\tPassed`; DOM Range text contained different newline separators. Naive `textContent.indexOf(selection.toString())` failed. |
| Restore table selection using saved DOM text positions       | Correct cells were restored after replacing message objects, and native selection again produced the same tab/newline text.                                           |
| Collapse a tool containing the captured quote                | The body was absent from the DOM. Reopening allowed restoration.                                                                                                      |

CSS Custom Highlight worked in the tested in-app browser, including after browser selection moved to other text. This verifies a candidate mechanism, not Electron compatibility or complete feature behavior.

## Minimal selection and highlight implementation

1. **Snapshot text immediately.** The popup takes focus; never leave the annotation dependent on the current browser selection or only a stored Range. Keep the comment as the primary popup content and the quote as its contextual footer.
2. **Keep source and display text distinct.** Store the readable quote for the message and positions within an identified rendered content surface for restoring highlights. Native selection text and concatenated DOM text are not interchangeable, especially in tables.
3. **Restore only unchanged content.** Rebuild the range at its saved offsets within the same source block and check consistency with the captured content. Repeated words are unambiguous because their positions are stored. If content is unexpectedly missing or changed, retain the quote and note without guessing a new location. Do not search for matching quotes elsewhere.
4. **Identify the completed content block.** Store the session/message ID and the field or content position within that completed message. Use the existing tool ID where available and distinguish nested input/output items. Content positions suffice under the unchanged-message rule; they are not a promise of identity across edits. Do not use the message's position in the transcript array.
5. **Handle remounts and collapsed content.** The transcript currently uses `props.messages.map(...)` (`TranscriptView.tsx:85`); Markdown uses `innerHTML`. Saved DOM nodes or Ranges therefore cannot be the durable representation even when text is unchanged. Rebuild draft and post-send highlights from saved offsets when the content mounts. Hidden bodies retain their annotation and regain their highlight on expansion. Sent annotations use a separate collapsed transcript element; opening a source highlight reopens its comment without requiring exact passage expansion in the sent element.
6. **Share one policy.** One selection owner can validate both endpoints, exclude controls, position Add note, and emit an annotation. Individual renderers should identify their content rather than each implementing mouse-selection behavior.
7. **Retain normal controls.** Do not turn a collapse button into an editor trigger or suppress normal copying/link interaction globally. The popup action must capture/preserve the selection before focus moves.

This positioning and remount work applies to assistant-only support too. Broader support primarily adds content markers and collapse handling. Offsets are needed for draft and retained post-send highlights; the sent representation also needs the captured comment, quote, and source message reference.

## SDK, UI, draft, and send reuse

The installed `@opencode-ai/client` and `@opencode-ai/ui` both match the repository pin `0.0.0-beta-18155`.

- SDK `dist/promise/generated/types.d.ts:2258` supplies `SessionMessageUser.id` and arbitrary JSON metadata. Assistant text/reasoning shapes at lines 707/712 have no part IDs; tool shape at line 2766 does have an ID.
- SDK `dist/promise/generated/client.js:298` sends both `text` and `metadata` through the existing prompt endpoint. There is no need to invent an annotation server endpoint. An annotation metadata shape would be an oc-ui convention, not an OpenCode feature.
- `apps/desktop/src/renderer/opencode/code-review.ts:62` already combines readable prompt text with validated, namespaced/versioned display metadata. Reuse that approach; its file-path/line-range types do not represent transcript selection.
- `domain/drafts.ts:17` is an in-memory store keyed by session ID. `createSessionComposer.ts:45` provides conversation-level draft ownership; the annotation collection can have the same lifetime. Do not store it inside a message renderer that remounts on navigation.
- `createSessionComposer.ts:97` owns submission. Capture text and annotation pairs together and admit one prompt. The full design extends this owner with annotation take/restore and one shared completion operation, using SDK message metadata for outgoing/sent highlights. Compose review comments and annotations in one message rather than choosing one kind through mutually exclusive dispatch.
- `review-drafts.ts` provides a revision-guarded capture/clear pattern, but its file comparison keys are unrelated to transcript sources.
- Pinned UI `LineCommentEditor` already offers required text, controlled value, submit/cancel, focus, and keyboard handling, with a generic selection slot. Reuse it if its actual layout and interaction fit the popup; do not recreate it solely because of its name.
- Pinned UI `Popover` provides controlled open state and dismissal/focus behavior. Its inherited Kobalte props include `getAnchorRect`, which is forwarded to the root and converted into a virtual Floating UI reference. Supply the selected text rectangle through that existing API; no new positioning library is needed. The wrapper still renders a trigger node. A captured rectangle must be repositioned or dismissed on scroll/resize; a live Range must be invalidated on remount. This corrects the initial scout finding that virtual anchoring was unavailable.
- `opencode/transcript.ts:13` synchronizes all available message pages. Source highlights and their comments can target the existing `data-message-id` after hydration. There is no current transcript URL/hash contract; use an owned callback, with an honest unavailable-source result if the message is gone.

## Scope and evidence limits

Two independent read-only agents inspected local transcript rendering and upstream SDK/UI plus draft/send ownership. The parent combined their findings with the browser experiments. Both scouts favored assistant-only as the lowest-risk slice; the browser evidence supports the broader content-body recommendation because the fundamental restoration issues also occur in assistant Markdown. Literal unrestricted selection still needs the boundaries above.

Graph project: `Users-alex-.codex-worktrees-e0a3-oc-ui`, fast generation `2026-09-02T13:48:49Z`, ready with 1,280 nodes and 3,441 edges. Relevant symbol searches and traces were fully returned. Exact source paths were coverage checked; relevant source had no recorded gaps except CSS line 694, which was read directly. Tests/stories and installed dependencies were read directly where excluded from graph indexing. Coverage remains best-effort.

The diagnostic probe did not implement the note popup, the composer count row, session switching, server round-trip, automatic source expansion, or multiple highlight lifecycle. No Electron app or OpenCode server was launched for this investigation, and no full feature acceptance claim is made. Browser Storybook behavior, source inspection, and the specific experiments above are the evidence for feasibility.

Repository validation after removing the original probe: `pnpm check` passed; `pnpm test` passed all 467 tests across 70 files. The test run printed dependency-prebundling and jsdom `scrollTo` warnings but exited successfully. These are baseline checks, not tests of a completed annotation feature. Dependencies were installed with the frozen lockfile, and the temporary Storybook process was stopped. The subsequent finished-turn revision changes documentation only; it does not implement or retest the feature.
