# Embedded session browser

Selecting a session in Electron automatically connects its browser. Choose Browser
beside Diff to enter an address, or let the agent open a page. Both operate the
same tabs. Hiding the panel or selecting another session keeps those tabs alive.
Closing a tab disposes its page. Reload, disconnect, session deletion/movement,
or app shutdown closes the relevant attachments and waits for cleanup.
Reconnect is explicit after failure or replacement by another desktop. The web
app has no native browser capability and retains its existing Diff panel.

## Pinned server contract

OpenCode `0.0.0-beta-19271` registers 44 browser operations through Code Mode:

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
the connected server. `localhost` therefore means that server. Each attachment
gets a fresh, nonpersistent partition; loopback proxy bypass and nonproxied WebRTC
are disabled. Pages have no Node integration or oc-ui preload, and device/media
permissions remain denied. Renderer IPC permits only navigation and tab controls.

Upload paths and returned capture paths belong to the server. Files cross machines
as bytes, with a 5 MiB transfer limit. Do not treat server paths as desktop paths.
Page contents, headers, logs and screenshots remain untrusted tool output.
In this beta, individual operations do not request approval. A `browser` deny rule
on `*` removes the catalog; `plugins: ["-opencode.browser"]` disables the plugin.
An `ask` rule does not supply per-action protection in this version.

## Ownership and ordering

- Electron main owns one scoped attachment per server/session. Its scope owns the
  SDK connection, native tabs, network proxy, queued replies and command fibers.
- Both server RPC and desktop IPC attach calls remain pending for the attachment's
  lifetime. The renderer workspace retains its IPC call; disposing a view only
  hides the native viewport. Workspace cancellation detaches before awaiting IPC.
- Subscribe before server attach. The matching `attached` event marks readiness;
  setup has a 15-second deadline. Acknowledged tab state precedes command results
  so the server recognizes newly returned tab IDs.
- The renderer surfaces tab focus only for the selected session. A background
  session's retained tabs keep updating through state events, but its focus events
  cannot replace the session the user is viewing.
- Serialize conflicting commands. Stop and Close may release a waiting navigation.
  Forward cancellation, retain native operations until settlement, and await
  cleanup before deleting temporary files. Never replay uncertain mutations.
- The server already closes attachments on session deletion/movement. The renderer
  projects terminal events rather than adding a second session cleanup coordinator.
  Replacement is terminal; selecting the session again does not reclaim ownership.

## Review of retained production code

Paths below are relative to `apps/desktop` unless otherwise stated. Each row names
a concrete responsibility; the underlying operation dispatch still covers all 44
pinned tools. Tests, documentation and generated dependencies are counted separately.

| Code                                                                                                     | Why it remains                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/browser/host.ts`                                                                               | One attachment owner; authenticated, location-aware RPC; readiness, reply ordering, cancellation, replacement, window lifetime and cleanup.                                                                                                                     |
| `src/main/browser/native.ts`                                                                             | Native tab inventory, popup ownership, focus, bounded layout and disposal of tabs still closing.                                                                                                                                                                |
| `src/main/browser/network.ts`                                                                            | Published proxy adaptation, server-side traffic routing, exact proxy authentication and private connection cleanup.                                                                                                                                             |
| `src/main/browser/upstream/page.ts`                                                                      | Secure page creation; navigation, frames, references, accessibility snapshots, input, evaluation, waits, screenshots, dialogs, uploads/downloads and dispatch to diagnostics/profiling. Stale-document and stale-ref checks prevent acting on replaced content. |
| `src/main/browser/upstream/cdp.ts`                                                                       | Typed Chromium commands and iframe event routing; listener cleanup and cancellable bounded waits.                                                                                                                                                               |
| `src/main/browser/upstream/policy.ts`, `errors.ts`                                                       | Allowed navigation destinations and actionable failures, including ambiguous mutation outcomes.                                                                                                                                                                 |
| `src/main/browser/upstream/files.ts`                                                                     | Private temporary files, download state, bounded transfers and cleanup; exported metadata reuses the pinned schema.                                                                                                                                             |
| `src/main/browser/upstream/diagnostics.ts`                                                               | Console/error capture, redirects, WebSockets, headers and request/response bodies. Retention limits and credential redaction prevent oversized or sensitive output.                                                                                             |
| `src/main/browser/upstream/profiling.ts`, `analysis.ts`                                                  | Trace/CPU/heap capture and all analysis operations. Renderer-process filtering, recording ownership, limits and heap validation are required for correct results.                                                                                               |
| `src/main/browser/upstream/lighthouse.ts`                                                                | Narrow Electron CDP adapter for the pinned Lighthouse snapshot API; scores and report-file exports.                                                                                                                                                             |
| `src/shared/browser-api.ts`, `desktop-api.ts`, `src/main/index.ts`, `src/preload/index.ts`               | One validated request channel plus events, trusted sender checks, capability exposure and integration into the existing runtime/shutdown path.                                                                                                                  |
| `src/renderer/components/App/ConnectedApp/Browser/createSessionBrowser.ts`                               | Workspace-scoped attach calls and atom state; automatic connection, explicit recovery and guarded commands. No second native inventory or idle attachment fiber.                                                                                                |
| `BrowserPane.tsx`, `BrowserRegion.tsx`, `BrowserPane.css` in that directory                              | Controlled, accessible browser controls and error states; region supplies native content while stories exercise the same pane.                                                                                                                                  |
| `BrowserViewport.tsx` in that directory                                                                  | DOM measurement and visibility only. Native views must hide under dialogs, when covered, and on unmount; resize and scroll update bounds.                                                                                                                       |
| `ConnectedApp.tsx`, `createWorkspace.ts`, `src/renderer/connection.ts`, `Shell/createShellPanelState.ts` | Existing workspace/connection ownership, selected-session wiring and context-panel selection.                                                                                                                                                                   |
| `Shell/ContextTitlebarRegion.tsx`, `Changes/ContextPanel/ContextTabs.css`                                | Shared Diff/Browser controls, including mobile placement; replaces the previous Diff-only titlebar.                                                                                                                                                             |
| `Conversation/SessionPane/TranscriptView/AssistantMessage/ToolCall.tsx`, `SessionPane.css`               | Render returned browser images instead of exposing a giant data URI. Existing annotations and nonimage attachments remain intact.                                                                                                                               |
| Root workspace/lockfile, desktop package/build configuration and `tools/stage-opencode.mjs`              | Direct protocol dependency, Chromium protocol types and Lighthouse runtime/assets. Existing package-closure staging is reused. ES2024 supplies the native backend's promise settlement API.                                                                     |
| Root `vite.config.ts`                                                                                    | The adapted native backend retains upstream Promise/CDP conventions; oc-ui workflow code remains under Effect lint rules and the backend remains type/build checked.                                                                                            |

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
cancellation, replacement and cleanup. The packaged fixture uses the real pinned
server and scripted provider; it covers agent use before opening Browser, shared
page input, file transfers, diagnostics/profiling, screenshots/Lighthouse, hiding,
reopening, session switching, tab cleanup and reload. A scripted provider does not
establish live-model quality; a same-machine proxy test does not establish a
separate remote deployment. Browser screenshots exclude separate native views.

Sources: [pinned plugin](https://github.com/anomalyco/opencode/tree/013ded3743eb9c198d8f544afdfd60fdad1e68a4/packages/plugin-browser),
[pinned native backend](https://github.com/anomalyco/opencode/blob/013ded3743eb9c198d8f544afdfd60fdad1e68a4/packages/desktop/src/main/browser-chromium.ts),
[local version record](opencode-beta-19271.md). Installed source is authoritative
when current online documentation differs.
