# Test suite improvement proposal

Status: implemented against `08b524e` on 2026-09-12; verification results are
recorded below. The sections that follow preserve the agreed proposal.

## Intended result

Make test names match the behavior their assertions establish, remove redundant
checks only where surviving tests cover the same boundary, and reduce fixture
overhead without dropping meaningful failure or lifecycle coverage.

Use the existing Vitest unit, Storybook, browser acceptance, and packaged
WebdriverIO suites. No new test framework, application runtime, or production
configuration seam is proposed. Test count is not a success metric.

## Baseline and limits

The review run of `pnpm test` passed 813 tests: 12 in session-tools and 801 in
desktop. Desktop reported 98 files and 69.67 seconds elapsed. These are one-run
observations, not stable performance budgets. Packaged Electron was inspected,
not executed. The initial worktree dependency installation is not part of the
reported desktop duration.

| Test or group                                          | Review timing |
| ------------------------------------------------------ | ------------: |
| Browser acceptance, 12 scenarios including suite hooks |       34.41 s |
| External disk-edit refresh                             |        6.09 s |
| Streaming, questions, stop, and reconnect              |        5.93 s |
| Annotation/review submission                           |        4.25 s |
| Inherited agent/model/variant choices                  |        4.20 s |
| Style-token tests                                      |        9.44 s |
| NewSessionFlow                                         |        6.61 s |
| DeleteSessionFlow                                      |        3.84 s |
| Inspection launcher cleanup, both signals              |        2.86 s |
| Actual rewritten-default-branch Git case               |        1.09 s |
| Storybook focus interaction                            |        1.50 s |
| Storybook annotation interaction                       |        1.44 s |

Times overlap and must not be added to predict wall-clock savings. The Foundations
story took 3.24 s during the full run and 211 ms in a focused rerun; startup and
contention must be separated from story execution before targeting that example.
Original logs were saved in `/tmp/ocui-suite-review.log` and
`/tmp/ocui-foundations-profile.log`; those are temporary evidence, not repository
dependencies.

## 1. Repair assertions before consolidating tests

Paths below are relative to `apps/desktop` unless otherwise stated.

| Candidate                                                                                                          | Proposed change                                                                                                                                                                                                                                                                                                                                                     | What must remain protected                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/e2e/browser.test.mjs`: transport recovery                                                                    | Record completed assistant messages and provider requests immediately before the recovery send. Assert a new request for that send and a new completed assistant response belonging to the selected session. Do not accept the user's prompt echo or an older completed response. Compare cancellation counts before and after this scenario's Stop action as well. | Actual streaming, question settlement, provider failure, HTTP cancellation, reconnection, and successful work after reconnection.                                 |
| `src/renderer/opencode/transcript.test.ts`: selection changes                                                      | Retain an explicit already-obsolete case. Add the missing interleaving: begin hydration, hold an older page, change `isCurrent` to false, release that page, and assert no next page starts and the caller settles. Make another page available so unconditional continuation would fail.                                                                           | Both the initial admission guard and stopping obsolete pagination after work starts. This is not a promise that an already-running SDK page is forcibly canceled. |
| `src/renderer/opencode/code-review.test.ts`: every file/comment                                                    | Assert both paths, both bodies, both selected-code blocks, and their order. Give comments different ranges and selected code so reusing the first comment cannot pass. Keep the escaped filename and backtick-fence cases.                                                                                                                                          | No lost, duplicated, or reordered review comments; correct range labels, quoting, and safe fences.                                                                |
| `src/renderer/components/App/ConnectedApp/Sessions/SessionSidebar/NewSessionFlow/AddProjectDialog.test.tsx`: retry | Make error/adding props reactive in the fixture. Submit a location, publish the failure, assert focus on the operation-error alert, then activate Try again. Assert exactly one additional callback with the same complete location, including workspace identity when present.                                                                                     | The error remains understandable, retry becomes enabled after failure, and retry does not change or truncate the selected server location.                        |
| `src/renderer/components/App/ConnectedApp/Changes/ContextPanel/ContextTabs.test.tsx`: mounting                     | Assert the supplied diff content is inside the visible panel. Retain `aria-controls`, add reciprocal `aria-labelledby`, and verify referenced IDs identify the actual elements.                                                                                                                                                                                     | Content projection and accessible association, without fixing the generated ID spelling.                                                                          |

For these regressions, demonstrate during implementation that each strengthened
assertion fails for the specific omission it targets, using a temporary local
perturbation where practical. Restore the source before final verification. Do
not add a permanent mutation-testing dependency or claim detection without
checking it.

## 2. Consolidate only demonstrated overlap

| Candidate                                            | Decision                                                                                                                                                                                                                                   | Coverage tradeoff and surviving test                                                                                                                                                                                                                |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PermissionsDialog test of `data-fit` and `data-size` | Remove this single unit test after confirming the existing EmptyReady and FailedEmpty stories still measure actual dimensions.                                                                                                             | Loses exact upstream attribute expectations, intentionally. Keep compact width/height and narrow overflow assertions in `stories/PermissionsDialog.stories.tsx`; those establish the user-visible requirement.                                      |
| Transcript test that passes the string `child`       | Fold its zero-older-pages example into the normal hydration test, explicitly asserting zero pagination calls. Use a neutral ID and an accurate name.                                                                                       | The current fixture has no hierarchy, so it does not prove child routing. Retain session-catalog child admission/reconnect tests and `createSessionWorkspace.test.ts`'s selected-child retry test.                                                  |
| SessionTree orphan and ordering tests                | Replace the separate simple rendered examples with one fixture containing multiple roots, ordered siblings, and an orphan. Keep the detailed pure projection tests.                                                                        | Retains proof that the component consumes the projection correctly while avoiding repeated setup. Keep recursive selection, filter-driven ancestor visibility, controlled expansion restoration, recency grouping, and empty/no-match distinctions. |
| Transcript finalizer count                           | Retain the bounded-retention regression. First check whether the installed Effect version exposes a suitable public observation. If none exists, keep the narrow internal scope inspection, with its version-sensitive purpose documented. | Successful shutdown alone cannot detect workers accumulating during a long-lived workspace. Do not replace this check with shutdown assertions or add a production debug API solely to remove internal test access.                                 |

The interview established one unused UI capability to remove. Treat it separately
from compatibility coverage that remains useful:

- Keep legacy review metadata decoding and rejection of malformed new envelopes
  without legacy fallback: the current reader supports persisted old messages.
- Remove the unused sidebar requires-input indicator, as agreed during the
  interview. Remove its optional inputs and forwarding, rendering and exclusive
  styles, dedicated tests, and story fixture options. `SessionsRegion` does not
  currently supply this state. Preserve running/idle status, selection, deletion
  eligibility, and the active permission controls. Inspect all consumers before
  editing; do not remove shared styling or permission logic based on terminology
  alone. The coverage intentionally lost is the unused controlled indicator and
  its accessible label, not a live permission workflow.
- Keep render-only Storybook examples with distinct states. They participate in
  the accessibility gate and remain visual fixtures. Describe interactive-looking
  examples accurately: add a focused `play` assertion only where a meaningful
  interaction lacks existing coverage. Do not add clicks to every story merely
  to make its test count look substantive.

## 3. Reduce known test overhead

### Style checker subprocesses

Start with batching through existing interfaces, rather than refactoring the
production checker. `check-inline-style-tokens.mjs` already accepts multiple file
arguments. Write distinct fixture files, run the invalid group together, and
assert an expected diagnostic for each file and rule/value. Run valid fixtures
separately and assert success. This preserves attribution: one invalid fixture
must not hide another fixture that stopped being checked.

Batch the Stylelint CLI fixtures while preserving representative feature, story,
and owning-file paths so configuration overrides still apply. Parse results by
file and rule. If batching cannot express a required override cleanly, use
Stylelint's installed library API for that matrix and retain one CLI exit-status
and diagnostic smoke test. Do not introduce a second rule configuration.

Keep the repository-wide unresolved-token scan and coverage for nested fallbacks,
injected styles, allowed displayed code, disallowed literal design values, and
the exceptions for owning files. Replace repeated process startup, not cases.

### Session dialogs

The pinned upstream DialogProvider closes its layer after a 100 ms timer. The
NewSessionFlow test helper currently sleeps 200 ms at 21 call sites, some within
parameterized cases. Replacing that sleep with a shorter real delay is not a
reliable optimization.

For unit cases that require actual dialog closure, control only the relevant
timeout APIs, advance the close timer, and assert the old layer is removed and
the new layer or focus target is ready. Restore clocks in cleanup after owned
work has settled. Do not drain all timers indiscriminately: Effect timeouts and
recurring work can share the test environment. Keep real browser tests for
Escape, close/reopen, remount, blocked dismissal, and restored focus.

Use the existing `createDeleteSessionFlow` controller directly for worktree path,
strategy, eligibility, deduplication, and retry-policy cases. Keep its real
workspace owner and arrange explicit dependency settlement. Retain rendered
tests for confirmation controls, dismissal, pending remount, retained errors,
focus, and view/owner lifetime interactions. Apply the same distinction to
NewSessionFlow cases where UI mounting contributes no evidence.

Remove the separate fixed 130 ms wait in `PermissionsRegion.test.tsx` using the
same controlled-close approach. Prefer existing deferred fixtures for request
ordering; do not replace positive settlement evidence with extra microtask loops
or a blanket reduction in polling intervals.

### Scripted provider

The provider currently waits 1.2 seconds before completing every ordinary response.
Restrict the intentional delay to explicit `E2E_STREAM` scenarios. Complete
ordinary annotation, review, recovery, plugin, and model-choice responses promptly
while preserving the same protocol and content. Keep `E2E_STOP` open until the
client cancels it, and keep provider-error/tool scenarios unchanged.

Check both browser and packaged consumers before switching the default. Tests
whose purpose is not streaming must await their actual final result rather than
requiring an incidental transient Stop button. Streaming tests must still observe
the first fragment while work is pending and the later completed response.

Prefer this existing scenario-marker convention to a new fixture-control service.
If the explicit streaming delay proves flaky, replace that delay with a narrowly
scoped release mechanism owned by the fixture, with disconnect/shutdown cleanup;
do not add it speculatively.

### Real polling, processes, Git, and Storybook

- Keep external create/edit/delete and closed-panel refresh in browser acceptance.
  They validate real automatic polling and unchanged-row preservation. Do not
  simulate manual refresh or shorten production intervals for test speed. Its
  roughly six seconds is acceptable after eliminating unrelated fixture waits;
  interval/backoff details already use controlled time in the unit suite.
- Keep both SIGINT and SIGTERM inspection-cleanup cases. A real process cannot be
  reused after shutdown, and each must prove profile deletion and dead listeners.
  Do not introduce fake child processes just to save their roughly three seconds.
- Keep the actual Git force-update/offline/quoting test. Its approximately one
  second buys evidence unavailable from command-string assertions.
- Keep Foundations, focus, and annotation stories. Reassess only with comparable
  warm runs; retain accessibility checks and actual keyboard, geometry, and
  pointer behavior. Do not disable browser isolation or accessibility to improve
  reported timings.

## 4. Give browser and Electron coverage clear responsibilities

Agreed during the interview: browser acceptance owns all shared workflows.
Packaged acceptance is retained only for desktop-specific behavior: delivered
resources, main/preload integration, settings, native views, and process lifetime.
A chat flow belongs in Electron only when it establishes one of those boundaries,
such as the bundled server completing a request or transcript recovery after a
renderer reload; generic chat smoke coverage alone is not a reason to duplicate it.

Before removing any packaged step, map its assertions to a surviving test and
identify what Electron boundary it uniquely exercises. Specifically:

| Packaged area                                             | Proposed treatment                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Basic streaming/question/provider-error/annotation matrix | Move missing details into the browser suite first, including submitted question value and explicit question cancellation. Then remove duplicate portions of `provider-flows.ts`. Retain a packaged prompt only where needed to verify the bundled runtime or another identified desktop boundary. |
| Reload and recovery                                       | Retain persisted transcript/annotation hydration across renderer reload and proof that the owned worker PID remains the same. Keep native-owned transport/process behavior; use the stronger post-recovery response assertion in both retained consumers.                                         |
| Project and review flows                                  | Consider trimming repeated renderer editing steps only after mapping them. Retain packaged filesystem/worktree context, actual selected commit, disappearance on deletion, bundled runtime behavior, and persisted review hydration where it crosses reload.                                      |
| Session tools                                             | Keep packaged plugin loading and independent-session creation: the browser cannot prove the plugin and runtime dependencies shipped correctly.                                                                                                                                                    |
| Native lifecycle and settings                             | Keep lazy startup, settings encryption/forget, Cancel Quit, crash/manual restart, shutdown child/PTY settlement, preload access, signature/architecture checks, and embedded browser cleanup.                                                                                                     |

This is a step-level consolidation, not deletion of the packaged suite. Remove
unused flow helpers and fixtures in the same change that removes their last
consumer. Preserve the runner's explicit phase selection and shared scenario
ordering. Do not duplicate complete browser scenarios in a new framework.

## 5. Delivery sequence and acceptance

1. **Correctness:** strengthen the five assertion groups and clarify misleading
   child and story descriptions. Verify the targeted omissions
   are detected. No coverage removal in this step.
2. **Local consolidation:** remove the attribute-only sizing test, combine the
   tree examples, preserve the no-pagination case, and document the resource
   retention test's measurement decision. Remove the unused sidebar indicator
   and its exclusive code, tests, and story inputs as agreed above.
3. **Fixture performance:** batch style cases, remove real dialog sleeps where
   controlled time is appropriate, and move controller-only cases out of DOM
   fixtures. Measure each changed group against its baseline.
4. **Provider performance:** narrow the streaming delay and verify browser and
   packaged consumers with the real pinned server.
5. **Cross-surface consolidation:** transfer unique assertions before trimming
   duplicated packaged steps, then verify the final combined suite.

Use focused existing commands while developing; follow
[App verification](app-verification.md) for final checks. After code or
configuration implementation, run `pnpm check` and `pnpm test` from the root.
Run `pnpm test:acceptance:mac` for the shared provider and packaged-flow changes.
The browser and Storybook projects already run within the root test command.
Use disposable state and the scripted provider, not live model credentials.

For performance comparison, collect three baseline and three final runs for the
changed slow groups under comparable conditions, distinguishing initial startup
from subsequent runs. Bypass task-result caching for timing runs. Report median
and range, test-body versus suite/setup time where available, exact discovered
case counts, and the final root wall time. These repeated runs are for the
requested performance measurement; do not otherwise replay passing suites.

Completion requires:

- Every removed assertion has a named surviving behavioral check, or an explicit
  decision that an exact implementation detail is no longer a contract.
- Lifecycle, partial-failure, retry, ordering, cancellation, cleanup, and shutdown
  coverage remains. Subscriber removal must still be distinguished from owner
  shutdown, and canceled requests must still settle their underlying work.
- Legacy persisted data, server location context, attachment bytes, safe worktree
  removal, native resource ownership, and accessibility coverage remains.
- New assertions detect the relevant wrong behavior and do not accept prompt
  echoes, stale prior results, empty selections, or merely truthy focus targets.
- Required checks pass, or unrelated failures and unverified boundaries are
  reported explicitly. No claimed speedup until measured.
- Report production, test, and documentation lines separately, plus new helpers
  and removed machinery. Prefer fewer fixture launches and clearer tests to new
  production abstractions.

## Scope and expected complexity

Most changes should be in existing tests and fixtures. Likely additions are small
reactive fixture inputs, a focused dialog-timer helper if shared use warrants it,
per-file diagnostic expectations, and stronger result assertions. Likely removals
are redundant test bodies, repeated CLI launches, fixed waits, and unused
packaged-flow steps/helpers. The agreed production cleanup removes the unused
sidebar requires-input contract. No production state mirrors, debug services,
new public application API, or change to current visible app behavior is planned.

Retaining the finalizer-count check, real polling, two signal cases, and real Git
test is intentional: all were reviewed for improvement, but deleting or replacing
their evidence would cost more than their measured runtime justifies.

## Implementation record

The five assertion groups were strengthened. The sidebar indicator and its
exclusive inputs, rendering, style, fixture option, and tests were removed.
Legacy review decoding and malformed-envelope rejection remain unchanged.
Render-only hierarchy stories retain accessibility checks; FilterableDeepHierarchy
now describes its role as a visual fixture and points to the behavioral tests.

### Coverage after consolidation

| Removed or moved check                                                        | Surviving evidence                                                                                                                                                                                      |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dialog sizing attributes                                                      | PermissionsDialog EmptyReady and FailedEmpty story geometry checks                                                                                                                                      |
| Separate zero-page transcript example                                         | Parameterized normal hydration with an explicit zero-call assertion                                                                                                                                     |
| Separate rendered orphan/order examples                                       | Combined SessionTree projection fixture plus detailed pure projection tests                                                                                                                             |
| Sidebar requires-input state                                                  | Intentionally removed unused capability; running/idle labels and permission workflows remain                                                                                                            |
| DOM mounting for session policy cases                                         | Existing real workspace owner with controller calls; rendered remount, dismissal, failure, focus, and owner-lifetime tests remain                                                                       |
| Repeated style-checker process launches                                       | Per-file/per-rule invalid diagnostics, separate valid cases, installed Stylelint configuration, and one real CLI smoke check                                                                            |
| Packaged streaming/model/agent/question/error/stop matrix                     | Browser streaming/reconnect and annotation/review scenarios, including Alpha tool receipt and explicit question cancellation                                                                            |
| Packaged annotation discard, immutable comments, and session-switch hydration | Browser annotation/review scenario now performs these steps                                                                                                                                             |
| Packaged draft/dialog/layout walkthrough                                      | Browser shared-session scenario covers directory navigation, scrolling, Escape/focus, project picker, draft isolation, and narrow overflow; packaged setup retains worker default-directory propagation |
| Packaged worktree deletion cancel/reopen                                      | Browser isolated-worktree scenario; packaged test retains deletion from the delivered server filesystem                                                                                                 |
| Packaged review panel remount                                                 | Browser review scenario preserves the draft through panel closure/reopen; packaged review still verifies renderer reload persistence                                                                    |
| Packaged comparison selector round trip                                       | Browser external-disk-edit scenario covers working and branch comparison modes                                                                                                                          |

The packaged project flow retains the Git HEAD event check because it establishes
that the delivered server's watcher emits the event. Worktree location under the
isolated XDG directory, selected commit, removal from Git and disk, and source
project survival remain. Delivered plugin loading, independent sessions, native
settings, preload, worker identity, native views, quit, crash/restart, and process
cleanup retain their existing packaged phases.

The provider uses its existing E2E_STREAM marker for the intentional delay;
ordinary responses finish promptly. No production workflow API, test framework,
or fixture-control endpoint was added. Small test-local helpers collect a fresh
completed response, create annotation drafts, and construct the existing session
controller. The existing dialog-close helper now advances only timeout APIs;
PermissionsRegion likewise advances its known close/focus timer.

### Assertion sensitivity

Temporary changes were applied one at a time and restored before final checks.
Dropping the second review comment failed the section-count assertion; removing
the in-progress selection guard produced two page requests instead of one;
omitting diff content failed the content assertion; suppressing the retry callback
failed the exact two-call/location assertion. Logs are in
`/tmp/ocui-mutant-{review,pagination,context,retry}.log`.
For the recovery check, the provider temporarily rejected only the recovery send.
The browser assertion failed because completed messages remained at three rather
than increasing, despite the prompt being admitted and echoed; see
`/tmp/ocui-mutant-recovery.log`. The provider was restored.

### Known observation

While transferring annotation coverage, Escape did not dismiss the annotation
popover in the full browser flow. The close control is intentionally hidden.
The transferred scenario uses normal outside-click dismissal; the existing
TranscriptAnnotations Storybook Escape/focus test remains. This task does not
change annotation runtime behavior. The full-app Escape discrepancy remains a
separate observation, not a claimed passing browser check.

### Timing evidence

Each group ran three times before and after, with no other verification suite
running concurrently. Commands used fresh Vitest runners through
`pnpm --filter desktop exec vp test run`, bypassing task-result caching. The local
arguments were `--project=unit style-tokens NewSessionFlow.test DeleteSessionFlow.test`;
browser used `--project=web`. Installation and initial fixture investigation are
excluded. These are local observations, not performance budgets or cold-host
benchmarks. The unused helper removed after measurement had no callers.

| Group / measure                               | Baseline median (range), seconds | Final median (range), seconds |
| --------------------------------------------- | -------------------------------: | ----------------------------: |
| Local runner elapsed, 3 files / 60 cases      |                 9.56 (9.44–9.59) |              8.21 (8.10–8.26) |
| Local summed test bodies                      |              17.37 (17.29–17.42) |           10.57 (10.54–10.65) |
| Browser runner elapsed, 1 file / 12 scenarios |              33.76 (33.76–33.79) |           26.29 (26.08–26.48) |
| Browser test bodies including suite hooks     |              33.38 (33.38–33.42) |           25.91 (25.69–26.11) |

Elapsed runs in order (first observed run, then two subsequent runs): local
baseline `9.56, 9.44, 9.59`, final `8.10, 8.26, 8.21`; browser baseline
`33.76, 33.79, 33.76`, final `26.08, 26.48, 26.29`. Runner elapsed excludes the
outer pnpm launch. Local test bodies overlap across workers, so they cannot be
subtracted from runner elapsed to derive setup time. Browser runner overhead
outside its test/suite hooks was about 0.36–0.39 seconds. Per-file baseline timings
were not emitted by the focused reporter; no per-file median is claimed.

The measured median runner reductions are 14.1% for the local group and 22.1% for
browser acceptance, which also gained transferred assertions. Logs are
`/tmp/ocui-{baseline,final}-{local,web}-{1,2,3}.log` and are temporary evidence.

### Final verification and size

- `pnpm check`: passed, including formatter, lint/types, WDIO types, styles,
  component layout, and unused-code checks.
- `pnpm test`: passed 810 cases (12 session-tools; 798 desktop in 98 files).
  Browser and Storybook are included. Root command wall time was 66.79 seconds;
  desktop reported 61.66 seconds, compared with the single initial 69.67-second
  review observation. These full-run observations are not a median benchmark.
- `pnpm test:acceptance:mac`: passed all seven packaged scenarios. The command
  took 185.48 seconds including build/signing; WDIO reported 1m 29s of tests.
  The isolated worker/PTY cleanup checks passed. The separate live-provider chat
  command was not needed or run.
- All five temporary omission checks failed at their intended assertions and were
  restored. Final focused timing runs passed all 60 local cases and all 12 browser
  scenarios each time.

Production changed by +2 / -25 lines, net -23. Tests, stories, and fixture helpers
changed by +520 / -505 lines, net +15. Generated code changed by zero lines. The
small net test growth buys actual retry, pagination, content, response identity,
and transferred browser assertions; larger repeated packaged walkthroughs and
fixture launches were removed. No new production abstraction was introduced.
The old sidebar input-status contract and the now-unused project-picker test
helper were removed. No temporary duplication is scheduled for later removal.

Full verification logs: `/tmp/ocui-final-check.log`,
`/tmp/ocui-final-root-test.log`, and `/tmp/ocui-final-packaged.log`.

Documentation: +378 / -0 lines (net +378), including this proposal and report.
