# Ghostty-backed terminal implementation

## Goal and architecture

Embed Restty 0.3.0 (libghostty-vt WASM with WebGPU/WebGL2 rendering) in a
resizable bottom panel. The connected OpenCode 2.0.3 server owns every PTY and
shell. Browser and Electron clients use the same authenticated HTTP operations
and ticket-based WebSocket connection, including HTTPS/WSS remote servers.

The server owns its filesystem. Every operation retains the terminal's original
directory and workspace identity; creating a terminal uses the selected
session's server-side location. Keep new-terminal and hide controls on the tabs
row, with no separate location header. Keep normal `connected` and unattached
`idle` states quiet; show status during transitions and when recovery or a new
shell is needed. Error messages remain visible regardless of connection state.
Exceptional tab statuses are linked as accessible descriptions, including on
background tabs; these descriptions disappear when the terminal recovers.

## Ownership and lifetime

- A workspace-scoped terminal service owns records, active terminal selection,
  PTY mutations, socket attachments, retry fibers, and cleanup. Use the existing
  renderer Effect runtime, scopes, and atoms.
- Restty owns terminal parsing, input encoding, selection, scrollback, and
  rendering. Its custom transport adapts the OpenCode protocol; the default
  Restty JSON WebSocket protocol is not compatible.
- Bundle licensed JetBrains Mono TTF and Noto Emoji, Symbols, and
  CJK fallbacks. These add 20.55 MiB of font assets for offline emoji, combining
  marks, and CJK coverage. Noto Emoji uses outlines and monochrome rendering;
  the pinned rasterizer does not render downloaded Noto Color Emoji bitmaps.
  Provenance and hashes live beside the fonts; licenses ship in both builds.
  Use the TTF primary font with hinting disabled: the pinned WOFF2 decoder
  corrupts ASCII outlines, and its hinting distorts small glyphs.
- A workspace-owned Effect cache loads font bytes through XHR, which supports
  both packaged `file://` assets and browser HTTP assets. Share byte identities
  so Restty can reuse parsed fonts. Surface disposal leaves this shared read
  owned; workspace shutdown aborts it and awaits cleanup. Failed reads are
  retryable and font failures are shown before attaching a renderer.
- Solid owns panel visibility, DOM focus, and separator resizing. Keep terminal
  surfaces mounted across hiding the panel, switching tabs, and switching chat
  sessions. Pause drawing for hidden surfaces while continuing terminal output.
- Explicitly closing a terminal removes its remote PTY. Hiding the panel only
  hides it. Workspace disposal closes and awaits its attachments; it does not
  terminate unrelated or detached remote processes.

## Cancellation and failure policy

- Forward AbortSignal to SDK operations where supported. Adapt the upstream
  socket helper's ticket method to carry the owner signal; retain acquisition
  until it settles, and close any socket produced after interruption when an
  external API ignores cancellation.
- Serialize conflicting terminal mutations and coalesce obsolete resizes. Never
  retry input or PTY creation blindly; a missing response does not establish
  whether a shell was created. Reconcile uncertain creation before another
  attempt. Keep a failed close visible and retryable.
- Reconnect the same PTY with a fresh ticket and its received-output cursor.
  Disable input while disconnected; do not replay keystrokes after recovery.
  Bound automatic reconnect and expose manual recovery after exhaustion.
- Ordinary PTY output includes text and a binary NUL-prefixed JSON cursor frame.
  Cursor accounting uses JavaScript string length, not UTF-8 byte length. The
  metadata frame follows replay and establishes the absolute cursor.
- Ordinary server replay retains a bounded output tail, not a full screen
  snapshot or resize journal. Long disconnects and reloads cannot promise exact
  restoration. Preserve live emulator state for short reconnects.
- Discover existing location-scoped shells when opening the panel or changing
  location. Keep successfully closed IDs out of stale discovery responses.
  Rejected creation can be retried; uncertain creation only reconciles. Treat
  an already-missing PTY as successful explicit closure.
- Await owned cleanup and settle pending calls before disposing their owner.
  Expected network failures are visible in the terminal panel; defects remain
  observable in logs.

## Implementation sequence

1. Add the pinned Restty dependency and verify delivery of WASM and font assets
   under both the web base path and Electron's renderer protocol.
2. Implement the workspace-owned OpenCode PTY transport with focused ordering,
   interruption, partial-failure, replay, and shutdown tests.
3. Add the controlled bottom panel, terminal tabs, create/close/reconnect actions,
   a compact tab/action row, and accessible pointer/keyboard resize controls.
4. Integrate retained Restty surfaces and active-location selection. Use bundled
   fonts, existing theme tokens, clipboard interaction, and terminal focus.
5. Verify through existing browser acceptance against the real pinned server and
   HTTPS/WSS proxy: Unicode close/reopen, remote filesystem effects, full-screen
   sequences, output floods, hiding/switching/reopening, and reconnect.
6. Run root `pnpm check` and `pnpm test`; build and verify packaged Electron
   terminal startup, resources, interaction, and local server shutdown.

## Persistent terminals

The first implementation uses ordinary location-scoped `api.pty` sessions.
The experimental `persistentPty` backend has a separate daemon, checkpoint
protocol, attachment roles, and platform constraints. Restty replay does not
establish checkpoint compatibility. Adopt it only after testing snapshot format,
terminal-generated replies, resize ordering, controller takeover, session
association, and daemon shutdown/handoff against the pinned binary. Agent access
and survival across server replacement require that additional evaluation.

## Review fixes

- Filter OSC 52 reads and writes at each renderer's transport boundary, before
  Restty's output parser can access the host clipboard. Preserve raw controller
  history and cursor accounting; retain the filter across socket reconnects.
  The filter buffers only a possible header and discards clipboard payloads
  incrementally. Emit CAN at a blocked header so removed bytes cannot synthesize
  another escape sequence; treat nonclipboard C1 OSC as text to match Restty.
  User-initiated copy and paste still use the existing controls.
- Reset the consecutive recovery budget after replay metadata has arrived and
  an attachment has stayed healthy for five seconds. Rapid open/close flapping
  still exhausts the bounded retry schedule. No extra timer or connection owner
  is introduced.
- Catch each resize request's expected failure within the serialized drain.
  Preserve newer queued dimensions and send the latest absolute size after an
  older response fails, without repeating the old request.
- Separate theme synchronization from visibility/size updates. Transfer focus
  only for explicit terminal controls, preserving tab-list keyboard navigation
  and composer focus. Late initialization does not steal focus after the user
  has moved elsewhere.
- A renderer retry button reruns initialization on the same retained surface
  and PTY after owned cleanup settles. It reuses successful shared font bytes.
  Preserve an existing typed font failure instead of wrapping it into an empty
  error message, and always provide nonempty error text.
- Initialization may finish while hidden, but attachment waits for a visible
  surface with usable geometry. Update the grid before its first connection;
  subsequent hiding/reopening retains the same attachment. ResizeObserver also
  handles a layout becoming usable without another visibility transition.

Regressions cover split OSC requests, nonclipboard output preservation, bounded
payload handling, healthy recovery versus flapping, queued resize failure,
renderer retry without another PTY, and focus preservation. The real-server
browser flow exercises blocked OSC reads with clipboard permission available,
explicit paste, transient asset failure/retry, and three initialized tabs. It
also holds a retrying font load through hiding and verifies no socket or 1x1
PTY resize before reopening. Adversarial policy cases run through the installed
Restty output parser at every frame split and through the real browser renderer.

## Complexity budget

Introduce one terminal service, a packaged-font asset loader, a bounded output
clipboard policy, one Restty/OpenCode boundary, and controlled terminal UI.
Reuse the existing runtime, workspace owner, SDK authentication,
ticket helper, icons, buttons, and acceptance fixtures. No terminal engine,
native addon, local SSH manager, secondary server, or SDK cache mirror is needed.

Production/configuration changes add 1,714 lines and remove 37 (net +1,677).
The growth owns the new PTY lifecycle, renderer boundary, accessible panel, and bottom-panel
layout; the font loader handles the verified Electron asset boundary. There was
no prior terminal coordinator to replace. The existing TLS acceptance fixture
now owns WebSocket forwarding, and UI-driven packaged terminal checks replace
the old API-only PTY shutdown smoke check.

Review fixes increase the production net count by 141 lines. The output policy
addresses a verified upstream clipboard side effect. Surface retry and one
per-renderer attachment flag protect actual initialization and geometry rules.
They replace unconditional focus/attachment and whole-drain resize error
handling without adding another runtime, queue, timer, or state mirror.

Tests, stories, and fixtures add 2,037 lines and remove 28 (net +2,009). The
generated lockfile adds 19 lines; font license notices add 280 lines separately.
Four full, unmodified font binaries add 21,546,904 bytes (20.55 MiB). They avoid
the pinned WOFF2 decoder defect and provide offline Unicode coverage without
introducing a subsetting build pipeline.

## Completed verification

- Two fresh GPT-6.1 Sol / high reviews followed implementation of the original
  five findings. Round one found escape-synthesis/C1 clipboard bypasses and
  hidden-initialization geometry; both were fixed with regressions. Round two
  reported **no P1/P2 findings** across the full candidate at that stage. The
  later tab-row, quiet-status and accessibility refinements were covered by
  root, browser and packaged verification during local-main integration.
- Root `pnpm check` passed: formatting, lint/types, WDIO types, styles,
  component boundaries, and unused-code checks.
- Root `VITEST_MAX_WORKERS=1 pnpm test` with pinned Node 24.20.0
  passed: 155 desktop files / 1,650 tests, plus 67 tests in the other workspace
  suites. This includes
  all 11 terminal Storybook interaction/accessibility scenarios and the real
  authenticated HTTPS/WSS server flow.
- Browser acceptance covers Unicode input, clipboard paste, theme changes,
  close/recreate, chat and location navigation, hide/reopen, server resize,
  alternate-screen input, output floods, reconnect, and explicit PTY removal,
  plus the review-fix regressions above.
- Root `pnpm test:acceptance:mac` rebuilt the application and passed all eight
  packaged startup scenarios with pinned Node 24.20.0:

  ```sh
  pnpm test:acceptance:mac
  ```

  Terminal checks establish packaged font delivery and WASM initialization,
  keyboard input, server-side working directory, explicit close, recreation,
  and terminal/worker process cleanup on quit. The renderer CSP permits `'self'`
  connections so XHR can read its packaged assets.

- Inspected `apps/desktop/dist/web-artifacts/browser-terminal.png`,
  `browser-terminal-dark.png`, and
  `apps/desktop/dist/wdio-artifacts/packaged-terminal.png`: readable ASCII,
  CJK and monochrome emoji fallbacks, themed terminal colors, and correct
  bottom-panel placement.

Environment findings: Node 26's experimental web storage breaks existing JSDOM
storage tests without the option above. Its Chromedriver ZIP extraction also
stalls before WDIO starts workers; WDIO's exit hook misleadingly reports SIGINT
and exits zero. Node 24 executes the suite successfully. Only executed assertions
are counted as acceptance evidence. Intermediate full runs under heavy shared
host load hit unrelated permission, server-startup, syntax/highlight, transcript,
and diff timing failures. The final bounded-worker root run passed them all.

Remote transport is verified against the real pinned server behind the TLS
fixture, not a separate physical remote host. Remote shell persistence depends
on that server's lifetime. Ordinary bounded replay does not guarantee exact
screen restoration after long disconnections or reloads.

## Local-main integration

The feature was rebased onto main's UI, composer and session-state advances,
preserving the newer composer attachment callback and session empty-state props.
The browser-test conflict kept both catalog and font-failure helpers. A later
Storybook cleanup was also incorporated: terminal fixtures now use production
panel/shell components and upstream controls without a fake shell prompt or
story-only stylesheet. Root checks, all 11 terminal stories and real-server
browser acceptance passed after that reconciliation. The packaged result above
predates only the story/documentation cleanup; application code was identical.

The first post-cleanup root run encountered a Vite dependency-optimization reload
that invalidated other Storybook module imports. The rerun passed with settled
dependencies; no unrelated application repair was made.
