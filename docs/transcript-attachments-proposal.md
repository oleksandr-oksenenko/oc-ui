# Transcript attachment research and proposal

Research date: 2026-09-26. Scope: attachments sent with a user message, as they
appear in the transcript. The proposal lives only in Storybook.

## Inventory

The pinned OpenCode client and UI are **2.0.3**. `SessionMessageUser` carries
`files`, `agents`, `skills`, and arbitrary metadata; there is no general attachment
union covering all the product concepts below.

| Kind                   | Origin and saved representation                                                                                               | Current transcript                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Images                 | Picker, paste, drop, or browser capture; `files[]` with inline base64 and an image MIME type                                  | Thumbnail inside the user bubble; the existing `ImagePreview` enlarges it in a modal                         |
| Ordinary files         | Picker, paste or drop; `files[]` with name, MIME, source and data                                                             | Filename pill; no open/download control                                                                      |
| Pasted text            | Composer converts a large text paste to a named `text/plain` file                                                             | Same filename pill as other files; provenance is not separately saved                                        |
| Code review comments   | Diff selection, selected code and body; `oc-ui/session-prompt` metadata                                                       | Collapsed group inside the user bubble; expanded path, range, code, then comment                             |
| Transcript annotations | Selected transcript quote and source descriptor; same metadata envelope                                                       | Separate collapsed card across the transcript width; body and clickable quote when its callback is connected |
| Browser annotations    | Element or area selection, comment and screenshot; formatted text is appended to the instruction and image files are attached | Markdown instructions and a large JSON block in the user bubble, followed by screenshot thumbnails           |
| Skills                 | Prompt editor selection; `skills[]`, optionally with mention offsets                                                          | Matching mentions become inline chips; other skills become filename-like pills                               |
| Agents                 | `agents[]` in SDK/history messages                                                                                            | Same named pills as files and non-inline skills; the current composer does not populate this array           |

PDFs, archives, audio, video and other non-image MIME types all follow the generic
file renderer. Their presence does not imply model support or a built-in viewer.
The SDK can describe a file with an inline or URI source; image display still uses
the saved bytes, never the Electron host's filesystem. Files without names fall
back to “Attached file” or “Attached image”. File descriptions and file/agent
mention offsets are not currently displayed by `UserMessage`.

Review metadata version 1 under `oc-ui/code-review` remains readable. Invalid or
unsupported custom metadata falls back to the original prompt text. Browser
annotations have no structured sent-message metadata today: neither a filename
nor a text prefix is sufficient to reconstruct their identity safely.

The composer limits one draft to 16 files, 2 MiB per file and 24 MiB in total.
Browser capture separately permits 8 annotations and 8 MiB of screenshot bytes,
then passes through composer admission. These are admission rules, not new
transcript display limits. Tool outputs, assistant-generated files, system context,
skill activity and queued messages are adjacent surfaces, not composer attachments.

## Source map

- [UserMessage](../apps/desktop/src/renderer/components/App/ConnectedApp/Conversation/SessionPane/TranscriptView/UserMessage.tsx): display classification and placement.
- [Session prompt](../apps/desktop/src/renderer/opencode/session-prompt.ts): review/annotation metadata, legacy fallback and original-text fallback.
- [Composer owner](../apps/desktop/src/renderer/components/App/ConnectedApp/Conversation/createSessionComposer.ts): file/text admission, skill attachments and submission.
- [Browser annotation formatting](../apps/desktop/src/renderer/components/App/ConnectedApp/Browser/browser-annotations.ts) and [browser owner](../apps/desktop/src/renderer/components/App/ConnectedApp/Browser/createSessionBrowser.ts): element/area records become text plus image files.
- [ImagePreview](../apps/desktop/src/renderer/ui/ImagePreview.tsx): saved image bytes, modal, Escape and focus handling.
- [PromptInstruction](../apps/desktop/src/renderer/components/App/ConnectedApp/Conversation/SessionPane/TranscriptView/UserMessage/PromptInstruction.tsx): inline skill mentions.
- Installed client: `apps/desktop/node_modules/@opencode/client/dist/promise/generated/types.d.ts`, `PromptFileAttachment`, `PromptFileSource`, `PromptSkillAttachment`, `PromptAgentAttachment`, `SessionMessageUser`.
- Installed UI: `Collapsible`, `LineComment`, `Icon`, and `FileIcon` sources. The prototype reuses upstream disclosure/icons and the existing local image modal. `LineComment` is useful for the current annotation display, but does not supply the proposed common attachment list.

## Visual inspection

The `Current Inventory` story renders the actual production `UserMessage`, using
typed representative messages. It is a reproducible baseline, not a recreation.

1. **Mixed attachments, collapsed — inconsistent grouping.** Reviews are inside
   the bubble, annotations outside it. Files, agents and skills have the same pill
   treatment. Images are identifiable but dominate adjacent filenames.
2. **Review and annotation details, expanded — readable but uneven.** Review
   comments use code-like typography and put the comment after its source. Text
   annotations put the comment first. The two kinds have unrelated widths and
   disclosure styling. Existing quote opening is unavailable in this isolated
   inventory because no transcript annotation controller is connected.
3. **Browser annotation — excessive transcript detail.** The comment, selector,
   bounds, timestamp and other machine context fill much of the bubble. The
   screenshot is disconnected from its comment by that context. The same generic
   image fixture is used for every screenshot; this verifies layout, not capture
   fidelity in Electron.
4. **Proposed stack — coherent shared placement.** Common rows sit below the
   message, with the same icon, title, secondary text, borders and spacing. Visible
   disclosure arrows distinguish expandable groups from inert file rows.
5. **Expanded, narrow and dark proposal — visually checked.** Comments precede
   paths, ranges, code and quotes. Long paths wrap. At 390px the document width
   remains 390px, without horizontal overflow. Existing theme tokens support both
   light and AMOLED surfaces.

Screenshots were captured and inspected in the Codex in-app browser during this
run. The task's visual artifact folder contains numbered baseline and proposal
captures. Automated Storybook accessibility checks complement those images;
screenshots alone do not establish full accessibility compliance.

## Proposed design

Use one attachment stack within the originating message article, immediately below
its instruction. Keep the instruction's existing bubble and inline skill mentions.
An attachment-only message has the stack without an empty bubble.

- **Shared shell:** a neutral border, aligned leading visual, readable name and
  muted type/source. Use existing product tokens and upstream icons.
- **Comments:** collapse each semantic group by default. Show comment counts and
  source context. Expansion presents the user's comment first, followed by its
  quote or selected code. Preserve old/new diff-side labels.
- **Images:** put a small recognizable thumbnail beside the filename in the same
  stack. Reuse the existing modal for enlargement and keyboard focus restoration.
- **Files:** show filename and type. Leave the row inert until an actual file-open
  contract exists; do not add decorative download or navigation controls.
- **Named references:** Skills and Agents are excluded from this attachment
  proposal. The current inventory still shows their production rendering, including
  inline skill mentions in the instruction.
- **Large batches:** keep primary content visible and disclose remaining files
  through a counted row. The story demonstrates 16 files, the current draft cap.
- **Browser annotations:** use the same comment group with page, selection and
  screenshot. This is a future-state story requiring structured metadata. Keep
  legacy browser prompts intact; do not infer structure by parsing their prose.

The design trades some compactness in mixed file batches for explicit labels and
predictable alignment. Ordinary one-file messages should use the same row with a
minimal container; a later production implementation can omit a redundant group
heading without introducing another attachment style.

## Ownership and eventual integration

`AttachmentProposal` and its private `AttachmentRow` own presentation and local
disclosure state only. They are story fixtures, not a new domain model or runtime.
No application workflow, data owner or persistence contract changes in this work.

After design approval, `UserMessage` should keep its existing metadata decoder as
the single authority and project that data into the shared presentation. Replace
the duplicated shells of `CodeReviewCard`, `AnnotationCard` and the attachment-pill
list. Preserve article identity, annotation block markers, `onOpenAnnotation`,
mount/remount behavior, keyboard controls, and the image modal. Production
disclosures must retain the current deferred mounting policy.

Browser integration is a separate contract change: preserve comment/source/image
relationships in validated metadata, retain the readable model prompt, and keep
the current fallback for older messages. The visual prototype does not implement
that contract, annotation source navigation, or file reading.

## Stories and verification

Open **Transcript → Attachments** in Storybook. It contains Current Inventory,
Proposed, Expanded, Browser Annotations, Attachment Only, Many Attachments, Narrow,
Dark and Interactions.

The interaction story covers keyboard disclosure, comment details, image modal
opening, Escape/focus restoration and the remaining-files disclosure. Every story
participates in the existing accessibility checks. Visual inspection covers
appearance that those assertions cannot establish.

No production lines are changed. Added code is limited to Storybook fixtures,
presentation and focused interaction coverage; documentation is separate. The
shared story shell replaces no production machinery yet. On adoption, promote
the approved shell and remove this parallel story-only markup in the same change.

Initial proposal run results: root `pnpm check` and the Storybook TypeScript check passed. All nine
attachment stories passed in both the focused and root runs. Root `pnpm test`
passed the two package suites (67 tests) and 1,457 desktop tests, but failed one
existing browser skills test because a session-title tooltip intercepted a sidebar
click. That test passed on its isolated retry (24 other browser tests skipped).
The full root test run is therefore recorded as failed, not as a clean pass.

Initial proposal line accounting: production **+0 / -0 / net 0**; Storybook presentation, styles
and fixtures **+593**; interaction test body **+29**. Two story-only components
were added (the proposal and its private row); no production abstraction or old
machinery was added or removed. No generated source was added. This growth provides
the current baseline and a reviewable replacement before production adoption.

## Compact attachment exploration

Open **Transcript → Attachment options → Compare** in Storybook to see five
equal-width versions of one message. Each uses the same four files, two code review
comments, one transcript annotation and one browser annotation. This comparison
focuses on those attachments; Skills and Agents are outside its scope.

- **A · Chips:** every attachment is visible as a small labelled chip. A selected
  comment group reveals its detail beneath the chips.
- **B · Tiles:** larger item surfaces make each kind and its label easier to scan,
  at the cost of more space.
- **C · Summary:** a short overview compresses the batch; opening it reveals the
  individual attachments.
- **D · Pills:** familiar filename-like pills keep the attachment area light while
  giving comments explicit labels.
- **E · Summary + pills:** the selected direction shows `4 files · 4 comments`
  until opened, then reveals the existing D pills below it. The story-only
  `SummaryPillsOption` reuses `PillsOption` and its comment details. Closing the
  summary removes those controls from the tab order and resets the selected
  comment detail for the next opening. It adds no bordered card or runtime state.

The browser annotation is a visual future state. Existing messages must retain
their saved text and screenshots until structured metadata is available. Narrow
and Dark stories support layout review. The original four options and comparison
were visually checked in light, dark and narrow views. The combined 390px view
showed no horizontal overflow. Root `pnpm check` and the Storybook TypeScript check
passed. All 20 new attachment stories and the nine initial proposal stories passed
in the full test run. The full root `pnpm test` run did not pass: 1,476 desktop
tests passed, while the existing inline skills browser test failed when a sidebar
tooltip intercepted a click, and the unrelated Wide Output Scrolling story failed
an offscreen-row assertion. Both failed cases passed on isolated retries (24 and
36 other tests skipped, respectively). Those retries do not turn the full run
into a pass.

Compact exploration line accounting: production **+0 / -0 / net 0**; new Storybook
files **+1,485**, including **88** lines of interaction test bodies and **1,397**
presentation lines. Removing the earlier proposal's Skill/Agent footer removed
**25** story and style lines, for **+1,372** net presentation lines. Documentation
grew by **39** lines from the initial proposal. Four story-only attachment
presentations and one comparison story were added; no production abstractions or
machinery changed. This growth keeps four visual choices and their focused
interactions available for review. The unchosen options and their duplicate story
markup will be removed when the selected treatment is integrated.

The selected E variant adds a story-only wrapper, styles and focused interaction
story, plus one comparison row. Production code remains **+0 / -0 / net 0**.
This increment adds **174** lines in new Storybook files (**151** presentation and
**23** interaction-story lines) and changes the comparison by **+7 / -1 / net +6**.
It reuses the D pills without copying their file or comment rendering; no
production abstraction or old machinery changes.

For E, the parent reviewer visually inspected the expanded light, dark and 390px
stories and the expanded comparison row. Spacing and wrapping were sound in those
views; the light capture is saved at
`/Users/alex/.codex/visualizations/2026/09/28/summary-pills/expanded.png`.
Root `pnpm check`, the Storybook TypeScript check, all five new E stories and all
three comparison stories passed. The full root `pnpm test` run failed with 1,481
desktop tests passing and two failures outside E. The existing sidebar skills test
hit the session-title tooltip again and passed on isolated retry. The earlier
`Attachments.stories.tsx` interaction could not find its “12 more files” control
after closing the image preview because the page remained `aria-hidden`; it also
failed on isolated retry. The earlier story was not changed for E, and the full
root run remains failed.

## Composer attachment proposal

The current design target is the **composer before sending**. Open **Composer →
Attachment proposal** in Storybook to see attachment pills directly above an
editable draft, model and agent pickers, and Send. The story mounts the real
`Composer` inside a story-only frame that supplies the single visible border;
the attachment display remains a separate Storybook presentation. Default,
Narrow390 and Dark show the same composition at different widths and themes.
The review, annotation and browser pills open anchored detail popups. The composer
preview no longer has a summary or an expand/collapse step.

The earlier transcript stories remain as exploration history. This preview does
not change the real application, its attachment data model or submission flow.

The popups reuse Kobalte's positioning, dismissal and nested dialog behavior.
Their scroll height follows the space available in the viewport. The previous
inline detail panel is removed. Parent visual inspection covered the complete
composer in light, dark and narrow layouts and the anchored review/browser popups.

Prior popup verification: root `pnpm check` and Storybook TypeScript passed. All five composer,
four pills and five summary/pills stories passed, including nested screenshot
preview, Escape/focus return, outside dismissal and keeping the draft intact.
Root `pnpm test` recorded 1,486 desktop tests passing and the same two pre-existing
failures: the sidebar skills tooltip and the earlier attachment image-preview
interaction. The full run remains failed; neither failure was changed here.

Prior popup accounting: production **+0 / -0 / net 0**. The new composer preview adds **123**
Storybook lines, comprising **105** presentation/style lines and **18** interaction
test lines. Existing popup presentation grows by **67** net lines; existing
interaction stories grow by **20** net lines. One private pill/popover helper
replaces the inline detail rendering; no production abstraction or generated code
is added. Documentation is maintained separately in this proposal.

Removing the composer summary keeps the real `Composer` and uses `PillsOption`
directly in the story frame. The collapsed/expanded stories and the summary-only
controls are removed from this preview. This refinement changes production by
**+0 / -0 / net 0**, removes **5** net presentation lines and **5** interaction
test lines, and introduces no abstraction or generated code.

For this refinement, visual inspection and all four composer stories passed,
as did root `pnpm check` and Storybook TypeScript. The root test run passed 1,486
desktop tests and failed only the existing sidebar skills tooltip test. The older
attachment-preview story passed in this run. The full suite is still not a clean
pass.

## Whole image pill trigger

The image thumbnail and filename now sit inside a single `ImagePreview` trigger,
so clicking anywhere on that pill opens the image. The shared component accepts
optional label content; labelled thumbnails avoid repeating that text to assistive
technology. Existing thumbnail-only callers keep their original behavior. The
composer interaction covers filename clicking, keyboard activation, Escape and
returning focus to the pill without changing the draft.

This refinement changes production by **+9 / -1 / net +8** lines, removes **4**
net Storybook presentation/style lines and adds **13** interaction test lines.
It removes the separate non-interactive image-pill wrapper; there is no new
component, state owner or generated code. This section adds 19 documentation lines.

Root `pnpm check`, Storybook TypeScript and all affected stories and image-preview
unit tests passed. The full test run passed 1,485 desktop tests and failed the two
known cases: the sidebar skills tooltip and the older attachment-preview story.
The full suite remains failed; those cases are outside this change.

## Shared components and workspace adoption

The approved design now lives in `src/renderer/ui/AttachmentPills.tsx` and its
stylesheet. `AttachmentPills`, `AttachmentDetailPill`, `AttachmentImagePill`, and
`AttachmentFilePill` have no Composer dependency. They take display data/content
and optional removal callbacks. Images accept either a local File or a source
URL, so persisted transcript images can use the same presentation later.

The real Composer renders review comments, annotation controls, and file/image
pills through these components. Review counts derive from the supplied comments;
annotation editing still uses its existing owner and anchored editor. Extra
controlled pills can be composed into the same attachment row. Their count enables
attachment-only submission, without interpreting their rendered content. Removal remains
separate from preview activation, and the composer bounds large attachment batches
to a scrollable 168px area. The former file rows and context-chip styles are removed.

The Warm Paper Workspace showcase includes all approved attachment types. Browser
notes there are controlled fixture data and serialize through the existing
text/image helpers when a simulated message is sent or queued. Production browser
capture serialization is unchanged. Transcript rendering is not migrated in this
change; the standalone read-only pills stories exercise the shared components
without composer controls. The composer proposal now also uses the real attachment
row, replacing its separate attachment renderer and outer visual frame.

The new full-comment assertion exposed browser annotation textareas remounting on
every immutable draft update. Keeping cards keyed by annotation ID preserves focus
and the complete typed comment. The workspace interaction covers typing, preview,
removal, and retaining the prompt. Shared pill stories cover nested image modal
close, Escape, keyboard focus, and switching popups.

Visual review covered 1440px, 820px, and 390px widths, light and dark surfaces,
and anchored review/browser popups. Screenshots are saved under
`/Users/alex/.codex/visualizations/2026/09/28/shared-attachments/`.

Accounting against HEAD: production **+530 / -207 / net +323**, including the
previous whole-image trigger change. Existing test files change by **+51 / -12**;
tracked Storybook fixtures/interactions by **+125 / -33**; tracked documentation by
**+13 / -2**. The earlier untracked design catalog and this proposal are counted
separately from those tracked deltas. New production code is the four shared UI
components and their styles; no new runtime service, state owner, or generated
code is added. The story-only pill implementation and duplicate styles are removed
in favor of the shared renderer.

Final verification: `pnpm check` and the Storybook TypeScript check passed. The
focused shared-pill, annotation, and workspace interaction run passed all 20
stories. The final root `pnpm test` run passed the 53 prompt-editor tests, 14
session-tools tests, and 1,487 desktop tests, including all 25 real browser
acceptance tests. One older unmodified inventory story failed:
`Attachments.stories.tsx > Interactions` could not find its “12 more files” button
after closing an image preview, matching the previously recorded transient
`aria-hidden` issue. An earlier complete run passed all 1,488 desktop tests; the
final run remains recorded as failed rather than treating that earlier pass as
proof of the final checkout. All changed component and workspace stories passed.

The final focused fixes also cover sending a controlled attachment with no prompt
text, hiding empty attachment groups, and preserving the same annotation opener
while its draft changes so editor dismissal restores focus correctly.

## Annotation popup navigation

The annotations pill now toggles its popup. The popup uses compact separated rows,
a neutral header, and a short source quote beneath each comment. Clicking a comment
closes the popup, scrolls to its validated highlighted text range, and focuses the
source block. Editing has a separate Edit action. Missing or changed source text
shows an unavailable status instead of navigating to an unrelated passage.

The existing annotation controller and highlight helper own these behaviors.
`toggleDrafts` replaces `openDrafts`; `jumpTo` reuses restored Range objects.
Direct Kobalte popup handling preserves the external pill's toggle behavior and
avoids resetting editor focus during typing. There is no new component, runtime
service, state owner, or generated code in this refinement.

Verification: root `pnpm check` and Storybook TypeScript passed. All five annotation
stories, all twelve workspace stories, and the real-server annotation/review
acceptance flow passed. Unit coverage checks exact range scrolling and removed
sources. Visual inspection confirmed the two-note layout and a source jump from
the bottom of the workspace transcript to its highlighted sentence. Screenshots:
`/Users/alex/.codex/visualizations/2026/09/28/annotation-navigation/`.

The full test run passed 53 prompt-editor, 14 session-tools, and 1,489 desktop
tests. One existing sidebar skills test failed because a session-title tooltip
intercepted a click. The full suite remains failed; this unrelated case is not
changed here. Logs are in `/tmp/annotation-final-{check,test,storybook-types}.log`.

Cumulative accounting against HEAD, including the earlier attachment work:
production **+847 / -349 / net +498**; tracked tests **+81 / -14**; tracked stories
**+183 / -61**; tracked documentation **+13 / -2**. This section adds 32 lines to
the existing untracked proposal. The earlier untracked story catalog is separate.
Production growth supports accessible popup controls, source context, exact range
navigation, and focus preservation; it introduces no duplicate state owner.

## Headerless review and annotation popups

Review and annotation popups now omit their visible title and close button.
Visually hidden titles retain accessible dialog names. The annotation edit action
uses the existing upstream pencil icon and IconButton, aligned with the remove
button at the comment's first line. Obsolete annotation header/close styles are
removed; no new abstraction, component, or state owner is introduced.

This refinement removes 34 net production lines. Cumulative counts against HEAD,
including the previous attachment work: production **+814 / -350 / net +464**,
tracked tests **+81 / -14**, tracked stories **+183 / -61**, and tracked docs
**+13 / -2**. The untracked proposal and earlier story catalog remain separate.

The 30 focused stories, root `pnpm check`, and Storybook TypeScript passed.
Visual inspection in the workspace confirmed both headerless popups and matching
icon alignment. Screenshots are under
`/Users/alex/.codex/visualizations/2026/09/28/attachment-popup-refinement/`.

The full test run passed 53 prompt-editor, 14 session-tools, and 1,486 desktop
tests. Four failed: two session-navigation clicks blocked by title tooltips,
the older attachment inventory story's hidden controls after image dismissal,
and the server-backed annotation/review test during its initial model-switch
setup, before annotation interaction. All changed stories passed in this run.
The full suite remains failed; server-backed annotation coverage was not reached
in this run. Logs: `/tmp/popup-refinement-{check,test,storybook-types}.log`.

## Matching annotation action glyphs

The upstream pencil and close paths occupy different fractions of their SVG view
boxes. Annotation-only CSS now sizes the pencil SVG to 14px and the close SVG to
24px, bringing their visible glyphs to approximately 11px while keeping both button
targets at 20px. Visual inspection confirmed matching sizes in the two-note popup.
The scoped change adds 13 production lines and removes none; it adds no tests,
abstractions, or generated code. Root `pnpm check` passed. Screenshot:
`/Users/alex/.codex/visualizations/2026/09/28/attachment-popup-refinement/matched-icons.png`.

The full suite passed 53 prompt-editor, 14 session-tools, and 1,489 desktop tests,
including the annotation stories and server-backed annotation/review flow. One
existing sidebar skills test failed when a title tooltip intercepted a session
click. Logs: `/tmp/annotation-icon-{check,test}.log`.

## Consistent review and annotation spacing

Both popup bodies now use 12px outer padding, 12px inset separators with 12px
spacing on each side, 13px body text at 1.5 line height, and 12px muted source
text with an 8px gap. Annotation rules explicitly override the upstream
LineComment styles; the previous weaker selectors left extra padding and
different typography active. Review code previews retain their content treatment.

Computed browser styles and screenshots confirmed matching spacing in the real
workspace showcase. Screenshots are under
`/Users/alex/.codex/visualizations/2026/09/28/consistent-popups/`.
Root `pnpm check` passed. The change adds 37 and removes 11 production CSS lines
(net +26), with no new abstractions, behavior, tests, or generated code. Growth
comes from overriding upstream typography explicitly; redundant wrapper padding
and source margins were removed.

The full suite passed 53 prompt-editor, 14 session-tools, and 1,489 desktop tests.
All affected popup/workspace stories and the server-backed annotation flow passed.
The unmodified TranscriptView “Wide Output Scrolling” story failed its offscreen
row-position assertion; no popup was involved. The full run remains failed.
Logs: `/tmp/consistent-popup-{check,test}.log`.

## Transcript-style code blocks in popups

Transcript and attachment popup code blocks now share `styles/code-blocks.css`.
They use the same monospace font, code sizing, muted border, raised background,
card radius, 6px padding, and horizontal scrolling. Transcript blocks retain a
26px right gutter for their existing copy button. Review excerpts remain literal
text and are keyboard focusable, as transcript code blocks already are.

Computed styles and visual inspection confirmed the match in the workspace.
Screenshot: `/Users/alex/.codex/visualizations/2026/09/28/popup-code-blocks/review.png`.
Production changes are **+24 / -22 / net +2** lines. One shared stylesheet replaces
the separate transcript and popup rules; there is no new component or API, and no
new test or generated code.

Root `pnpm check` passed. The full suite passed 53 prompt-editor, 14 session-tools,
and 1,488 desktop tests, including transcript code-block stories, shared attachment
stories, workspace stories, and the server-backed annotation/review flow. Two
previously observed failures remain: the sidebar skills tooltip blocks a session
click, and the older attachment inventory story cannot find controls immediately
after closing an image preview. Logs: `/tmp/popup-code-{check,test}.log`.

## Attachment popup cleanup

Review details now use one reusable renderer in Composer and the standalone
pills story. That story also renders the production annotation row, so its quote,
navigation, and unavailable-source presentation come from the same component.
One shared popup stylesheet owns the frame, body inset, separators, and complete
body/metadata type roles. Review bodies preserve line breaks, code previews use
the semantic code-surface token, and the dead icon selector is corrected.

The detail pill now requires either internal content or an external open action;
its unused static branch is gone. Image pills use the existing preview source
contract and one render path. This cleanup adds one review renderer and one shared
stylesheet, removes the duplicate popup CSS, and adds no state owner or workflow.
Incremental production changes against saved pre-edit files are **+254 / -281 /
net -27** lines; stories are **+20 / -16 / net +4**. Focused renderer TypeScript,
Oxlint, Stylelint, and 13 affected Storybook tests passed. The final root checks,
Storybook TypeScript, and all 1,557 tests passed: 53 prompt-editor, 14 session-tools,
and 1,490 desktop tests. The known skills-sidebar tooltip failure occurred in the
earlier run but did not recur in the final run. Narrow-story visual inspection
confirmed wrapped paths and preserved multiline comments; workspace inspection
confirmed matching padding and typography in light and dark themes. Final logs:
`/tmp/attachment-cleanup-final-{check,test}.log`. Screenshots:
`/Users/alex/.codex/visualizations/2026/09/28/attachment-cleanup/`.
