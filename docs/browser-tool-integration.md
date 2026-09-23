# Embedded session browser

Selecting a session in Electron automatically connects its browser. Choose Browser
beside Diff to enter an address, or let the agent open a page. Both operate the
same tabs. Hiding the panel or selecting another session keeps those tabs alive.
Closing a tab disposes its page. Reload, disconnect, session deletion/movement,
or app shutdown closes the relevant attachments and waits for cleanup.

A dropped connection is recoverable. While the selected session's Browser panel
is open, one automatic reconnect reuses the session's nonpersistent partition, so
cookies and site storage survive, and reopens the saved tab URLs. Unsaved page
state (forms, scroll, history) is lost, in-flight agent actions are never
replayed, and a notice says so. Replacement by another desktop stays manual.
Session deletion or movement, and a renderer reload, erase the retained profile
and its storage. The web app has no native browser capability and retains its
existing Diff panel.

## Pinned server contract

OpenCode `2.0.3` registers 44 browser operations through Code Mode:

```js
const tab = await tools.browser.tabs.open({ url: "http://localhost:3000" });
return await tools.browser.snapshot({ tabID: tab.id });
```

These are not separate direct model tools. The server owns catalog discovery,
permissions, command routing, output validation and exported server-local files.
The installed `@opencode/plugin-browser` exposes RPC schemas and its network proxy,
but no native Chromium backend. Our native implementation is adapted from upstream
commit `013ded3743eb9c198d8f544afdfd60fdad1e68a4`; attribution and MIT license are
retained beside the code. Upgrade these parts together.

Chromium runs on the desktop, but HTTP/HTTPS and WebSocket traffic goes through
the connected server. `localhost` therefore means that server. One nonpersistent
partition is retained per window, server and session across attachment
reconnects; it is erased when the session is deleted or moved, when the renderer
reloads, when the window closes, or when the desktop forgets the profile.
Loopback proxy bypass and nonproxied WebRTC are disabled. Pages have no Node integration. They load one dedicated annotation
preload in Electron's isolated world, which only draws the comment popover and
cannot reach Node or app APIs; device/media permissions remain denied. Renderer
IPC permits only navigation and tab controls.

## Element annotations

The Browser pane can capture user annotations. **Annotate** and **Select area**
start Chromium's element inspector over the pinned CDP connection
(`Overlay.setInspectMode`); the user clicks an element or drags an area, and
main reads the node's bounded context (frame URL, selector, tag, text, role,
`aria-label`, viewport bounds). Main captures the visible viewport, burns a
numbered outline or area rectangle into the bitmap with `nativeImage`, and then
opens a minimal comment popover in the page, anchored beside the selection.
Saving the comment returns it with the capture; dismissing it discards the
capture. Picks cancel on Escape, navigation, hiding the tab, tab disposal, or a
command targeting that tab; a command and a pick never overlap on one tab, while
other tabs proceed.

The popover lives in a closed shadow root styled with a constructed stylesheet,
so page styles and strict CSP cannot change it. It is the only oc-ui element in
a page, occupies only its own rectangle, and is removed when the editor closes.
Comments are typed there and cross a bounded channel to main; the page can
observe the popover's DOM node and the key events that pass through it, so
comments are not secret input.

The renderer keeps up to eight drafts per session and assigns stable numbers
that are never reused after a discard. Child-frame selections skip the page
popover and keep the pane's comment editor, because a frame-local rectangle
cannot position a top-document popover. Page-derived fields stay inside a
dynamically fenced untrusted-data block. **Add to composer** inserts the
formatted batch and its screenshots into the session composer in one update,
and only then clears the drafts. The server receives ordinary prompt text and
image attachments, never a desktop path.

`docs/browser-annotations-design.md` records the full design, the retained
prototype behavior, the failure modes, and the deferred live-marker and style
adjustment phases.

Upload paths and returned capture paths belong to the server. Files cross machines
as bytes, with a 5 MiB transfer limit. Do not treat server paths as desktop paths.
Page contents, headers, logs and screenshots remain untrusted tool output.
In this beta, individual operations do not request approval. A `browser` deny rule
on `*` removes the catalog; `plugins: ["-opencode.browser"]` disables the plugin.
An `ask` rule does not supply per-action protection in this version.

## Ownership and ordering

- Electron main owns one scoped attachment per server/session. Its scope owns the
  SDK connection, native tabs, network proxy, queued replies and command fibers.
- Main also retains one window-scoped browser profile per server/session: the
  nonpersistent partition and a checkpoint of tab URLs and the focused index. The
  attachment scope owns the live pages and proxy; the profile survives a dropped
  attachment until the session is forgotten, moved or deleted, the renderer
  reloads, or the window closes. A profile is reused only while the session stays
  in the same location.
- Both server RPC and desktop IPC attach calls remain pending for the attachment's
  lifetime. The renderer workspace retains its IPC call; disposing a view only
  hides the native viewport. Workspace cancellation detaches before awaiting IPC.
- Subscribe before server attach. The matching `attached` event marks readiness;
  setup has a 15-second deadline. After a drop, restoration rebuilds the saved
  tabs (bounded to 30 seconds) before the connection becomes usable, and the
  restored state is acknowledged before command results so the server recognizes
  the new tab IDs. A failed setup keeps the previous checkpoint; destinations a
  slow page left unattempted stay saved for the next reconnect, and a tab whose
  first load failed keeps its intended URL.
- The renderer surfaces tab focus only for the selected session. A background
  session's retained tabs keep updating through state events, but its focus events
  cannot replace the session the user is viewing. A forwarded focus opens the
  context panel on Browser and is remembered as that session's panel layout.
- Serialize conflicting commands. Stop and Close may release a waiting navigation.
  Forward cancellation, retain native operations until settlement, and await
  cleanup before deleting temporary files. Never replay uncertain mutations.
- A usable connection that drops arms one automatic reconnect, consumed only while
  the selected session's Browser panel is open. Replacement and protocol failures
  never reclaim automatically, and a failed automatic attempt falls back to the
  manual Reconnect button. The renderer forwards session deletion/movement to
  main, which stops matching attachments and erases the profile's storage.
  Replacement is terminal; selecting the session again does not reclaim ownership.

## Review of retained production code

Paths below are relative to `apps/desktop` unless otherwise stated. Each row names
a concrete responsibility; the underlying operation dispatch still covers all 44
pinned tools. Tests, documentation and generated dependencies are counted separately.

| Code                                                                                                     | Why it remains                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/main/browser/host.ts`                                                                               | One attachment owner; authenticated, location-aware RPC; readiness, reply ordering, cancellation, replacement, window lifetime and cleanup. Also window-scoped profiles (retained partition and tab checkpoint), bounded restoration, recoverable-disconnect classification and profile erasure. |
| `src/main/browser/native.ts`                                                                             | Native tab inventory, popup ownership, focus, bounded layout and disposal of tabs still closing. Captures URL checkpoints and reopens saved tabs without announcing a user focus.                                                                                                                |
| `src/main/browser/network.ts`                                                                            | Published proxy adaptation, server-side traffic routing, exact proxy authentication, retained-partition configuration and private connection and storage cleanup.                                                                                                                                |
| `src/main/browser/upstream/page.ts`                                                                      | Secure page creation; navigation, frames, references, accessibility snapshots, input, evaluation, waits, screenshots, dialogs, uploads/downloads and dispatch to diagnostics/profiling. Stale-document and stale-ref checks prevent acting on replaced content.                                  |
| `src/main/browser/upstream/cdp.ts`                                                                       | Typed Chromium commands and iframe event routing; listener cleanup and cancellable bounded waits.                                                                                                                                                                                                |
| `src/main/browser/upstream/policy.ts`, `errors.ts`                                                       | Allowed navigation destinations and actionable failures, including ambiguous mutation outcomes.                                                                                                                                                                                                  |
| `src/main/browser/upstream/files.ts`                                                                     | Private temporary files, download state, bounded transfers and cleanup; exported metadata reuses the pinned schema.                                                                                                                                                                              |
| `src/main/browser/upstream/diagnostics.ts`                                                               | Console/error capture, redirects, WebSockets, headers and request/response bodies. Retention limits and credential redaction prevent oversized or sensitive output.                                                                                                                              |
| `src/main/browser/upstream/profiling.ts`, `analysis.ts`                                                  | Trace/CPU/heap capture and all analysis operations. Renderer-process filtering, recording ownership, limits and heap validation are required for correct results.                                                                                                                                |
| `src/main/browser/upstream/lighthouse.ts`                                                                | Narrow Electron CDP adapter for the pinned Lighthouse snapshot API; scores and report-file exports.                                                                                                                                                                                              |
| `src/shared/browser-api.ts`, `desktop-api.ts`, `src/main/index.ts`, `src/preload/index.ts`               | One validated request channel plus events, trusted sender checks, capability exposure and integration into the existing runtime/shutdown path.                                                                                                                                                   |
| `src/renderer/components/App/ConnectedApp/Browser/createSessionBrowser.ts`                               | Workspace-scoped attach calls and atom state; automatic connection, one visibility-gated recovery opportunity, session-removal forwarding and guarded commands. No second native inventory or idle attachment fiber.                                                                             |
| `BrowserPane.tsx`, `BrowserRegion.tsx`, `BrowserPane.css` in that directory                              | Controlled, accessible browser controls and error states; region supplies native content while stories exercise the same pane.                                                                                                                                                                   |
| `BrowserViewport.tsx` in that directory                                                                  | DOM measurement and visibility only. Native views must hide under dialogs, when covered, and on unmount; resize and scroll update bounds.                                                                                                                                                        |
| `ConnectedApp.tsx`, `createWorkspace.ts`, `src/renderer/connection.ts`, `Shell/createShellPanelState.ts` | Existing workspace/connection ownership, selected-session wiring and context-panel selection.                                                                                                                                                                                                    |
| `Shell/ContextTitlebarRegion.tsx`, `Changes/ContextPanel/ContextTabs.css`                                | Shared Diff/Browser controls, including mobile placement; replaces the previous Diff-only titlebar.                                                                                                                                                                                              |
| `Conversation/SessionPane/TranscriptView/AssistantMessage/ToolCall.tsx`, `SessionPane.css`               | Render returned browser images instead of exposing a giant data URI. Existing annotations and nonimage attachments remain intact.                                                                                                                                                                |
| Root workspace/lockfile, desktop package/build configuration and `tools/stage-opencode.mjs`              | Direct protocol dependency, Chromium protocol types and Lighthouse runtime/assets. Existing package-closure staging is reused. ES2024 supplies the native backend's promise settlement API.                                                                                                      |
| Root `vite.config.ts`                                                                                    | The adapted native backend retains upstream Promise/CDP conventions; oc-ui workflow code remains under Effect lint rules and the backend remains type/build checked.                                                                                                                             |

## Removed machinery

- Unused rounded-corner bitmap generation and two extra native overlay views per
  tab. oc-ui never passed a corner color, so these views never rendered anything.
- Unused approval-preview metadata: document/resource indexes, dialog revisions,
  capture-source tracking and preview dispatch. The pinned `tools.js` calls
  `target.request(files)` without `inspect` or `target`; future requests carrying
  those flags now fail before executing anything. Generation/ref checks remain.
- The renderer's separate live-attachment map, deferred close signals, idle
  fibers, closing state and duplicate session-deletion/movement subscriptions.
- Duplicated mutable main-process status, error, scope and gate fields; active
  command/layout access is published only when the connection is ready.
- Four near-identical IPC handlers, an unnecessary direct Puppeteer dependency,
  and a separate implementation-plan/history document.

No tool operations, file/size limits, proxy rules, sandbox checks or required
cleanup were removed. Further large cuts to the native backend would require a
published upstream implementation or a narrower supported tool set.

## Verification

Use [App verification](app-verification.md). Root checks/tests and packaged
acceptance are required for changes across this native boundary. The focused
lifetime tests exercise pending setup, state-before-result ordering, in-flight
cancellation, replacement and cleanup, partition reuse, checkpoint capture,
bounded restoration, recoverable-disconnect classification and profile erasure;
the native recovery tests cover URL order, focus without a user-focus callback,
failed destinations and abort settlement. The packaged fixture uses the real pinned
server and scripted provider; it covers agent use before opening Browser, shared
page input, file transfers, diagnostics/profiling, screenshots/Lighthouse, hiding,
reopening, session switching, tab cleanup and reload. A scripted provider does not
establish live-model quality; a same-machine proxy test does not establish a
separate remote deployment. Browser screenshots exclude separate native views.

Sources: [pinned plugin](https://github.com/anomalyco/opencode/tree/d44b52ca66b6bf69626c0384626d1a9cd9555977/packages/plugin-browser),
[pinned native backend](https://github.com/anomalyco/opencode/blob/d44b52ca66b6bf69626c0384626d1a9cd9555977/packages/desktop/src/main/browser-chromium.ts),
[local version record](../apps/desktop/src/main/browser/upstream/README.md). Installed source is authoritative
when current online documentation differs.
