# Browser element annotations: design

Status: proposed, 2026-09-19. Phase 1 (capture and send) is implemented in the
`mighty-otter` worktree; the design below records the research, the refined
recommendation, the implemented scope, and the remaining phases. Live page
markers and style adjustment are deliberately not part of this iteration.
Revision 2026-09-20: the comment is entered in a minimal in-page popover beside
the selection (transcript-style) instead of the pane tray. An implementation
review then hardened the popover (interaction ids, open acknowledgment, IME and
length handling, detached-host recovery, frozen viewport placement) and restored
a small tray thumbnail. Verification of the hardened revision: `pnpm check`;
`pnpm test` (129 files, 1209 tests); the preload card and exchange unit tests;
the BrowserAnnotations Storybook story; and the packaged macOS acceptance flow
(7 passing: native pick, popover open, typed comment saved with Enter, composer
insertion, server round trip, transcript render). Revision 2026-09-21: draft
preservation on interruption was removed by the product owner, who does not want
recovery machinery. Revision 2026-09-22: the product owner rejected timeouts
that merely duplicate the host backstop, so the selection and comment deadlines
are gone; the popover keeps only the ten-second open check, which reports a
clear failure instead of adding an empty annotation. A cancellation review then
replaced per-send timeouts with one bounded native drain: a stopped renderer
closes the tab instead of holding the annotate call, command admission, or
shutdown.

## Goal

Let a user annotate elements and regions on the page in the Electron Browser
panel, the way the Codex in-app browser does:

1. Turn on annotation mode from the browser chrome.
2. Hover shows which element would be selected; click selects an element, or
   drag selects an area.
3. Comment on that element; optionally adjust style values with a live preview
   (a later phase, see Phases).
4. Accumulate several numbered annotations.
5. Send them to the agent with the page context and a screenshot that shows the
   annotation, so the agent knows exactly which element each comment targets.

The agent already drives the same page through the pinned server's browser
tools. This feature is the human-to-agent feedback path for that shared page.

## Non-goals

- A visual editor. The feature produces instructions; it does not edit
  application source or persist page changes.
- Replacing transcript annotations or code-review comments.
- Authenticated browsing. The user triggers every capture; the page may
  contain personal data.
- Freehand drawing or image markup.

## What Codex does

OpenAI's Browser documentation describes the flow:

> 1. Turn on **Annotation mode**.
> 2. Click an element, or drag to select an area.
> 3. Write and save your comment.
> 4. Send a message in the chat asking ChatGPT to address the comments.

> When you add an annotation to a section on the page, select **Adjust** next to
> the text input to give ChatGPT more granular style feedback. You can change
> values such as font, text, spacing, and color, preview the result on the page,
> and then send the annotation with a clearer target.

Reviews and demos add the details that matter here:

- Comments accumulate in a queue; several can be left in a row before the user
  sends one message that addresses them.
- Annotated screenshots appear in the thread, so the screenshot the model sees
  includes the annotation markers.
- The selected element's DOM context accompanies the screenshot.
- "Advanced annotation mode" adjusts elements (font size, color, spacing) with
  instant preview, then batches the comments.
- The built-in browser is for unauthenticated pages; signed-in tabs use the
  separate Chrome extension.

Sources: OpenAI Browser docs (`learn.chatgpt.com/docs/browser`), the "Codex for
every role, tool, and workflow" announcement, OpenAIDevs' advanced annotation
post, the r/codex "Most slept on feature" thread, and build 26.519 walkthroughs.

## Prior art in this repository

An unreferenced branch `feat/native-browser-annotations` (worktree of the same
name, last touched 2026-09-12 on an older base) contains a working prototype:

- `main/browser/upstream/annotation.ts` drives Chromium's element picker over
  the pinned CDP connection: `Overlay.setInspectMode` with `searchForNode` for
  elements and `captureAreaScreenshot` for areas, `Overlay.inspectNodeRequested`
  and `Overlay.screenshotRequested` for results, and a bounded
  `Runtime.callFunctionOn` function that derives selector, tag, text, role,
  label, and bounds from the picked node. Escape cancels.
- `BrowserHost.annotate` starts a pick only when the command semaphore is free,
  cancels and awaits active picks before any browser command, and applies a
  fifteen-minute backstop.
- A new IPC request and `annotation` event carry the capture, including
  screenshot bytes, to `createSessionBrowser`, which stores one pending capture
  per session and offers "Annotate", "Select area", a comment box, "Add to
  conversation" (formatted text plus one PNG appended to the composer), and
  "Discard". The capture survives panel remounts and navigation.
- Tests cover picker cleanup and cancellation, IPC byte decoding, controller
  ownership, and a packaged e2e flow that drives real input into the
  `WebContentsView` with `sendInputEvent`.

The prototype establishes that CDP Overlay picking works here and that the
renderer and composer can carry a capture to the server. It was reviewed
against the Codex behavior and has four weaknesses:

1. **No annotation is visible in the artifact.** The screenshot is the plain
   viewport; the model gets bounds but no marked image.
2. **One pending capture per session.** A new capture replaces the previous
   one; batching is impossible.
3. **Page-derived fields are unbounded trust.** They are formatted into the
   prompt as text without a clear untrusted-data boundary.
4. **Over-broad cancellation.** Any browser command cancels picks in every tab.

## Platform constraints

Facts about the current implementation, not choices:

1. Each tab is a native `WebContentsView` layered above the renderer
   (`main/browser/upstream/page.ts:42`, `native.ts` layout). Renderer DOM cannot
   overlap the page.
2. The renderer may only send navigation and tab actions over IPC. A renderer
   command is filtered against an allowlist (`shared/browser-api.ts`,
   `BrowserCommand`), and the server owns screenshots and file export. New
   annotation capabilities are desktop-owned and must not widen the
   agent-facing command surface.
3. The page debugger is already attached for most operations
   (`upstream/cdp.ts`) and iframe sessions are tracked from
   `Target.attachedToTarget`.
4. Page content is untrusted. Page strings that reach the model must be
   bounded and marked as page data.
5. Images travel to the server as ordinary prompt attachments; desktop paths
   must never cross the boundary (`docs/file-attachments-design.md`).
6. Screenshot capture requires a visible tab, is capped at 16 MP, and files are
   capped at 5 MiB (`Browser.MAX_FILE_BYTES`).
7. The composer accepts files as inlined data URIs, and `createSessionPrompt`
   already merges instruction, review comments, and transcript annotations into
   text plus message metadata (`renderer/opencode/session-prompt.ts`).

## Design principles

The review of the prototype settled four principles that drive the rest of this
document.

1. **An annotation is a historical capture, not live page state.** A rectangle
   recorded in document coordinates does not stay attached to the element that
   was selected: banners load, lists virtualize, nested scrollers move content,
   and reloads replace the document. Markers must therefore be burned into the
   captured image in trusted code rather than injected into the page as DOM
   that claims a durable element association.
2. **The screenshot is the evidence.** One image per annotation, captured at
   selection time, with the marker rendered onto the pixels. The model should
   never have to guess where comment N points.
3. **One owner per piece of state.** The renderer owns annotation records,
   numbering, comments, and images. Main owns the active pick, CDP handles,
   capture execution, and image compositing. There is no second annotation
   model in the page.
4. **Delivery is transactional.** Text and images are prepared and validated
   together, inserted together, and the draft is cleared only after insertion
   succeeds.

## Options considered

### Picking

**A. CDP Overlay inspection (recommended).** Chromium draws the hover
highlight; clicking resolves a `backendNodeId`; area mode uses
`captureAreaScreenshot` and reports the dragged viewport rectangle. No page
script injection, cross-origin frame support from the browser, native
hit-testing, proven in this repo. The highlight is transient and absent from
screenshots, which is exactly why markers are composited afterward. On the
pinned Chromium, `Overlay.setInspectMode` validates `highlightConfig` on every
call, including when disabling inspect mode, so the picker passes the same
descriptor for `mode: "none"`.

**B. In-page picker in an isolated world.** Inject a hit-test layer that draws
its own hover and handles clicks. Full visual control, but it duplicates
browser hit-testing, runs only in the main frame without extra machinery,
creates a page tampering surface, and races the agent's synthetic input. Not
worth it.

### Live markers on the page

**A. No live markers (recommended first version).** The page shows the native
hover highlight while picking and nothing afterward. Numbered cards in the pane
carry the element identity and the composited thumbnail. No geometry drift, no
page DOM, no interaction with agent input. (The comment popover later added a
dedicated preload; this option still adds no live page markers.)

**B. Isolated-world presentation layer (deferred).** A preload or CDP-injected
layer draws numbered pins in page coordinates. This is what Codex shows, but it
only stays correct if elements are tracked and detached markers are detected;
document-coordinate pins silently point at the wrong element after any layout
change. It also intercepts pointer input, appears in accessibility snapshots,
and leaks into agent screenshots. If this is required later, it must be
noninteractive (selection happens in the pane), explicitly hidden or
suppressed during agent operations, and paired with a stale-marker policy.
Neither a preload nor CDP injection is a security boundary against a page that
manipulates its own DOM.

### Comment editor

**In-page popover (implemented, 2026-09-20; hardened after review).** A minimal
card with a textarea and Add/Cancel appears beside the selected element,
matching the transcript annotation interaction. It is delivered by a dedicated
browser preload in Electron's isolated world, draws into a closed shadow root
styled with a constructed stylesheet, and occupies only its own rectangle.
Main sends bounded `open`/`close` messages and accepts bounded
`opened`/`save`/`cancel` replies, dropping replies that do not fit the
current phase or that come from anywhere but the tab's main frame. The card disables Add while empty, caps the
comment at 4096 characters, and leaves Enter/Escape alone while an IME
composition is active. The screenshot is taken before the popover opens, so it
never appears in the image.

The card is placed once beside the selection in viewport coordinates and stays
there while the page scrolls; it describes a frozen capture rather than a
tracked live element. An editor that does not acknowledge within ten seconds
fails the annotation with "The comment box did not open. Select the element
again." instead of adding an empty annotation. A card that opened waits for the
user; the host's fifteen-minute backstop, an interruption (agent command,
navigation, hiding the tab, disposal), or Cancel ends it. Typed text is not
recovered; the product owner accepted losing an interrupted comment in exchange
for dropping the recovery protocol.

Trade-off accepted by the product owner: the popover is page DOM, so the page
can observe the node and the key events that pass through it, and comments are
not secret input. Child-frame selections keep the pane editor, because a
frame-local rectangle cannot position a top-document popover.

**Pane editor (fallback).** The editor above the viewport remains for child
frames, for editor fallback, and for editing an existing draft after capture.
It is no longer the primary input path.

**Frozen-screenshot popover.** A modal in the trusted app showing the captured
image while the native view is hidden. Not taken; the in-page popover keeps the
page visible around the comment.

### Cancellation and page retirement

Chromium cannot cancel a `sendCommand`. The picker therefore runs under an
operation handle (`upstream/operation.ts`) with a single ten-second drain
budget. Cancellation (Cancel, Escape, navigation, hiding the tab, command
preemption, owner disposal, or the fifteen-minute host backstop) aborts the
operation and starts the budget; a successful pick starts it before the final
Overlay cleanup. If the outstanding CDP work settles inside the budget, the
page stays live and its Overlay cleanup is confirmed. If the budget expires,
the page is retired: the CDP adapter (`upstream/cdp.ts`) is fenced so every
pending and future command rejects, the WebContents closes, and the native
owner removes the tab with "The browser tab stopped responding during
cancellation and was closed. Open the page again." A failed Overlay reset
retires the page with "The browser tab could not be reset safely and was closed.
Open the page again."

A page is reusable only after its Overlay cleanup is confirmed; a late raw CDP
response cannot reach a newer pick because the adapter rejected its
application-facing promise at closure and the page cannot host another pick.
Page disposal fences and closes the target before awaiting annotation,
profiling, or command cleanup, so a stopped renderer cannot hold the WebContents
open. The host keeps awaiting native settlement; when its backstop fires during
a drain, the native terminal failure wins over the generic timeout message. A
command counts as executing until it settles, not until the next command is
admitted.

### Review outcomes

The design review before implementation and the implementation review after it
changed the following, and the remaining points are deliberate:

- Bound the open handshake (ten seconds) so a missing editor fails quickly
  instead of holding a pick, and keep cleanup in `finally` with safe decoding
  of replies. (The review also asked to preserve typed work on interruption;
  that was implemented and later removed by the product owner, who does not
  want draft recovery. Interruptions now cancel.)
- Validate both directions and accept replies only from the tab's main frame.
- Interaction ids were removed after review. One editor exists per tab, the
  card sends a single terminal message, control messages share one ordered
  pipe, and a duplicate open is ignored. The only residual is a terminal reply
  delayed past the end of its interaction (a hung renderer) landing on the next
  one; the ids did not justify their cost for that case.
- Handle IME composition and the 4096-character bound in the card itself.
- Recreate a detached host instead of reusing an invisible tree.
- Prefer viewport-frozen placement over page-coordinate tracking, which visibly
  drifts for sticky or fixed elements.
- Keep a small screenshot thumbnail in the tray so a later page change does not
  erase what an annotation referred to.
- Accepted residual risk: trustworthy input on hostile pages would require an
  app-owned surface (a second native view). The floating requirement alone did
  not establish that; the page-observable input is the documented trade-off.

A second review pass hardened the exchange further, and these are implemented:

- A dedicated exchange (`annotation-comment.ts`) owns the interaction: open
  acknowledgment and a ten-second open deadline that reports a clear failure.
  The product owner then removed the selection and comment deadlines as
  redundant with the host backstop.
- Transport failures at open fail the annotation with a message, and a failed
  close is ignored. A later cancellation review replaced the best-effort
  cleanup race with the bounded drain and terminal page retirement above, so a
  stopped target can no longer hold a command or a shutdown.
- The host's annotate backstop now covers picking plus commenting (15 minutes),
  so its timeout cannot race a completed capture out of delivery.
- Card placement clamps to the viewport in both directions, including after a
  resize shrinks it, and tall cards scroll inside their own bounds.

Follow-ups from the same pass, also implemented: main accepts popover replies
only from the tab's main frame, and the annotator protocol moved to its own
import-free module so the preload no longer pulls in the browser tool RPC
package or the Effect runtime (the preload dropped from roughly 465 KB to under
8 KB per page). Interaction ids were then removed as unnecessary, along with
three smaller pieces of state: the draft's unused request id, the duplicated
element bounds and frame URL on the picker's element info, and the tray's focus
bookkeeping (the newest empty draft simply autofocuses).

Remaining accepted gap: typed text lives only in the open card, so an
interruption discards it along with the capture; only the screenshot survives a
navigation. The popover has not had a visual review yet.

### Delivery

**Composer append (recommended).** Format the comments as text, attach the
annotated images, append to the session composer, and focus it. The user
reviews and sends. Reuses the existing attachment transport, keeps the user in
control, and matches transcript annotations.

**Message metadata envelope.** Structured rendering after send, but it is a new
schema version and transcript surface without an existing end-to-end contract;
deferred until sent annotations need to render as cards.

**Auto-send.** Bypasses review and creates messages the user did not type.
Rejected.

## Recommended design

```text
Renderer (Solid)                          Main (Electron)                 Page (WebContentsView)
────────────────────────────────────────────────────────────────────────────────────────────────
Browser pane
  Annotate / Select area ───────────────► BrowserHost annotationStart
                                             │ cancel picks on this tab,
  annotation event   ◄──────────────────── │ check command permit free
  composited image                          ▼
  (bytes + context)                       BrowserPage.annotation
  add numbered card                          │ CDP Overlay.setInspectMode
  comment in popover or pane                 │ user clicks / drags
  markers stay in image                      │ resolve node context
  Add to composer ──────────────────────►   │ screenshot viewport
  (text + files)                             │ composite marker onto bitmap
                                             │ return bytes + selection
```

### User flow

1. The Browser pane toolbar gains an **Annotate** action and a **Select area**
   action, enabled only for a connected session with a focused, visible tab.
2. Starting a pick disables the actions, shows "Click an element, drag to
   select an area, or press Escape", and focuses the page.
3. During a pick, page navigation from the agent or the user cancels it.
   Escape, the Cancel control, hiding the panel, navigating, or an agent
   command targeting this tab cancels and awaits cleanup. Commands for other
   tabs do not cancel the pick, and a command or layout change that hides this
   tab (for example, opening a focused tab elsewhere) does.
4. On selection, main reads the element context and its current viewport rect,
   captures the viewport screenshot, composites the numbered marker onto the
   image, hides the pick highlight, and emits the capture.
5. The comment popover opens beside the selection; the pane shows a numbered
   card with the composited thumbnail and the selector line. A child-frame
   selection, which the popover cannot anchor to, edits its comment in the pane
   card instead.
6. **Add to composer** formats the batch, attaches the annotated images, and
   inserts everything into the composer in one update. **Discard** removes one
   card. The tray clears only after a successful insert.
7. Sending the message is the user's action. Starting another pick after send
   begins a new batch with the next number.

### Capture pipeline

1. Renderer sends `annotationStart` with `requestID`, the next stable number,
   and the mode.
2. Main checks the tab is focused, visible, connected, and that no command is
   executing against this tab. Admission and the tab's command start
   synchronize atomically (register the pick under the same critical section
   that a command uses to mark itself executing), so a pick and a command can
   never overlap on one tab. The command permit is **not** held for the pick's
   lifetime: commands for other tabs proceed normally, and a command that
   needs this tab cancels and awaits the pick before it executes.
3. CDP inspect mode is enabled; main waits for a selection or cancel.
4. On selection, main resolves the node (or area bounds), re-reads the current
   viewport rect, and verifies the tab's URL and generation did not change.
   A changed document fails the capture with "Page changed. Select again."
5. Main captures the viewport with `Page.captureScreenshot` at the display's
   device resolution — no width cap; the 16 MP budget scales the capture down
   only on very large displays instead of refusing it. It then composites:
   - element mode: a rectangular outline around the current rect and a filled
     numbered badge near its top-left corner. A partially visible element gets
     a clipped outline and a visible indication; an element that no longer
     intersects the viewport **fails** the capture ("Selected element is no
     longer visible. Select again or capture an area."), because an image that
     omits the subject is poor evidence even with a warning;
   - area mode: a dashed outline around the scanned region and a badge;
   - badge and outline are clamped to the image.
6. After the screenshot, main re-reads the document identity and the element
   rect. If the document changed or the geometry moved materially, the capture
   is rejected with "Page changed. Select again." This closes the largest
   avoidable gap between what was measured and what was photographed; it is
   still best-effort, not an atomic DOM-and-pixels snapshot.
7. The composite uses `nativeImage.toBitmap()`/`createFromBitmap()` on the
   captured PNG. Digits come from a small embedded bitmap font; no dependency
   or canvas surface is added. The painter itself is a pure byte-buffer
   function so it is unit-testable; channel order, alpha behavior, and
   encoding are verified against the pinned Electron in a spike. PNG is kept
   unless the encoded bytes exceed the 1.2 MB per-image cap, in which case the
   image is re-encoded as JPEG quality 90.
8. Main opens the comment popover beside the selection and waits for a reply.
   The popover opens only after the screenshot, so it stays out of the image.
   An explicit Cancel discards the capture. An interruption (navigation,
   hiding, command preemption, disposal, or the host backstop) closes the card
   and discards the capture. A card that does not acknowledge within ten
   seconds fails the annotation with a message.
   Child-frame selections skip this step and leave `body` empty for the pane
   editor.
9. Main emits `{requestID, number, mode, tab, selection, body, image}`. The
   renderer ignores captures whose `requestID` is not its active pick.

The design reports the capture as evidence "at this time", never as a live
binding.

### Selection metadata

Reuse the prototype's bounded `Runtime.callFunctionOn` probe:

- `frameUrl`, `selector`, `tag`, `text`, `role`, `aria-label`, and viewport
  `bounds`, each length-capped.
- `frameID`/frame identity and whether the selection is in the main frame.
  When it is not, and frame-to-top geometry has not been verified, the image
  gets no outline and the card and prompt say "captured in frame X; outline
  unavailable". Degrading silently is not acceptable.
- The document generation at capture time.

### Renderer state

The session browser controller owns, per session:

```ts
type BrowserAnnotation = {
  id: string; // renderer identity
  number: number; // stable; burned into the image; never renumbered
  mode: "element" | "area";
  tab: Browser.Tab; // snapshot: id, url, title, generation
  selection: BrowserSelection;
  image: { name: string; mime: string; data: Uint8Array };
  body: string;
};
```

plus `{ status: "idle" | "picking"; error?: string }`. Drafts survive panel
remounts, conversation switches, and navigation. The capture request's
`requestID` only correlates the in-flight pick with its event; it is not stored
on the draft, and the number is only a label. An
admitted pick is bound to its owning session, tab, and document generation, so
a result that arrives after a switch or navigation is discarded. Navigation
marks every card whose generation no longer matches as "captured before the
latest navigation"; nothing is reattached by selector. The tray is bounded by
annotation count and total image bytes; further captures are refused with an
actionable message until the user clears or sends.

### Delivery

`Add to composer` builds the whole message in one operation:

- Text: one section per annotation with the comment as plain text, then the
  page-derived fields in a fenced "untrusted page data" block (URL, title,
  frame URL, selector, tag, role, aria-label, text excerpt, bounds, generation,
  capture time). Comments and page data are never interleaved. The fence is
  chosen dynamically or its content escaped so page-provided backticks or
  fence-like lines cannot terminate it; the label remains the model-facing
  signal, not the fence.
- Files: the annotated images, in annotation order, bounded by count and total
  encoded size.
- The text tells the model that selectors are hints and that it should take a
  fresh browser snapshot before acting.

The insertion appends text once and adds all files in one state update. The
tray is cleared only after the insertion resolves; on failure the tray is kept
and the error is shown. The insertion targets the session that owned the
annotations, not whatever session is selected at click time.

### Lifecycle and cancellation

- Picks are per-tab and short. A command targeting the tab cancels and awaits
  its pick before executing. Commands for other tabs are not canceled by the
  pick and do not wait for it; a command or layout change that hides the tab
  cancels its pick, as hiding always has.
- Admission binds a pick to `{requestID, session, tab, document generation}`.
  Each pick owns its Overlay listeners and settles once; a late Overlay event
  cannot settle a newer pick because its listeners are removed when the pick
  settles. A CDP mutation already sent cannot be cancelled, so the cancellation
  rules above retire the page instead of relying on tokens.
- Each pick settles exactly once, with an explicit commit point:
  cancellation accepted before the capture is committed produces a canceled
  result and discards any image that later completes; once success is
  committed, the success stands and cleanup finishes before the triggering
  command proceeds.
- Cleanup is idempotent and never queues behind the command that triggered it.
  A debugger failure fails the whole tab through the existing detach path, so a
  dead target cannot receive a later command. A failure to hide the highlight
  on a live target is swallowed and left to the next pick or capture, which
  re-arms and hides the overlay; the stronger recovery policy from the review
  (refuse the next command until inspect mode is confirmed off) is a follow-up.
- Cancellation between pointer-down and pointer-up must not let the input
  activate the page.
- Focus returns to the main window renderer only when the window is still
  focused. A timeout or cancel does not steal focus from another application.
- Disposal (tab close, detach, quit) cancels and awaits cleanup before the
  page is destroyed.

### Security and untrusted data

- Page strings are bounded by schemas and presented inside an explicit
  untrusted-data fence; neither JSON encoding nor fences make page text
  trustworthy, so the prompt labels it.
- The marker is drawn by main from geometry and a number the renderer chose.
  No page-provided pixel data, CSS, HTML, or script participates in
  compositing.
- The renderer command allowlist is unchanged. Annotation requests are
  separate, schema-validated messages that the agent and server never see.
- Screenshot bytes stay within the existing 16 MP and 5 MiB caps; the tray
  budget bounds the aggregate.
- Picks are user-initiated only. A page cannot start a pick or request a
  screenshot.
- The comment popover is a dedicated preload in Electron's isolated world. It
  exposes no Node or app API to the page, draws only its own closed shadow root
  with a constructed stylesheet, and both directions of its channel are
  bounded and decoded through the shared schema in main. The page can still
  observe the popover node and the key events that pass through it, so the
  comment is treated as user-visible data, never a secret; the screenshot is
  captured before the popover opens, so the popover never appears in evidence.

### Failure modes

| Failure                                    | Behavior                                                                                                                                                       |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No focused or visible tab                  | Action disabled; a direct request fails with "Open the browser tab before annotating."                                                                         |
| Page navigates during a pick               | Pick cancels; pane reports "Page changed. Select again."                                                                                                       |
| Agent command for this tab                 | Command cancels and awaits the pick, then runs; the annotation is dropped, not queued.                                                                         |
| Element disappears before capture          | Capture fails with "Selected element is no longer available."                                                                                                  |
| Element scrolled out of view               | Element capture fails with "Selected element is no longer visible"; the user can recapture or select an area.                                                  |
| Element partly visible                     | Outline is clipped to the visible part and marked as clipped.                                                                                                  |
| Document or geometry moved during capture  | Post-capture verification rejects with "Page changed. Select again."                                                                                           |
| Screenshot fails (hidden window, size cap) | Capture fails; nothing is added; the existing screenshot guidance is shown.                                                                                    |
| Frame selection without verified geometry  | Capture succeeds with no outline and an explicit frame note; the pane editor collects the comment.                                                             |
| Comment popover dismissed                  | Explicit Cancel discards the capture; nothing is added to the tray.                                                                                            |
| Comment editor does not open (10 seconds)  | The annotation fails with "The comment box did not open. Select the element again."                                                                            |
| Comment popover removed by the page        | Main has no way to notice; the interaction ends at the host backstop or when the user cancels.                                                                 |
| Agent command or tab switch while typing   | Picker aborts, the card closes, and the capture is discarded.                                                                                                  |
| Renderer stops answering during a pick     | Cancellation drains for ten seconds, then the tab is closed with "The browser tab stopped responding during cancellation and was closed. Open the page again." |
| Overlay reset fails                        | The tab is closed with "The browser tab could not be reset safely and was closed. Open the page again."                                                        |
| Tray draft after navigation                | Card remains as historical evidence with a "captured before the latest navigation" note.                                                                       |
| Tray limits reached                        | Further captures are refused until the user clears or sends.                                                                                                   |
| Workspace closes                           | Picks cancel, overlays clean up, drafts are dropped.                                                                                                           |

## Phases

1. **Capture and send.** Picker, composited numbered images, comment popover,
   stable numbering, transactional composer insert. This is a complete
   user-visible feature. **Implemented:**
   `upstream/annotation.ts`, `upstream/annotation-image.ts`, the annotation
   contract in `shared/browser-api.ts`, `preload/browser-annotator.ts`,
   `BrowserAnnotations.tsx` and `browser-annotations.ts` in the renderer, and
   `appendBatch` on the composer. Deviations from the earlier text, all
   intentional: the marker outline is clipped to the frame and the badge is
   clamped to the bitmap without an extra clipped indicator; the renderer
   chooses the number before the request, as the capture-pipeline section
   describes; `createWorkspaceModel` keeps its original construction order and
   invokes `composer.appendBatch` through a late-bound callback, because moving
   the browser controller after the composer changed a Solid
   effect-order-sensitive transcript flow in the web e2e. Revision
   (2026-09-20): the pane tray lost its thumbnails and capture line to stay
   minimal, and the comment is now entered in the in-page popover rather than
   the pane.
2. **Card-to-page highlight (optional).** Selecting a card asks main to run a
   transient `Overlay.highlightNode` for that capture's node if the document
   and node still exist; nothing persists and nothing is injected.
3. **Live markers (only if required).** Isolated-world presentation layer with
   element tracking, detach detection, a stale-marker policy, noninteractive
   behavior, and suppression during agent operations. This is a separate
   design with its own review. The user deferred this decision until phase 1
   has been used.
4. **Adjust.** Live style preview needs a mutation and recovery design
   (page scripts can observe inline-style changes, and rollback can overwrite
   concurrent page or agent changes). Separate from this document.

## Spikes before implementation

1. **Geometry.** Map selection bounds to image pixels across zoom levels,
   device pixel ratio, scroll offsets, nested scrollers, sticky and transformed
   elements, and cross-origin frames. Confirm `nativeImage` bitmap
   orientation and pixel format.
2. **Capture ordering.** Confirm highlight cleanup before capture, behavior
   when the page moves between rect read and capture, and navigation during
   capture.
3. **Concurrency.** Command arrival during a pick, cancellation between
   pointer-down and pointer-up, target teardown during cleanup, stale Overlay
   events, settle-once behavior, and focus handling.
4. **Delivery.** Several real images through composer, server, and provider;
   measure encoded and decoded sizes; find the real prompt size limit and set
   the tray budget from it.
5. **Compositor quality.** Badge legibility at typical scale factors, the
   PNG-to-JPEG fallback threshold, and worst-case decoded memory and
   main-thread stall time for a 16 MP image. Bitmap decode plus copies can
   multiply a 64 MB bitmap several times over, so dimensions are checked
   before allocation, work is synchronous and bounded, and the final encoded
   size is checked after compositing. If measured stalls or memory are
   unacceptable, move the pixel work off the main process.
6. **Pick handoff.** Cancel pick A, start pick B, and then deliver a delayed
   selection or cancellation event from A; B must not settle on A's event.

## Testing and verification

- **Main unit tests** (extend the prototype's `annotation.test.ts`): picker
  lifecycle; Escape, navigation, command, timeout, and disposal cancellation;
  overlay and object-handle cleanup; stale-event and pick-handoff rejection;
  commit-point behavior (cancel before commit vs success after commit);
  compositor painter as a pure byte-buffer function (outline and badge at
  expected coordinates, clipped and out-of-view cases, bounds clamping); the
  thumbnail/attach mapping is verified against the pinned Electron in a spike.
- **Shared contract tests**: decode image bytes and reject paths, reject
  non-finite bounds, enforce number and array bounds.
- **Renderer tests**: annotation store across sessions and navigation; stable
  numbering with gaps; comment editing; discard and clear; tray limits;
  transactional composer insertion including failure and session switching;
  prompt formatting that separates comment text from page data.
- **Packaged e2e** (extends `test/e2e/browser-flows.ts`): **implemented** as
  annotating the acceptance heading through real native input, opening the
  in-page popover, typing the comment and saving it with Enter, adding to the
  composer, sending, and asserting that the scripted provider received the
  selector plus the comment and that the annotated image renders in the
  transcript. The spec types through `webContents.insertText` after refocusing
  the popover, which is the only reliable input path into a closed shadow root.
  Marker pixels are covered by the deterministic painter unit tests, and
  cancel/navigation-cancel/area paths by picker unit tests.
- **Storybook**: tray states (no tab, picking, one and many annotations, long
  comments, navigation warning, tray limits, errors).
- **Manual/visual**: marker placement across scroll and resize, and a
  CSP-strict page (no injection is involved, so this should pass by
  construction).

Run `pnpm check` and `pnpm test` from the repository root, and the packaged
acceptance flow for the native boundary per `docs/app-verification.md`.

### Packaged verification findings

The packaged run caught two defects that unit tests and type checking cannot,
because both are runtime/bundler behavior:

- This Chromium rejects `Overlay.setInspectMode` without a `highlightConfig`
  even when disabling inspect mode. The picker now passes the same descriptor
  for `mode: "none"`.
- Chromium's screenshot clip `scale` multiplies the device-pixel output, so
  the base capture at `scale: 1` is already CSS pixels times the display scale
  factor. The marker mapping must use `CSS × devicePixelRatio × clipScale`, or
  markers land at the wrong place on Retina displays.
- The popover's card-level key filter must run in the bubble phase. A
  capture-phase `stopPropagation` swallows `keydown` before the textarea's own
  handler, so Enter and Escape never reach the editor (the acceptance spike
  caught this).
- `createBrowserPage`'s helpers live after its `return` as hoisted function
  declarations. A `let`/`const` added there never initializes (the bundler
  strips it as unreachable), so runtime state and schemas must be declared
  before the return or at module scope. A comment in `page.ts` marks the
  boundary.

## Open questions

1. Are persistent numbered markers on the live page a required acceptance
   criterion? The recommended design deliberately excludes them because they
   cannot be kept correct without element tracking. If they are required,
   phase 3 becomes part of the first version and needs its own review.
2. Should sending happen through the composer (review first) or should the
   panel auto-submit a batch the way Codex queues comments? Recommendation:
   composer first.
3. Are animated or video pages acceptable to capture as a still? Codex offers
   an animation pause; that is out of scope here.
4. Do sent annotations need to render as structured cards in the transcript,
   or is plain text plus the screenshot enough?
5. Should the tray survive a full app restart? Recommendation: no; it lives
   in workspace memory like transcript annotation drafts.
