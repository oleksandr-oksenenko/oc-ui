# App verification

Choose checks from the behavior and boundaries a change can affect. Use small,
repeatable tests for detailed failure cases, browser inspection for visible UI,
and the real app and server for integration. Keep the root completion gates.

## Choose what to check

For implementation changes, always run `pnpm check` and `pnpm test` from the
repository root after the final edit. Add the checks in every applicable row:

| Change                                                                             | Focused evidence                                                                           | Runtime evidence                                                                                                          |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Pure calculation, parsing, validation, projection                                  | Unit tests for changed rules, boundaries, and real regressions                             | None unless an external contract or visible behavior changes                                                              |
| Component markup, styles, controls, accessibility                                  | Relevant Storybook states and interactions; browser inspection against the visual contract | Full-app browser check; Electron for host-dependent layout or native behavior                                             |
| Renderer workflow or shared state: sessions, composer, forms, reviews, navigation  | Controller tests for ownership and failures; stories for visible states                    | Complete the affected browser flow against the pinned server; check navigation away and back                              |
| Async ownership, cancellation, ordering, retries, cleanup                          | Deterministic tests of the relevant interleavings, including failure and interruption      | Exercise the affected real connection or resource; use packaged acceptance when native processes or shutdown are involved |
| OpenCode client, server contract, authentication, streaming, filesystem operations | Boundary tests with upstream types and realistic responses                                 | Browser acceptance with the pinned server; packaged acceptance for native/server ownership changes                        |
| Main process, preload, IPC, settings, worker lifecycle, native UI                  | Tests of validation, failure, settlement, and cleanup at the changed boundary              | Packaged acceptance plus actual native interaction where the tests use mocks                                              |
| Build configuration, runtime dependencies, resource paths, packaging               | Root checks plus affected builds                                                           | Launch the affected browser build or newly packaged app; verify delivered artifacts                                       |
| Storybook configuration or test infrastructure                                     | Run the affected suite itself; verify it discovers and executes the intended scenarios     | Build Storybook for configuration changes; run packaged acceptance for changes to its runner or fixtures                  |
| Documentation only                                                                 | Check instructions against current scripts/source, links, and formatting                   | No app launch unless the edit documents runtime behavior that needs new evidence                                          |

A behavior-preserving refactor can rely on existing tests when they cover its
ownership and failure paths. Add one focused regression test for each real gap.
Do not repeat the same assertion across unit tests, stories, and acceptance tests
unless each exercises a different boundary. A small visual edit does not need a
new test that merely restates its CSS or markup.

## Available verification surfaces

- **Unit and controller tests:** the `unit` Vitest project uses JSDOM and controlled
  dependencies. Use it for calculations, state transitions, and difficult timing
  cases. It does not establish browser layout or real Electron behavior.
- **Storybook:** `pnpm storybook` opens the existing component catalog on port 6006.
  Use the Codex in-app browser for inspection. Its automated Chromium interaction
  and accessibility tests already run in `pnpm test`. See
  [Storybook verification](storybook-verification.md) for setup and focused runs.
- **Full browser app:** `pnpm dev:web` serves the real application for in-app browser
  inspection. Connect to an independently running pinned server. The `web` Vitest
  project runs a production build against its own disposable server, provider,
  and Git fixtures as part of `pnpm test`. It requires OpenSSL for its TLS fixture.
- **Electron:** launch with `pnpm dev` from the root for native integration and
  host-dependent layout. The in-app browser cannot attach to the Electron window.
  Use existing WebdriverIO acceptance for repeatable DOM interaction and computer
  use for exploratory native checks.
- **Packaged acceptance:** `pnpm test:acceptance:mac` builds and tests the macOS
  arm64 app using WebdriverIO, the real pinned OpenCode server, disposable state,
  and a scripted local provider. It is separate from `pnpm test` and `pnpm ready`.
  Native Quit confirmation and keychain behavior use test substitutes; this does
  not prove the appearance of native dialogs or real OS credential integration.

Browser mode has its own explicit entrypoint and settings adapter. Do not open the
Electron renderer URL as a substitute. Storybook remains the surface for controlled
component states; the full browser app verifies real server workflows.

## Check affected UI

Use the approved story, mockup, and latest annotations as the visual contract.
Check the following where the changed UI supports them:

1. First open, close and reopen, and collapse or remount. Confirm that drafts and
   selection survive or reset according to their owner.
2. Normal, empty, loading, disabled, and error states, including recovery. Use
   controlled stories for states that are difficult to trigger reliably.
3. Pointer interaction, keyboard activation, Tab order, visible focus, Escape,
   and focus returning to the initiating control after dismissal.
4. Resize, narrow layout, long content, scrolling, clipping, and overlays. Use
   Storybook's 1440 × 900, 820 × 900, and 390 × 760 presets for responsive changes;
   in Electron, check the supported window sizes and native titlebar inset.
5. Complete the changed action and observe its result. A screenshot of an open
   dialog is not evidence that submitting it works.

Automated accessibility checks complement keyboard and visual inspection. Keep
the existing Storybook accessibility failure gate enabled. Inspect the actual
browser app after the final renderer change. Use stories for the detailed state
matrix. Also inspect Electron when native integration, host-dependent layout,
preload, settings, built-in server ownership, or packaging is affected.

## Check workflows and resources

For an affected workflow, cover success and the failures its owner must handle:

- **Connections:** invalid input, rejected credentials, unreachable server,
  initial stream failure, disconnect/reconnect, and replacement by a newer attempt.
- **Mutations:** duplicate submission, navigation during a pending request,
  partial completion, retry, and late acknowledgement. Observe both UI and server
  state when relevant; do not assume a missing response means nothing changed.
- **Lifetimes:** losing a subscriber, unmounting, reload, cancellation, and owner
  shutdown. Verify actual resource settlement, not only that a loading flag clears.
- **Persistence:** save, reload, forget, and write failure. For filesystem changes,
  use the server's complete location context and confirm the intended files or
  worktrees changed while unrelated content remained intact.

Select cases based on the change; do not run this entire list for every edit.
Prefer controlled time and explicit synchronization to arbitrary sleeps. Extend
the existing acceptance flows when real boundaries need coverage; avoid a second
full-app test framework. The
[functional verification record](effect-functional-verification.md) maps existing
coverage and its limits. Its recorded results are historical, not a current pass.

Use disposable app settings, server data, and project fixtures for tests that
change sessions, credentials, files, or processes. Reuse the packaged runner's
isolation and scripted provider. Do not use personal projects or real provider
credentials by default. The launcher owns its child processes and cleanup;
verify their exit before deleting their state. Preserve useful failure artifacts
without exposing credentials. Select only processes belonging to the test run.

## Build and delivery checks

- Run `pnpm build` when changing bundling, entrypoints, or dependency resolution.
  Run `pnpm build:web` for browser entry, assets, or deployment changes.
  Run `pnpm build-storybook` for Storybook configuration or build integration.
  `pnpm ready` combines root checks, all tests, and desktop/browser/Storybook builds.
- Use `pnpm test:acceptance:mac` for the integration rows above and before
  delivering a macOS app. It checks the packaged signature and architecture as
  well as runtime scenarios; a development launch cannot establish packaging.
- When delivering a DMG, build it with `pnpm make:mac` and also verify that exact
  artifact with `hdiutil verify`. Report signing and notarization separately.
  Run delivery checks on the final combined checkout and rebuild after changes
  that affect the artifact.

Focused checks are useful while editing but do not replace the root gates. Fix
findings before completion. If a required check cannot run, state the missing
dependency or environment and leave that verification explicitly incomplete.
After checks pass, repeat or broaden them only for subsequent edits, failures,
or an unresolved risk.

## Browser deployment and lifecycle checks

The [browser mode contract](browser-mode-design.md) covers supported origins,
address-only persistence, independent tabs, reload and cached-page restoration.
Use the full browser app by default for renderer workflows, Storybook for detailed
component states, and Electron for native and host boundaries.

Browser acceptance uses a disposable HTTPS certificate trusted only by the test
context. Production code retains ordinary browser certificate validation. Check
a real deployment's TLS, authorization preflights, allowed UI origin, and streamed
responses separately when deploying. The initial verified browser is Chromium.

## Report the result

Keep the completion report short and specific:

- What changed and which behavior was checked.
- Which root gates, browser scenarios, Electron scenarios, and builds passed.
- The tested checkout/artifact and any relevant screenshots or logs.
- What used controlled data, a real server, or a native substitute; any remaining
  failures or unverified behavior. Report app, renderer, and server status separately
  when leaving them running.
- For features and refactors, production lines added, removed, and net change;
  count tests, documentation, and generated code separately. Name new abstractions
  and old machinery removed.

Do not describe a build as a runtime test, an automated story as visual approval,
or a scripted provider run as proof of compatibility with a live model service.
