# App verification

Choose checks from the behavior and boundaries a change can affect. Use small,
repeatable tests for detailed failure cases and reusable acceptance tests against
the real app and server for final behavioral verification. Run the fast tier
locally and let GitHub Actions run the full heavier tiers. Use browser-use for
exploration and visual questions that those tests do not answer.

## Verification tiers

| Tier            | Contents                                                                                                                       | Commands from the root                                 | Default execution                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | -------------------------------------------------------------------------- |
| 0 — Fast        | Formatting, lint, types, style/layout/unused-code checks; prompt-editor, session-tools, and desktop unit/controller tests      | `pnpm check` + `pnpm test`, or `pnpm ready`            | Locally after implementation; every PR and push to `main` in CI            |
| 1 — Components  | Storybook interaction/accessibility tests and real Chromium storage tests (`storybook`, `storage`)                             | `pnpm test:components`                                 | Every PR and push to `main` in CI                                          |
| 2 — Integration | Production browser acceptance, pinned-server contracts, browser inspection startup/cleanup, and server-backed shutdown (`web`) | `pnpm test:integration`                                | Every PR and push to `main` in CI                                          |
| 3 — Native      | Packaged macOS arm64 signature/architecture, Electron/IPC/settings/server lifetime, and scripted-provider acceptance           | `pnpm test:acceptance:mac`                             | Pushes to `main` and manual workflow dispatch in CI; before macOS delivery |
| Build checks    | Desktop, browser, and static Storybook builds                                                                                  | `pnpm build`, `pnpm build:web`, `pnpm build-storybook` | Every PR and push to `main` in CI                                          |

[CI workflow](../.github/workflows/ci.yml) runs the fast, component, integration,
and build jobs independently on Linux x64 and macOS arm64. Desktop builds and
native acceptance require macOS arm64. All jobs use `.node-version` and the frozen
lockfile and report separate results. Dependency caching and stored artifact
uploads remain disabled; diagnostics are available in the job logs. PR dependency
review remains enabled. Obsolete PR runs are cancelled. A manual dispatch on a
branch runs all tiers, including native acceptance, before merging a
native-sensitive change when needed.

`pnpm test` runs only tier 0 tests: no Chromium, app server, or packaged app is
started. `pnpm ready` is the local completion gate (`check` + `test`), with no
builds. `pnpm test:local` remains an alias for `pnpm test`. `pnpm test:all` opts
into tiers 0–2; `pnpm ready:ci` also includes static
checks and all three builds. Neither includes packaged acceptance or the
credential-dependent `test:acceptance:chat:mac` live-provider run.

During edits, run the smallest relevant test. After implementation, run tier 0
once locally and rely on CI for full heavier suites. Run focused stories or an
integration scenario locally when diagnosing a failure, developing new coverage,
or resolving a question before CI is available. Native/visual questions that
automation cannot establish still need targeted inspection. The affected-boundary
table below describes required coverage, not a requirement to launch every
applicable full suite locally.

Heavy suites are not skipped in CI based on changed paths. A local tier 0 pass is
local evidence only; report heavier tiers as pending until their CI jobs pass on
the completed candidate. Do not claim the full change is verified from a local
`pnpm ready` pass alone.

## Start here

Read the change's diff and select the applicable rows below once. Record the
affected behavior and checks in the task; a separate verification plan or skill is
not required. Use one execution owner for setup, interaction, and test supervision.
When work is delegated, hand back commands, results, and artifact locations so the
reviewer can inspect evidence without repeating setup and passing checks.

For a fresh worktree, run `pnpm install --frozen-lockfile` if dependencies are
missing. Install Chromium using the command in
[Storybook verification](storybook-verification.md) only when its runtime is
missing. Reuse the active session's known checkout, tool session ID, URLs, and log
paths. Rediscover them only after a failure or environment change.

## Exploration and final verification

Use browser-use (agent-operated browser interaction) for ad-hoc checks during
implementation: try an idea, reproduce a failure, or discover the expected flow.
`pnpm verify:browser` supplies that environment; it does not run UI assertions.
When a behavior needs lasting coverage, turn the meaningful scenario into a test
in the existing suite. Do not save every exploratory click as a regression test.

For final behavioral verification, use the applicable reusable tests on the
completed candidate, normally through CI. A passing automated browser flow against the real server
satisfies that behavioral check; do not repeat it through browser-use by default.
Use targeted visual or native inspection for remaining questions such as spacing,
clipping, usability, or OS dialogs covered by test substitutes. State that question
and its result. An uncovered important behavior needs a reusable regression test;
an ad-hoc pass alone is not durable coverage. If automation is blocked, report the
gap explicitly rather than silently substituting a manual walkthrough.

## Start an isolated browser inspection

From the repository root:

```sh
pnpm verify:browser
```

Keep this command in an interactive terminal. It reuses the browser acceptance
fixtures to start the real browser dev entry, pinned OpenCode executable, local
scripted provider, and disposable Git project. Both listeners use available ports;
existing dev servers are left alone. After authenticated health and browser-entry
checks succeed, one `ready` record prints the UI URL, server URL, disposable
credentials, and project directory. Open that UI URL in the Codex in-app browser,
enter the server URL and password, connect, and select the printed project.

Complete the affected action and inspect its result using the checklist below.
For a simple chat smoke check, create a session in the fixture project, send a
prompt, and observe the streamed acceptance response. The provider is scripted;
this cannot establish compatibility with a live model service. Read
`apps/desktop/test/e2e/scripted-provider.mjs` for specific failure scenarios only
when needed. Use stories for controlled component states.

Ctrl-C in the owning terminal closes its server, provider, and Vite instance before
removing its profile. Startup/runtime failures retain the profile for diagnosis.
Close the browser tab when finished; the launcher does not own browser tabs or
their browser-local storage. Do not kill processes by name or delete another run's
state. `pnpm verify:browser --smoke` checks startup/readiness and cleanup without
waiting for interaction; it is not UI verification. Use ordinary `pnpm dev:web`
when you intentionally need a separately managed server or project.

## Run checks without repeated supervision

Use `pnpm test` for package and desktop unit tests during local development;
it does not require Chromium. Use a focused existing project while fixing a failure, for example
`pnpm --filter desktop exec vp test run --project=unit <test-file>` or
`pnpm --filter desktop exec vp test run --project=storybook <story-file>`. Run the required root gates
on the completed candidate. Preserve full logs locally and return a bounded tail
plus the exit status; do not stream every passing test into the task context:

```sh
verification_log=$(mktemp -t ocui-verification)
(pnpm check && pnpm test) > "$verification_log" 2>&1
verification_status=$?
tail -n 60 "$verification_log"
printf '\nVerification exit: %s; full log: %s\n' "$verification_status" "$verification_log"
(exit "$verification_status")
```

If `check` fails, this sequence does not run `test`. Report that distinction.
GitHub CI runs tiers 0–2 and browser/Storybook builds on Linux x64 and macOS arm64
for every pull request and push to `main`. Desktop builds also run on macOS for
both events. Packaged acceptance runs on `main` and manual dispatch. Use the tier
policy above to distinguish local evidence from completed CI evidence.
Use a 30–60 second completion-aware tool wait and retain its process/session ID
while a command runs. Avoid one-second polling or restarting a quiet command.
Read targeted failure lines from the full log if the tail is insufficient. Once
the selected checks pass, stop unless a relevant edit, failure, or unresolved risk
requires another run. Neither shorter output nor fewer waits reduces coverage.

## Choose what to check

For implementation changes, always run `pnpm check` and `pnpm test` from the
repository root after the final edit. Ensure coverage for every applicable row
through the CI tiers; use focused local runs and inspection as described above:

| Change                                                                             | Focused evidence                                                                             | Runtime evidence                                                                                                          |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Pure calculation, parsing, validation, projection                                  | Unit tests for changed rules, boundaries, and real regressions                               | None unless an external contract or visible behavior changes                                                              |
| Component markup, styles, controls, accessibility                                  | Storybook interaction/accessibility tests; targeted visual inspection for appearance changes | Automated browser coverage for affected integration; Electron for host-dependent layout or native behavior                |
| Renderer workflow or shared state: sessions, composer, forms, reviews, navigation  | Controller tests for ownership and failures; stories for visible states                      | Automated affected browser flow against the pinned server, including navigation away and back                             |
| Async ownership, cancellation, ordering, retries, cleanup                          | Deterministic tests of the relevant interleavings, including failure and interruption        | Exercise the affected real connection or resource; use packaged acceptance when native processes or shutdown are involved |
| OpenCode client, server contract, authentication, streaming, filesystem operations | Boundary tests with upstream types and realistic responses                                   | Browser acceptance with the pinned server; packaged acceptance for native/server ownership changes                        |
| Main process, preload, IPC, settings, worker lifecycle, native UI                  | Tests of validation, failure, settlement, and cleanup at the changed boundary                | Packaged acceptance plus actual native interaction where the tests use mocks                                              |
| Build configuration, runtime dependencies, resource paths, packaging               | Root checks plus affected builds                                                             | Launch the affected browser build or newly packaged app; verify delivered artifacts                                       |
| Storybook configuration or test infrastructure                                     | Run the affected suite itself; verify it discovers and executes the intended scenarios       | Build Storybook for configuration changes; run packaged acceptance for changes to its runner or fixtures                  |
| Documentation only                                                                 | Check instructions against current scripts/source, links, and formatting                     | No app launch unless the edit documents runtime behavior that needs new evidence                                          |

A behavior-preserving refactor can rely on existing tests when they cover its
ownership and failure paths. Add one focused regression test for each real gap.
Do not repeat the same assertion across unit tests, stories, and acceptance tests
unless each exercises a different boundary. A small visual edit does not need a
new test that merely restates its CSS or markup.

## Available verification surfaces

- **Unit and controller tests:** the `unit` Vitest project uses JSDOM and controlled
  dependencies. Use it for calculations, state transitions, and difficult timing
  cases. It does not establish browser layout or real Electron behavior.
- **Storybook:** `pnpm storybook` serves the existing component catalog on port 6006
  without opening a browser. Open the printed URL in the Codex in-app browser for
  inspection. Its automated Chromium interaction and accessibility tests run in
  `pnpm test:components` (tier 1). See
  [Storybook verification](storybook-verification.md) for setup and focused runs.
- **Full browser app:** `pnpm dev:web` serves the real application for in-app browser
  inspection. Connect to an independently running pinned server. The `web` Vitest
  project runs a production build against its own disposable server, provider,
  and Git fixtures as part of `pnpm test:integration` (tier 2). It requires OpenSSL
  for its TLS fixture and zsh for server shell/terminal scenarios.
- **Electron:** launch with `pnpm dev` from the root for native integration and
  host-dependent layout. The in-app browser cannot attach to the Electron window.
  Use existing WebdriverIO acceptance for repeatable DOM interaction and computer
  use for exploratory native checks. Every `pnpm dev` launch exposes localhost
  profiling attach points (set a port variable to an empty string to opt out):
  - renderer: Chrome DevTools Protocol at `http://127.0.0.1:9222` (`REMOTE_DEBUGGING_PORT`)
  - main process: V8 inspector at `127.0.0.1:9229` (`V8_INSPECTOR_PORT`)
  - built-in OpenCode child: V8 inspector at `127.0.0.1:9230` (`OCUI_OPENCODE_INSPECTOR_PORT`)

  Attach with `chrome://inspect` or any CDP client for CPU profiles, heap
  snapshots, and traces. Automatic defaults are scoped to real development
  launches; the packaged app does not enable them automatically. An explicit
  port variable can still enable one for other unpackaged runs.

- **Packaged acceptance:** `pnpm test:acceptance:mac` builds and tests the macOS
  arm64 app using WebdriverIO, the real pinned OpenCode server, disposable state,
  and a scripted local provider (tier 3). It is separate from `pnpm test` and
  `pnpm ready:ci` and runs on `main` or manual CI dispatch by default.
  Native dialogs and keychain behavior use test substitutes; this does not prove
  the appearance of native dialogs or real OS credential integration.

Browser mode has its own explicit entrypoint and settings adapter. Do not open the
Electron renderer URL as a substitute. Storybook remains the surface for controlled
component states; the full browser app verifies real server workflows.

## Write reusable acceptance tests

Choose the smallest existing suite that exercises the requirement. Keep pure
rules and difficult timing cases in unit/controller tests, component interaction
states in Storybook, server-backed renderer flows in browser acceptance, and
Electron-specific behavior in packaged WebdriverIO acceptance. Avoid duplicating
a browser flow in Electron unless it checks an additional native boundary.

### Browser app: Vitest and Playwright

Extend [browser.test.mjs](../apps/desktop/test/e2e/browser.test.mjs), which is
discovered by the `web` project in
[vitest.config.ts](../apps/desktop/vitest.config.ts). Reuse its connection,
session, prompt, and transcript helpers and its disposable profile, Git project,
pinned server, TLS proxy, and scripted provider. The suite builds and launches
the browser app itself; do not start `verify:browser` or a personal server first.
If a new test file is justified, update the project's explicit include and give
its fixtures an owner rather than copying the entire setup into another file.

Use Playwright role/label locators and observable state waits. Follow the suite's
`expect.poll` pattern for eventual results. Drive the behavior under test through
the UI; use API or filesystem reads to establish resulting server state where
relevant. Do not bypass the action under test by calling its implementation.

Run the integration tier from the root when a local full run is useful. This
command builds the session-tools plugin needed by the disposable server first:

```sh
pnpm test:integration
```

For one scenario, build the plugin with
`pnpm --filter @oc-ui/opencode-session-tools build`, then run
`pnpm --filter desktop exec vp test run --project=web -t '<scenario>'`.
The full tier runs in CI. Preserve the existing failure screenshot and profile
handling; inspect those artifacts before reproducing a failure manually.

### Packaged Electron: WebdriverIO

Extend [packaged-startup.e2e.ts](../apps/desktop/test/e2e/packaged-startup.e2e.ts)
or its existing `connection-flows.ts`, `provider-flows.ts`, and `project-flows.ts`
helpers. Use [wdio.conf.ts](../apps/desktop/wdio.conf.ts) and the existing
[packaged runner](../apps/desktop/test/e2e/run-packaged.mjs). The runner supplies
the app binary, isolated settings, provider, artifact paths, and process cleanup.
Do not invoke the raw WDIO command without that environment. New specs must be
wired into the runner's explicit phase selection; a filename alone is insufficient.

Use WDIO element actions, `waitForDisplayed`, `waitForClickable`, and `waitUntil`
for observable results. Use `browser.electron.execute` only for native setup or
evidence that DOM interaction cannot provide, such as owned process state. Keep
native substitutes explicit: mocked native dialogs and keychain behavior cannot
prove the appearance of a native dialog or real OS credential integration.

From the root, run `pnpm test:acceptance:mac` for the packaged scripted-provider
suite. It is separate from `pnpm test`. The `test:acceptance:chat:mac` command uses
a live provider and credentials; it is not the default regression command.

### Make each scenario useful

Name the trigger and expected outcome. Arrange only the required disposable state,
perform the action, and assert its visible result and relevant persisted/resource
state. Cover failure, recovery, cancellation, or reopening when the requirement
depends on them. Prefer condition-based waits over sleeps, and fix flakes instead
of adding retries that hide them. Respect existing suite ordering; make new
scenarios independent where possible and explicit about any shared setup.

For a regression, establish that the assertion detects the original failure when
practical, then verify the fix. Confirm the runner actually discovered and ran the
scenario; a filtered run with no tests is not evidence. Reuse fixture cleanup and
bounded failure artifacts. Run focused tests during edits, then the required root
gates and rely on the applicable CI tiers on the completed candidate. Browser-use is
useful to investigate a failure, but the reusable test must pass after the fix.

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

Cover repeatable interactions with assertions in stories or acceptance tests.
Keep the existing Storybook accessibility failure gate enabled. Use stories for
the detailed state matrix and automated full-app tests for renderer workflows.
After the final change, inspect only visual or usability questions that remain
unresolved by those tests. Use packaged WebdriverIO acceptance for affected native,
preload, settings, built-in server ownership, or packaging behavior; add targeted
native inspection where test substitutes or host-dependent appearance leave gaps.

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

- CI runs `pnpm build`, `pnpm build:web`, and `pnpm build-storybook` on every PR
  and push to `main`. Run an affected build locally when debugging bundling,
  entrypoints, dependency resolution, or delivered assets.
  `pnpm ready:ci` combines root checks, tiers 0–2, and these builds for an opt-in
  full local run; `pnpm ready` stays fast.
- Use tier 3 CI evidence for native integration rows above, dispatching the workflow
  on the candidate branch when needed before merge. Before delivering a macOS app,
  run `pnpm test:acceptance:mac` on the delivery candidate. It checks the packaged signature and architecture as
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
Use automated full-browser acceptance by default for renderer workflows, Storybook
for detailed component states, and packaged WebdriverIO for native and host
boundaries. Add exploratory or visual inspection as described above.

Browser acceptance uses a disposable HTTPS certificate trusted only by the test
context. Production code retains ordinary browser certificate validation. Check
a real deployment's TLS, authorization preflights, allowed UI origin, and streamed
responses separately when deploying. The initial verified browser is Chromium.

## Report the result

Keep the completion report short and specific:

- What changed and which behavior was checked.
- Which local root gates passed, which CI tiers passed, and which tiers are pending
  or failed. Include a workflow link and commit when CI evidence is available.
- The tested checkout/artifact and any relevant screenshots or logs.
- What used controlled data, a real server, or a native substitute; any remaining
  failures or unverified behavior. Report app, renderer, and server status separately
  when leaving them running.
- For features and refactors, production lines added, removed, and net change;
  count tests, documentation, and generated code separately. Name new abstractions
  and old machinery removed.

Do not describe a build as a runtime test, an automated story as visual approval,
or a scripted provider run as proof of compatibility with a live model service.
