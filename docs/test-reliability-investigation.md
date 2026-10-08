# Test reliability investigation

Investigation date: 2026-10-08. Checkout: `origin/main` at
`7f3538dc2dfddb26c7da3d1f992662472a714052`.

## Scope and method

This investigation reviews recent repository-linked OpenCode sessions, retained
verification logs, GitHub Actions results, current tests, application behavior,
and pinned upstream implementations. Proposed fixes are recommendations; no
application or test implementation is changed by this report.

The investigation runs in session `ses_ee7cfae28ffeE5rA6vIhfUnPL2`, in a separate
worktree from the original CI/storage conversation. Three child sessions cover
independent evidence areas:

- Session history and failure inventory: `ses_ee7cef096ffeRIh8hw4Gh8t3WJ`.
- Browser workflows and Storybook focus: `ses_ee7cef08effeCMPbpGl7kSp5ds`.
- Highlighter and packaged/native failures: `ses_ee7cef082ffeh1IVEI60Su5dUA`.

Repository guidance and `docs/app-verification.md` were read before inspection.
`git fetch origin main` confirmed the starting revision. Dependencies were
installed with the existing lockfile under Node `24.20.0`, after verifying
`node --version`; the shell's default Node `26.9.0` was not used for installation
or test commands. No Effect implementation code was written.

Since the failing `07b6aab` run, main changes only the dependency-review job;
`git diff 07b6aab..7f3538d` contains no application, test, or dependency changes.

## Dependency baseline

Installed versions, checked from package manifests after
`pnpm install --frozen-lockfile`:

| Boundary                          | Version           |
| --------------------------------- | ----------------- |
| Node / pnpm                       | 24.20.0 / 11.23.0 |
| OpenCode client, server, UI       | 2.0.3             |
| Effect, atom-solid, Effect Vitest | 4.0.0-rc.112      |
| Solid / Kobalte                   | 1.9.15 / 0.13.13  |
| Shiki                             | 4.2.0             |
| Vite+ / Vitest browser provider   | 0.3.0 / 4.1.11    |
| Playwright                        | 1.62.1            |
| Storybook / Vitest addon          | 10.5.10 / 10.5.10 |
| Storybook Solid/Vite integration  | 10.7.1            |
| WDIO CLI / Electron service       | 9.30.1 / 10.2.0   |
| Electron / electron-builder       | 42.3.3 / 26.15.3  |
| JSDOM                             | 30.0.1            |

`pnpm exec vp toolchain` additionally confirms bundled Vite `8.2.2`, Rolldown
`1.2.5`, and Vitest `4.1.11`. The installed browser provider and test runner
versions agree; this inspection found no version mismatch explaining the flakes.

The local OpenCode CLI reports `1.18.32`; it is distinct from oc-ui's pinned
OpenCode packages. Session inspection must use the local service's actual
authenticated API contract, rather than assuming the CLI version is the SDK
version.

## Actual session history and run inventory

**Session history was accessible through authenticated V2 discovery.** The tool
catalog exposes no history-read tool, and the default V1 CLI rejects `api`.
The running desktop's V2 entrypoint,
`/Users/alex/Library/Application Support/ai.opencode.desktop/cli/2.0.24/opencode-cli`,
reports `opencode v2.0.24`. Its `api get /openapi.json` supplied the actual service
contract. Project-filtered session/message reads then inspected a bounded sample
of **12 oc-ui root sessions / 568 messages**, selected from 40 metadata records.
No unauthenticated HTTP calls or database inspection were used.

| Actual repository-linked session                                          | Failure evidence and its strength                                                                                                                                                                                               |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ses_ee893649fffeJkJYZ6KuQ5VDax` — CI/storage, `glowing-cabin`            | User request at Oct 7 21:04:28 UTC explicitly asks for a new session, recent test-failure review, and subagents. Historical assistant reports are corroborated by retained CI/highlighter logs and the 1,734-test macOS result. |
| `ses_ee8aa5377ffdHNXGQ9uH9Apmsm` — browser address, `glowing-tiger`       | Actual user reports a build failure; historical assistant describes steering text in transcript and held-response cleanup. PR #2 CI independently repeats queue/annotation failures on macOS.                                   |
| `ses_f011e943cffe6wZDpTvJGC7m2O` — composer width, `swift-canyon`         | Retained tool result verifies 5 failures / 1,575 passes: Worker Pool, WarmPaper Interactive Review, browser-inspection SIGINT startup, tokenizer equality, ChangesRegion reparsing.                                             |
| `ses_f2c158dcbffePKqXFiG0TCFxYL` — Storybook hostnames, repository root   | Retained tool inventory verifies 33 App/browser-host/appearance failures. The unavailable-localStorage explanation is historical assistant reporting, not newly verified causality.                                             |
| `ses_f355c8141fferHzr97zUvU6MsP` — browser RPC, `curious-panda`           | Historical assistant identifies NewSessionFlow failed-session/project recovery timeout and isolated/subsequent passes; the named original failure log was not found in the bounded sample.                                      |
| `ses_f34a901f6ffez6N67dsl1QMWtL` — large-diff comment lag, `lucky-engine` | Retained tool result verifies 1 failure / 1,289 passes; the same NewSessionFlow timeout name is historical assistant reporting. Its report explicitly warns that a rerun does not prove resolution.                             |

The broader sample included passing reports and product-error discussions;
neither was classified as a test-failure session merely for mentioning errors.
Exact message IDs, times, and bounded excerpts are retained in
`hidden-falcon-session-ci-evidence.md`, `hidden-falcon-session-evidence.json`, and
`hidden-falcon-history-tool-evidence.json` in the evidence directory.

| GitHub Actions evidence                                                                                   | Commit                 | Verified outcome                                                                                   |
| --------------------------------------------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------- |
| [37672185194](https://github.com/oleksandr-oksenenko/oc-ui/actions/runs/37672185194)                      | `0947d2b`              | Both platforms passed after initial CI corrections.                                                |
| [37676322838](https://github.com/oleksandr-oksenenko/oc-ui/actions/runs/37676322838)                      | `06689d0`              | Both platforms passed.                                                                             |
| [37677404440 attempt 1](https://github.com/oleksandr-oksenenko/oc-ui/actions/runs/37677404440/attempts/1) | `af4a9d5`              | macOS packaged annotation thumbnail missing; Linux passed. Same-commit macOS rerun passed.         |
| [37682230623](https://github.com/oleksandr-oksenenko/oc-ui/actions/runs/37682230623)                      | `85f4ef5`              | Linux Review Comments failed; macOS passed.                                                        |
| [37682350634](https://github.com/oleksandr-oksenenko/oc-ui/actions/runs/37682350634)                      | `07b6aab`              | Linux queue, annotation completion, and Review Comments failed; macOS passed.                      |
| [37683723304](https://github.com/oleksandr-oksenenko/oc-ui/actions/runs/37683723304)                      | `ce45402`, PR #2       | macOS queue and annotation failures repeated; Linux passed. These failures are not Linux-only.     |
| [37685672205](https://github.com/oleksandr-oksenenko/oc-ui/actions/runs/37685672205)                      | Current main `7f3538d` | Linux passed; macOS still in progress in both captured snapshots. Whole-run success is unverified. |

The two key retained logs (`glowing-cabin-main-no-storage-failure.log` and
`glowing-cabin-no-storage-failure.log`) are byte-identical to freshly downloaded
GitHub attempt logs. This verifies their provenance rather than trusting the
historical assistant summaries alone.

**Correction to the handoff label:** `85f4ef5` is the transcript-width CSS change
(PR #4), not the browser-address draft change. The latter is open PR #2.

**Access limits:** one sampled radius-review history page returned incomplete JSON,
so deeper history there remains unverified. Two historical full local logs
(`composer-test.log` and `storybook-host-checks.PPzmOu/test.log`) are missing;
retained tool output supports their failure inventories but not a fresh root-cause
analysis. GitHub withheld latest-main full job logs while the overall run remained
in progress; the Linux pass is established from job/step metadata. The 1,734-test
serial log contains package cache hits and a full desktop pass, not evidence that
every workspace test was uncached.

## Existing portability fixes

The following corrections already exist on main in `06689d0` and should be
preserved:

- `apps/desktop/test/e2e/profile.mjs:21-22` selects `/bin/bash` and `C.UTF-8` on
  Linux, and `/bin/zsh` and `en_US.UTF-8` on macOS.
- `apps/desktop/test/e2e/opencode-server.test.mjs:106` and
  `apps/desktop/test/browser-shutdown.test.mjs:27` prepare a disposable Git
  project before server/location operations.
- `apps/desktop/stories/TranscriptView.stories.tsx:58-64` constrains the narrow
  transcript fixture with `grid-template-rows: minmax(0, 1fr)`.
- `.github/workflows/ci.yml:55,62,64` bypasses Vite+ task caching for CI task
  execution. Dependency caching is also explicitly disabled.
- `.github/workflows/ci.yml:70` sets `CSC_FOR_PULL_REQUEST=true`, preserving the
  packaged app's PR ad-hoc signature.

The emulated Linux esbuild `spawn EINVAL` and transfer-created AppleDouble `._`
files are environment findings, not demonstrated application regressions. The
specific cache-instrumentation explanation is historical diagnosis supported by
an uncached pass, not a mechanism reproduced in this investigation. The initial
Chromium installation stall similarly concerns provisioning; a fresh-runner pass
does not diagnose a renderer failure.

## Evidence retention

Original full logs remain under
`/private/var/folders/0m/8pbhxmdx1c73_s21w3n7pcr40000gq/T/opencode/`, with prefix
`glowing-cabin-`. The installation log for this investigation is
`hidden-falcon-install.log` in the same directory.

CI intentionally does not upload artifacts or cache dependencies
(`07b6aab`; `README.md:118-124`). Existing runners preserve browser/native failure
diagnostics locally, but those files disappear with a disposable GitHub runner.
Consequently, a historical job log can establish a failed assertion without
establishing the exact DOM, inbox transition, or focus target at failure. Future
diagnostics should emit bounded, sanitized state checkpoints to job output under
the current storage policy. Do not dump credentials, profiles, prompts from real
sessions, or complete API responses.

## Classification rules

- **App defect:** an incorrect state or lost resource is established independently
  of a narrow observation window. A passing retry does not clear it.
- **Test/fixture race:** the test requires an incidental ordering or temporary
  state that the app contract does not promise. Replace the incidental condition
  with controlled ordering and retain assertions about the promised result.
- **Resource-sensitive integration check:** an actual worker/server must start or
  finish inside its production budget. Distinguish deadline/fallback behavior
  from an assertion that only checks successful cold startup.
- **Platform/environment failure:** provisioning, signing, transfer, or emulation
  fails before the relevant application behavior is exercised.

Confidence in a source-level mechanism is separate from confidence that it caused
a particular historical failure. Historical passes, rerun passes, and isolated
passes are corroboration, not proof that the full suite is reliable.

## Findings and proposed fixes

### P0: An older SDK inbox snapshot overwrites newer events

**Classification:** reproduced application/SDK cache defect. **Confidence:** high
in the mechanism; medium-high that it caused the historical queue failure.

The queue scenario in `apps/desktop/test/e2e/browser.test.mjs:1116-1132` steers a
pending message, observes the changed delivery through a separate API client,
then admits Direct steering task. The API observation does not establish that
the renderer's post-steer inbox refresh has settled.

`createSessionInbox.ts:51-65` owns mutation settlement followed by refresh. Its
gate serializes inbox actions, but composer admission remains possible during
that read. This is a legitimate application interaction.

The installed SDK's `@opencode/client/dist/solid/data.js` contains the gap:

- `630-637`: an enqueue event removes the ID from `outbox` and admits its durable
  pending/message row.
- `1241-1257`: pending synchronization replaces the collection with its fetched
  snapshot, preserving only rows still in `outbox`.
- `1378-1394`: optimistic prompt admission populates pending and transcript state.

Thus a read started before admission can commit after its acknowledgement and
erase the pending row. `ConversationRegion.tsx:62-65` hides transcript entries
using pending IDs; the lost row becomes visible in the transcript even though
the server has not delivered it. The historical failure log shows Direct steering
task in the transcript while the other queued messages remain pending
(`glowing-cabin-main-no-storage-failure.log:634-650`).

**Focused reproduction performed on this checkout:** a temporary unit probe used
the real SDK `createData`, a deferred inbox response, and controlled server
events. All pre-response assertions passed. Resolving the older response then
failed all three intended contracts in 12 ms of test execution:

| Controlled interleaving                                            | Observed result                                    |
| ------------------------------------------------------------------ | -------------------------------------------------- |
| Begin empty read; enqueue acknowledged item; resolve empty read    | Pending becomes empty; transcript retains the item |
| Begin read containing item; cancel item; resolve old read          | Cancelled item is resurrected                      |
| Begin queued-item read; change delivery to steer; resolve old read | Delivery reverts to queue                          |

Bounded probe output: `enqueue probe {"pending":[],"transcript":["msg_investigation"]}`.
Command exit was **1**, with **3 failed contract assertions**, not harness or
startup failures. Full evidence and the standalone probe source are retained as
`hidden-falcon-sdk-inbox-probe.log` and
`hidden-falcon-sdk-inbox-probe.test.mjs` in the temporary evidence directory. The
temporary test was removed from the worktree after preserving it.

The executed command, with the probe temporarily placed in the existing unit
project's `test/` include, was:

```sh
pnpm --filter desktop exec vp test run --project=unit test/sdk-inbox-race-investigation.test.mjs
```

**Minimal fix:** reconcile events observed during an in-flight snapshot at the
SDK-owned cache boundary, including enqueue, cancellation, delivery, and delivery
changes. Prefer an upstream correction with a pinned upgrade or dependency patch
after verifying parity. Keep SDK state ownership; an oc-ui mirror or extra
coordinator would duplicate the very cache behavior needing correction. Waiting
for inbox controls to become enabled can clarify test sequencing, but would hide
this real concurrency defect if used as the sole correction.

**Regression checks:** promote the three controlled probe cases into a permanent
SDK-boundary test after choosing the dependency fix. Add delivered-item
non-resurrection, invalidation/replacement reads, disconnection, and owner disposal
where they affect reconciliation. Preserve the browser scenario's reload,
cancellation, skill payload, transcript exclusion, and provider-order assertions.

### P0: Queue fixture leaks its held turn into later scenarios

**Classification:** test lifetime/partial-failure recovery defect.
**Confidence:** very high.

`browser.test.mjs:1133` releases the provider hold only after the failed pending
wait. The shared sequential page/server/provider remains alive; failure handling
at `211-218` records diagnostics without settling scenario-owned work.
`scripted-provider.mjs:20-27,112-115` retains the hold until release or connection
closure.

The later annotation/review scenario fails at its first alternate-model send
(`browser.test.mjs:1226`), before annotation/review actions execute. The log still
shows the held queue turn and the alternate prompt pending
(`glowing-cabin-main-no-storage-failure.log:706-730`). Completion count staying at
five is a downstream consequence, not evidence of an annotation submission bug.

**Minimal fix:** make the queue scenario own unconditional cleanup of its specific
hold, and settle or explicitly abort/drain its session on every exit before
continuing shared-state scenarios. Keep the existing completion, provider, and
persisted-message assertions. Cleanup must itself be bounded and awaited, with
both the original failure and any cleanup failure visible.

**Regression check:** force a failure before normal release in a small fixture
lifecycle test. Assert the owned hold settles, its session work drains or aborts,
and a later independent prompt completes. Do not require a full-app deliberately
failing test to establish fixture cleanup.

### P1: Review Comments queries before Pierre's render frame

**Classification:** Storybook observation race. **Confidence:** very high.

`apps/desktop/stories/ContextPanel.stories.tsx:566-571` sends Escape, then
immediately calls `getByRole`. The earlier equivalent transition correctly awaits
`findByRole` at `547-550`. Controlled editing state changes immediately, but
`DiffCodeView.tsx:190-205,298-302,328` publishes updates through Pierre's
`CodeView.setItems`, which schedules rendering via `requestAnimationFrame`.
The failing log still contains the textarea (`main-no-storage-failure.log:1044-1047`).

**Minimal fix:** await `findByRole` with the same multiline accessible-name
matcher before asserting visibility. Retain comment height, growth, text, and
focus assertions. The existing Review Comments story is the focused regression;
a controlled-frame test is useful only if render ordering remains an uncovered
contract.

**Related test defect:** the gutter readiness helper at
`ContextPanel.stories.tsx:404-414` returns `false` from `waitFor`. A nonthrowing
callback is considered successful, so the helper does not establish stability.
Make the callback assert/throw until its existing condition holds. This is not
the direct cause of the Review Comments failure.

### P1: Synthetic worker response can precede request readiness

**Classification:** unit-test synchronization race. **Confidence:** high in the
mechanism; medium-high attribution to the intermittent timeout.

`apps/desktop/src/renderer/syntax-highlight.test.ts:169-171` waits for a second
worker's construction, then dispatches its response. Construction occurs before
production installs message listeners and posts the request
(`syntax-highlight.ts:41-61`). A response in that gap is lost; the production
request times out after ten seconds, but the test ends after five.

`glowing-cabin-final-gates.log:399-408,969-978` records the `messageerror` case
timing out around 5,029 ms, while adjacent cases pass. The concurrency case at
`syntax-highlight.test.ts:123-124` has the same construction/readiness assumption.

**Minimal fix:** wait for the replacement worker's posted request before emitting
its response, as existing cases already do. Wait for both posted requests in the
concurrency case. Preserve termination, failed settlement, and replacement success
assertions. Add valid error-response and synchronous `postMessage` failure cases
to the existing focused table; these are real missing boundary paths.

### P1: Tokenizer equality assumes unlimited cold tokenization

**Classification:** assertion conflicts with upstream time-budget semantics.
**Confidence:** high.

`apps/desktop/src/renderer/syntax-tokenizer.test.ts:34-40` requires cold and warm
token arrays to be deeply equal. The tokenizer has no result cache, and
`syntax-tokenizer.ts:25-28` leaves Shiki's default **500 ms per-line tokenization
limit** enabled. Installed `@shikijs/primitive/dist/index.mjs:618-620,654-667` and
`@shikijs/vscode-textmate/dist/index.js:1812-1817` show time-limited tokenization.

`glowing-cabin-linux-uncached-verification.log:3405-3467` shows one cold token for
the entire line versus eight warm lexical tokens; both preserve the trailing
empty lines. This matches an exhausted cold tokenization budget under contention.

**Minimal fix:** assert exact source reconstruction independently for both
results, valid supported-theme color output, and one highlighter creation. Replace
partition equality with those actual contracts. Result-cache reuse is already
asserted at `syntax-highlight.test.ts:43-46`, its proper owner. Do not disable the
production time limit to satisfy a test.

**Product nuance:** `syntax-highlight.ts:83` caches successful results, including
potentially time-budget-degraded coloring. Source fidelity is preserved, but a
successful result need not mean complete lexical coloring. Treat any requirement
to retry degraded coloring as a separate product decision, not an inferred bug.

### P2: Real-token component and cold-worker story exercise different budgets

**Classification:** resource-sensitive integration assertions, with missing
fallback coverage. **Confidence:** high in the distinct contracts; medium-high
that contention explains the historical cold-worker failure.

- `TranscriptCodeBlock.test.tsx:66,84,89,94-98` mounts with the real tokenizer and
  default `vi.waitFor` budgets. This initializes Shiki/WASM in JSDOM, not the
  production worker pool. The first-token wait fails under full-suite load, while
  focused and serial runs pass (`macos-verification.log:798-814`,
  `shiki-focused.log:5-10`, `macos-serial-test.log:342`).
- `TranscriptCodeBlock.stories.tsx:58-60` demands styled spans within ten seconds.
  Production begins its ten-second request timeout after borrowing a worker
  (`syntax-highlight.ts:71-78`); the story's timer begins at a different boundary.
  `final-gates.log:90-93,955-961` records `SyntaxHighlightError` and a 10,068 ms
  failed story. Another run takes 9,183 ms; serial macOS takes 3,561 ms.
- Production's renderer adapter catches this typed failure and returns undefined
  (`connection.ts:355-365`); the component preserves safely escaped plain source
  (`TranscriptCodeBlock.tsx:15-37`). Once the request times out, a longer DOM wait
  cannot make that failed request produce tokens.

**Minimal fixes:** initialize the real tokenizer before mounting when the unit
test's contract is safe real-token rendering; give that explicit initialization a
bounded integration budget. Retain one real cold-worker success story. Allow
observation headroom after the production request deadline for render scheduling,
while keeping actual request timeout failures visible. Add deterministic
timeout/error fallback and subsequent code/theme recovery coverage, including
obsolete response suppression, exact source, escaping, copying, and preserved
`pre` identity. Do not silently warm the cold-worker story.

An explicit, measured cap on heavy test concurrency is reasonable: four Vitest
projects currently have no explicit worker/file-parallelism policy, with inlined
dependencies (`apps/desktop/vitest.config.ts:14-79`). Evaluate one-worker versus
small bounded parallelism on native Linux/macOS; choose from cold-start and total
suite timing. This complements the concrete races above and does not explain the
already-single-instance packaged failure.

### P2: GlobalForms focus restoration is tied to a timer, not teardown

**Classification:** unresolved application/focus-lifecycle race.
**Confidence:** medium.

`glowing-cabin-linux-complete.log:899-935` shows Default/Narrow expecting launcher
focus but receiving body. Their existing condition-based waits rule out the same
immediate-query mistake as Review Comments.

`GlobalFormsRegion.tsx:79-82` restores from a close-start callback.
`restoreDialogFocusAfterClose.ts:18-22` waits a fixed **110 ms**. The upstream
`@opencode/ui/src/context/dialog.tsx:48-62` calls that callback before closing and
before its own **100 ms** disposal timer. Kobalte adds deferred focus-scope cleanup
and close autofocus. A ten-millisecond nominal margin does not establish teardown
completion; helper unit tests do not exercise the actual provider/focus-scope
ordering.

**Next step:** record launcher connectivity, active element, close callback,
provider-layer removal, and subsequent focus events in only Default/Narrow.
If confirmed, replace timer restoration with Kobalte's `onCloseAutoFocus`
lifecycle through the upstream Dialog wrapper (currently not exposed). Preserve
opener/fallback selection, disposed-owner guards, and suppression when another
dialog has opened. Do not lengthen the timer as the repair.

**Regression checks:** Escape and Keep pending restore after actual teardown;
removed opener selects the existing sidebar fallback; disposed owner does no
lookup; immediate reopen/replacement cannot steal focus from the new dialog.

### P2: Packaged annotation preview failed before image decoding

**Classification:** unresolved popover/open-state/remount interaction.
**Confidence:** high about the failed stage; medium about the mechanism.

`apps/desktop/test/e2e/browser-flows.ts:233-236` clicks the sent Browser attachment
pill and waits for a thumbnail `img` to exist.
`glowing-cabin-no-storage-failure.log:601-608,631-641` records a 60-second missing
element and seven passing packaged scenarios. The rerun passed.

Earlier in the same flow, capture bytes and PNG signature, draft modal decoding,
and provider receipt already passed (`browser-flows.ts:94-106,199-227`). The
failed wait precedes `complete/naturalWidth` checking at `237-246`. Slow decoding
alone cannot explain an absent element: `ImagePreview.tsx:59-64` renders its
thumbnail immediately.

The Browser grouping requires valid metadata and image files
(`UserMessage.tsx:38-48`). Its popover owns uncontrolled open state
(`AttachmentPills.tsx:95-120`); closing removes content. Transcript identity follows
SDK message-object identity (`TranscriptView.tsx:421-423,534-539`), and durable
materialization replaces a message row (`data.js:250-260`). Deferred autofocus,
outside-focus dismissal, and async native-view hiding add credible interleavings.
The retained log cannot distinguish click failure, focus dismissal, message
remount, or attachment data loss.

**Next step:** target the specific acknowledged message ID; establish the required
turn/admission state, click once, and assert `aria-expanded` plus matching popover
content before image readiness. On failure, log bounded trigger connectivity,
`aria-controls`, popover count/text, active element, native-page visibility, and
matching server metadata/file MIME/byte-presence booleans. Avoid repeated toggle
clicks and global retries.

**Regression check:** update the same acknowledged message while its Browser
popover is open in the existing attachment stories. Assert readable content,
enlargement, Escape restoration, outside dismissal, and reopen. If the update
closes the popover, correct identity/open-state continuity at the rendering
boundary without mirroring SDK state.

The failure interrupted later session-switch, tab-close, and reload/native-view
checks (`browser-flows.ts:251-278`). Subsequent worker/terminal quit tests do not
replace those assertions; the passing rerun supplies historical evidence only.
Worker/process ownership already has scoped settlement and bounded cleanup;
there is no evidence requiring a replacement lifecycle coordinator.

## Coordinate with existing work

**Implementation update:** PR #2 has now been merged. The implementation work
starts from refreshed `origin/main` at `41b208b`. Its Review Comments settlement
and queue hold cleanup are already present and will be reused. The paragraphs
below record the earlier investigation snapshot; PR #2 is no longer open.

At the initial snapshot, [PR #2](https://github.com/oleksandr-oksenenko/oc-ui/pull/2), inspected at
`4b04f5a6b664ec5ef5c5d9ac2229c5ff70fa7596`, already proposes overlapping changes:

- `df76deb3` awaits UI settlement, including Review Comments' `findByRole`.
- `4b04f5a6` adds `finally` hold release plus idle waiting and waits for the direct
  prompt's HTTP admission rather than requiring its Pending messages row.

These commits are not ancestors of main `7f3538d`. The selected diff was inspected;
their combined behavior and latest CI result were not validated here. Reuse the
settlement and cleanup work rather than create competing edits.

**Important distinction:** HTTP admission is useful server evidence, but replacing
the pending assertion alone would miss the reproduced SDK defect. While the
provider hold prevents delivery, an acknowledged pending input must remain
pending and excluded from the transcript. Keep that renderer contract in the
controlled regression and affected browser coverage when reconciling PR #2.
Its cold-worker timeout change also overlaps a correction already on main, so
reconcile against the current target before integration.

Older WarmPaper/ChangesRegion/NewSessionFlow/startup and localStorage observations
are genuine historical leads with varying evidence strength. Current causal
attribution is insufficient for blanket changes to those tests. Reinspect a
retained/current failure at its read/render/resource boundary before extending
this repair set; preserve the already-fixed disposable Git project startup
contract.

## Prioritized verification plan

One execution owner should supervise the following on a completed repair
candidate, always under Node `24.20.0`, preserving full logs and bounded failure
excerpts:

1. **SDK contract first:** run controlled old-snapshot/new-event regressions, plus
   delivered-item non-resurrection. Establish they fail before the cache correction
   and pass after it. The three cases actually probed here already establish the
   pre-fix failure. Exercise the real pinned SDK, not a reimplemented fake cache.
2. **Fixture cleanup and inexpensive synchronization:** verify forced early exit
   settles its hold/session; run worker-error/replacement tests and Review Comments.
   Retain all semantic assertions and confirm test discovery. Suggested existing
   focused commands from the root:

   ```sh
   pnpm --filter desktop exec vp test run --project=unit src/renderer/syntax-highlight.test.ts src/renderer/syntax-tokenizer.test.ts
   pnpm --filter desktop exec vp test run --project=storybook stories/ContextPanel.stories.tsx -t "Review Comments"
   ```

3. **Resolve the two lifecycle unknowns:** instrument only GlobalForms Default/Narrow
   and the packaged attachment-opening boundary. Use observed teardown/open-state
   ordering to select a repair, then add the targeted lifecycle regressions above.
   The focused story command is:

   ```sh
   pnpm --filter desktop exec vp test run --project=storybook stories/global-forms/GlobalFormsRegion.stories.tsx -t "Default|Narrow"
   ```

4. **Real integration:** run the affected browser suite against its pinned server
   and scripted provider. Its scenarios currently share earlier setup; selecting
   only the queue title is not a self-contained reproduction. Either preserve the
   existing complete `web` project or isolate prerequisites within its existing
   fixtures. Run the cold-worker story without warmup and deterministic fallback
   cases; measure bounded heavy-project concurrency on native Linux/macOS.

   ```sh
   pnpm --filter desktop exec vp test run --project=web
   pnpm --filter desktop exec vp test run --project=storybook stories/TranscriptCodeBlock.stories.tsx
   ```

5. **Completion gates:** run root `pnpm check` and `pnpm test` on the combined
   candidate; run `pnpm test:acceptance:mac` for attachment/native lifecycle changes.
   Use native Linux CI and macOS CI for full-suite evidence. A targeted pass or an
   emulated runner alone does not establish the complete cross-platform result.
   Do not manually replay passing automated flows unless a visual/native question
   remains unanswered.

No blanket retries, arbitrary sleeps, or weakened pending/focus/source-fidelity
assertions are proposed. Any observation budget adjustment is tied to the actual
initialization or render boundary and must not hide production timeout failure.

## Verification performed and remaining gaps

- Confirmed fetched main, clean starting worktree, exact pinned Node, frozen-lockfile
  installation, installed dependency versions, and Vite+ toolchain relationships.
- Inspected actual authenticated repository-linked session history, retained tool
  output, current source/upstream implementations, GitHub metadata, downloaded
  failure logs, and selected open-PR changes.
- Ran one temporary three-case SDK probe on this checkout: **3 expected contract
  failures**, proving the cache race. Full log/source retained; temporary test
  removed. No broad or repeated suite run was used to infer robustness.
- Root `pnpm check` / `pnpm test`, browser/Storybook suites, and packaged acceptance
  were **not run on a repair candidate**: this deliverable changes documentation
  only and proposes fixes. Historical passing evidence is labeled historical.
- GlobalForms teardown and packaged popover failure mechanisms remain unresolved;
  neither was manually reproduced or proven fixed. Failed CI DOM/native artifacts
  are unavailable under the current intentional no-upload policy.
- Original artifact directories were checked selectively; they contain browser
  and packaged snapshots, but no retained snapshot identifying these specific
  historical failure states. Original full logs were preserved.

**Change accounting:** production +0/-0/net 0; retained tests +0/-0/net 0; generated
code +0/-0/net 0. One documentation report is added. No application abstraction
or existing lifecycle machinery is added, replaced, or removed. The temporary
probe/extraction artifacts are investigation evidence outside the repository.

## Implementation follow-up

The user requested design, oracle review, implementation, and an independent
subagent review after merging PR #2. Implementation therefore starts at
`41b208b`, preserving its already-merged settlement and cleanup changes.

Oracle reviewed the initial design and the subsequently reproduced transcript
remount mechanism. The repair ownership is:

- **Pinned SDK patch:** only in-flight pending-read tokens live in the SDK cache
  owner. Inbox events, including committed revert, dirty a snapshot; it is
  discarded and reread before any acknowledgement or store publication.
  Invalidation, eviction, deletion, disconnect, and disposal retire the token and
  abort the GET. Retired active/queued reads settle without publication or
  automatic rehydration. Genuine read failures propagate; existing event state
  and optimistic outbox reconciliation remain authoritative. No oc-ui state
  mirror is introduced. Sustained continuous inbox traffic can delay completion;
  the implemented policy owns finite-burst refresh through stable settlement.
- **Dialog patch and launcher region:** native close autofocus is forwarded
  through the UI wrapper. The live launcher owner and opening identity decide
  restoration; GlobalForms no longer uses a fixed delay. Pushing during the
  closing interval finishes the pending close before mounting its replacement.
  Other timer-helper callers have different lifetimes and retain their existing
  behavior.
- **Transcript DOM owner:** a new actual-TranscriptView story confirmed that a
  same-ID durable message replacement remounts the attachment trigger and closes
  its popover. The failure occurs after updated content renders, at the intended
  identity assertion (`hidden-falcon-attachment-reproduction.log`). Stable row
  identity and reactive message access preserve the open attachment; standalone
  work-detail fallback retains its previous replacement semantics. This confirms
  a real mechanism without proving it caused the historical packaged failure.
- **Test owners:** highlighter responses follow posted-request readiness;
  tokenizer checks preserve source/theme/reuse contracts; real-token rendering
  preinitializes its own tokenizer, while the real-worker story stays cold.
  Controlled fallback/recovery and obsolete-result cases complement success.
  Packaged attachment verification scopes its one click to the durable message,
  checks matching open content before image decoding, and reports bounded state.

The queue browser scenario retains HTTP admission evidence and restores its
pending/transcript-exclusion assertions before releasing the hold. If scenario
and cleanup both fail, both causes remain visible. No global retry or test-worker
cap is added.

Independent review found one further ordering gap: a live sync could coalesce
into an already retired queued loader and resolve without fetching. Two new
real-SDK cases reproduced it for explicit invalidation and reconnect (both
failed with one GET instead of two). Pending-read retirement now invalidates
queued entries as well as started entries, without changing other resources'
invalidation behavior. The 22-case inbox boundary suite passes after that repair.
Review follow-up also adds positive initial-suffix/full-transcript assertions,
workspace snapshot provenance checks, retirement abort assertions, late-result
checks after code-block disposal, and a forced early browser-scenario failure
using the same held-response cleanup owner as the queue scenario.

The implementation adds in-flight read ownership tokens, one pending-close
finalizer, native focus callback forwarding, reactive stable transcript rows,
and a derived owner-tagged SDK transcript snapshot. It removes stale snapshot
publication, GlobalForms' timer-based focus restoration, SDK-object row keys,
construction-only worker readiness, cold/warm token-partition equality, and the
false-returning gutter wait. Other SDK/application state remains SDK-owned.

Production growth is concentrated in these lifecycle guards and reactive
rendering, with no new application service, queue, state mirror, or runtime.
Test growth covers actual boundary interleavings and real-provider/TranscriptView
fixtures. The two version-pinned dependency patches can disappear when a pinned
upstream release contains equivalent fixes and the retained boundary regressions
verify parity; the current repair does not assume that release exists.

### Combined-candidate verification before the final oracle review

All verification used Node `24.20.0`. The independent reviewer rechecked the
corrected patch and coverage and reported no remaining actionable P1/P2 findings.

- `pnpm check`: passed, including formatting, lint/type checks, WDIO types,
  style tokens, component layout, and unused-code checks.
- `pnpm test`: passed, with 53 prompt-editor tests, 14 session-tool tests, and
  1,716 desktop tests across 157 files (1,783 total). This includes all unit,
  Storybook, and 36 production-browser scenarios against the real pinned server.
  The forced held-response failure and subsequent recovery both executed.
- Focused review follow-up: 149 unit tests passed, including 22 real-SDK inbox
  cases, transcript provenance, and post-disposal highlighting settlement.
- `pnpm test:acceptance:mac`: passed all 8 packaged Electron scenarios after
  rebuilding the final candidate, staging the pinned library/native/WASM runtime,
  and checking the packaged app. This includes the annotated screenshot popover,
  native browser ownership, reload/reconnect, and process cleanup through quit.
  Native dialog and keychain substitutes remain explicit; signing is ad-hoc and
  notarization is disabled for this acceptance build.

**Change accounting at this earlier snapshot against `41b208b`:** production (including manually
authored dependency patches) +226/-90/net +136; configuration +5/-0/net +5;
tests/stories +1,105/-90/net +1,015; generated lockfile/declaration changes
+13/-7/net +6. The documentation report is retained and expanded separately.

Full final logs are preserved under
`/private/var/folders/0m/8pbhxmdx1c73_s21w3n7pcr40000gq/T/opencode/`:
`hidden-falcon-check-final.log`, `hidden-falcon-test-final.log`, and
`hidden-falcon-packaged-final.log`. Reproduction logs remain separate from the
passing final-candidate evidence. These checks use a scripted provider and do
not establish compatibility with a live model provider. Historical missing
artifacts and uncertain CI attribution described above remain historical gaps.

### Final oracle review follow-up

The user requested a further oracle review of the complete diff. Oracle confirmed
the retired queued-loader repair, but found a separate failed-read settlement
race: `createSync` removes its failed entry before the outer token-cleanup
reaction. A concurrent fresh caller could inherit that finishing read's token;
the old cleanup then removed its ownership, causing a successful response to be
discarded or a genuine failure to be swallowed.

Two deterministic real-SDK regressions reproduced both consequences. Their
microtasks enter the specific Promise-reaction interval and assert that the fresh
GET begins before the first public read settles. They then allow the old cleanup
to finish while the fresh response remains held. Both failed before correction
at their publication/error assertions. Token reuse now requires an active or
queued sync entry (`sync.pending(key)`); otherwise the new loader owns a new
token. Identity-checked cleanup and queued-entry retirement remain intact.

All 24 inbox boundary tests pass after correction. Oracle inspected the installed
patch and fail-before/pass-after logs and confirmed both SDK defects are fixed,
with no remaining actionable findings in its follow-up review. The microtask
fixture deliberately targets the pinned SDK's Promise structure; an upstream
restructuring may require adapting its harness while retaining the behavioral
and ordering assertions.

Reproduction and fixed logs are preserved separately as
`hidden-falcon-sdk-settlement-reproduction.log` and
`hidden-falcon-sdk-settlement-fixed.log`. Verification after this correction uses
`hidden-falcon-oracle-check.log`, `hidden-falcon-oracle-test.log`, and
`hidden-falcon-oracle-packaged.log` in the same approved temporary directory.
The earlier full-suite and packaged results above describe the earlier candidate.

The settlement correction adds no new abstraction. It replaces unconditional
token reuse with a check of the existing sync owner's lifetime. Current production
accounting against `41b208b` is +229/-90/net +139 (including manually authored
dependency patches); tests/stories are +1,156/-90/net +1,066; configuration is
+5/-0/net +5; generated lockfile/declaration changes are +13/-7/net +6.

Post-correction verification uses Node `24.20.0`:

- `pnpm check`: passed.
- `pnpm test`: **failed**, with 1,717/1,718 desktop tests passing, including all
  24 SDK cases and 36 production-browser cases. The 53 prompt-editor and 14
  session-tool tests also passed. The sole failure is the existing ContextPanel
  **Collapse All** story at `ContextPanel.stories.tsx:316`: the first-row position
  was captured as `126`, but the post-collapse position was `62`. The Collapse All
  story is untouched by this diff; its only ContextPanel story edit is the separate
  Gutter Range Selection readiness assertion.
- A single focused diagnostic run of Collapse All passed (1 test; 19 skipped),
  recorded in `hidden-falcon-oracle-collapse-diagnostic.log`. This supports
  intermittent timing sensitivity but does not establish its cause or convert
  the failed root gate into a pass. No assertion or timeout was weakened, and no
  unrelated collapse implementation repair was added.
- `pnpm test:acceptance:mac`: passed all 8 scenarios after rebuilding the
  corrected candidate. Annotation preview, native browser resource ownership,
  reload/reconnect, session tools, and process cleanup through quit all passed.

Oracle's code review is clear after the settlement correction; integration still
requires a passing root gate or resolution of that separately recorded failure.

### Pull-request preparation on current main

The PR branch was rebased onto `0761847` after main advanced. The combined
conversation filtering retains main's stopped-session prompt handling while
preserving transcript snapshot provenance. Main's image rendering, background
process rows, viewport/annotation layout handling, and tooltip race correction
are also retained.

On this rebased candidate, `pnpm check` passed and the current fast-tier
`pnpm test` passed 53 prompt-editor, 14 session-tool, and 1,455 desktop tests
(1,522 total). Logs are `hidden-falcon-pr-check.log` and
`hidden-falcon-pr-test.log` in the same approved temporary directory. Main now
assigns full component, integration, and build verification to CI; those tiers
are pending for this combined candidate. Earlier full-suite and packaged evidence
remains scoped to its recorded checkout. The historical Collapse All failure is
not covered by the new fast tier and remains recorded above.

Main advanced once more to `7224037` during PR preparation. The branch was rebased
again, retaining the new concise retry/failure presentation and forwarding
`connected` through the stable reactive assistant row. On this final rebase,
`pnpm check` passed and fast-tier `pnpm test` passed 53 prompt-editor, 14
session-tool, and 1,460 desktop tests (1,527 total). Latest logs are
`hidden-falcon-pr-check-latest.log` and `hidden-falcon-pr-test-latest.log`.
