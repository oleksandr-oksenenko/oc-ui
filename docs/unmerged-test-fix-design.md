# Unmerged test-fix inventory and remaining repair designs

## Current list after rebasing on main

Refresh: **2026-10-08, approximately 18:30 UTC**, against remote main
**`9c1fd1da490ec1d1a62e8c43256b20a140723c01`**. The investigation report was
committed on `docs/test-fix-design-audit` and rebased onto that SHA without
conflicts. Only this worktree was rebased.

This refresh compares merged source, PR/check status, recent CI results, and
all **91 registered worktrees** (17 dirty at the snapshot). It does not repeat
the original full session-history audit or execute application tests. The
original findings and detailed designs below remain historical evidence; their
unmerged/pending labels are superseded by this section.

### Repairs now integrated

| Previous owner / repair                                                                                                                        | Current disposition                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hidden-falcon`: SDK inbox settlement/cancellation, focus ownership, transcript identity, tokenizer/highlighter tests, browser fixture cleanup | **Merged via PR #26**, main commit `fa59f33`. Reuse the committed SDK/UI patches. Its historical 1,717/1,718 failure remains evidence for Collapse All, not the current gate result.  |
| PR #19: Linux packaging, PTY resolver, display-aware resize                                                                                    | **Merged**, `b986d2a`. Follow-up headless terminal and process-exit fixes also **merged via PR #24**, `0761847`.                                                                      |
| `tidy-rocket`: stopped-session prompt placement                                                                                                | **Merged via PR #23**, `d66af48`.                                                                                                                                                     |
| PR #22 and `misty-circuit` UI/layout/interaction changes                                                                                       | **Merged via PR #22/#25**, `fc549ee` / `9b91037`. Main also includes dialog-cleanup/long-answer fixture changes in `44ebf59`.                                                         |
| ContextPanel Long Path Tooltip                                                                                                                 | **Merged via PR #18**, `20c8438`, preserving queued-render reproduction. This does not change Collapse All.                                                                           |
| ContextPanel Gutter Range Selection readiness                                                                                                  | **Merged in PR #26**: the helper now asserts readiness instead of returning false successfully. Remove this from the open implementation list; historical causality remains unproven. |
| Original dependency PR #6–10 installation failures                                                                                             | Newer runs passed CI. #6, #7, #9, #10 merged with scoped lockfile fixes. #8 is still open with passing checks at `c8c15c4`; its installation failure is historical.                   |

### Remaining test investigation / fix list

The first item is a **new confirmed recent CI failure**. Items 2–10 are retained
historical/intermittent cases with no established targeted correction; successful
newer suites reduce urgency but do not prove their races were removed.

| Priority | Scenario                                            | Evidence and current status                                                                                                                                                                                                                                                                                          | Minimal next change                                                                                                                                                                                                                                                                              |
| -------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1        | **External server image readiness**                 | Main `44ebf59`, CI run `37802742632`, macOS Integration: `browser.test.mjs:2628` gets a non-string (`null` is consistent with the API) from `getAttribute("src")` after the preceding decoded-width check passed. Failed before navigation; not evidence of navigation failure. Current main retains this assertion. | Assert blob source, decoded width, and completion in one sample of the same, specifically identified image. Preserve those checks after navigation and the unchanged server session location. Capture render/reader identity if readiness still fails; production repair requires that evidence. |
| 2        | **ContextPanel Collapse All**                       | Initial missing disclosure and separate first-row top `126 → 62` observations. The original Collapse All story remains unchanged; latest completed component jobs pass.                                                                                                                                              | Establish both file headers and layout readiness before measuring; assert settled viewport/header-plus-gap geometry. Preserve the 8px gap and collapse/expand contract. Detailed design E.                                                                                                       |
| 3        | **ContextPanel Virtualized List initial readiness** | Historical failure at the first `path(0)` assertion, before scrolling. No targeted initial-readiness change in current main.                                                                                                                                                                                         | Establish the specific file/viewport and real renderer readiness, then exercise bounded windowing, eviction, and return-to-start reuse. Design J.                                                                                                                                                |
| 4        | **Permission keyboard readiness**                   | Current code still calls `focus()` and Enter without checking enabled state or actual focus. Latest completed macOS browser run passes this flow.                                                                                                                                                                    | Hold/release hydration in a regression; wait for enabled/focused state, activate once, observe the matching reply, and assert UI/server settlement. Design H.                                                                                                                                    |
| 5        | **Draft checkout-refresh barrier**                  | Historical Markdown hidden-agent refresh failure occurred before saved-agent validation. Submission refresh contract remains unchanged; latest completed browser run passes.                                                                                                                                         | Capture required/observed `agent.updated`, checkout identity, and a read-only server agent snapshot; distinguish stale server state from missing notification. Preserve checkout/draft after partial failure. Design I.                                                                          |
| 6        | **Inspection startup before SIGINT**                | Historical 30-second readiness failure happens before any signal. Test and acquisition boundaries remain unchanged.                                                                                                                                                                                                  | Add phase evidence; separate bounded cold preparation from signal-after-readiness cleanup, retaining acquisition/late-cleanup ownership. Design F.                                                                                                                                               |
| 7        | **Occupied-port runner exit**                       | Historical 15-second child exit timeout; output was not drained into the failure report. Relevant fixture/runner remains unchanged.                                                                                                                                                                                  | Drain bounded child output and observe exit from spawn; distinguish pre-bind delay from finalizer hang while preserving blocker and child cleanup. Design G.                                                                                                                                     |
| 8        | **Terminal retention / WSS recovery**               | Historical 180-second timeout has no stalled-stage evidence. Latest completed macOS browser run passes in 10,844 ms. Terminal scenario has no targeted checkpoint/cleanup repair.                                                                                                                                    | Add stage checkpoints and owned PTY/session cleanup on early failure; correct a recovery boundary only if diagnostics establish it. Design B.                                                                                                                                                    |
| 9        | **Packaged startup stale click**                    | Original PR #16 first-scenario click remains unidentified. Stable transcript identity and native startup repairs are now merged; latest completed native jobs pass on both platforms. Residual diagnostic lead, not a currently failing native job.                                                                  | If reproduced, preserve the first stage-specific click/DOM evidence, refresh the target after actual settlement, and report dependent fixture failures as prerequisites. Design C.                                                                                                               |
| 10       | **Cold real syntax worker failure cause**           | PR #26 landed observer headroom and highlighter/tokenizer regressions. Production request budget is unchanged; original nested `SyntaxHighlightError` cause was never established. Latest component jobs pass. Residual diagnostic lead after partial test repair.                                                   | Surface the actual nested cause/stage on recurrence; preserve production timeout, termination, replacement, and disposal checks. Do not add another observer timeout increase. Design A.                                                                                                         |

### Separate installation blocker

**New PR #28 (`hono` update), head `a2277d55`:** multiple jobs fail during
`pnpm install --frozen-lockfile`. The inspected Ubuntu Fast job `113473418873`,
run `37824416976`, rejects **`legacy-javascript@0.0.3`** under
`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` (published
`2026-10-08T00:08:53.168Z`; cutoff `2026-10-07T18:27:41.116Z`). This is the same
transitive admission as the original dependency failures, now confirmed from the
new run's own log. Preserve the age policy and apply the already-merged scoped
lockfile correction through the dependency owner. Application tests did not run
in those failed jobs. Design D still applies to this new PR.

PR #29 (commit-message guidance) has queued/in-progress checks at this snapshot;
there is no established test failure to add from it.

### Evidence and remaining ownership

- Latest completed main run **`37802742632` on `44ebf59`**: both Fast, Components,
  Builds, and Native jobs passed; Ubuntu Integration passed; macOS Integration
  failed only the image assertion above (54/55 integration tests passed). This is
  CI evidence for that SHA, not a passing result for refreshed main.
- Current-main CI **`37824147166` on `9c1fd1d`** was pending at the query. No new
  local test gates were run for this documentation-only refresh.
- Reviewed dirty `curious-tiger` submission changes are wording changes, not the
  draft-refresh fix. `tidy-rocket-2` owns an unmerged session-catalog pagination
  repair. `quiet-knight` retains older native/verification work overlapping merged
  PR #19/#24; reconcile against current main before using it. `glowing-meadow`
  retains theme/diff-highlighter changes. No sampled dirty diff contains a repair
  to the image assertion, permission activation, `agent.updated` barrier,
  Collapse All, or Worker Pool story.
- Historical ChangesRegion/NewSession/storage leads and experimental editor
  probes keep their dispositions in J; no new causal failure was established for
  them in this refresh.
- Retained refresh evidence is under the approved temporary directory with prefix
  `test-investigation-refresh-`: worktree/PR snapshots, failed-main job data/log,
  new dependency-job log, and owner diffs. The original inventory and logs remain.

### Updated execution order

1. Start on current main; the major reliability/native/UI repairs are integrated.
2. Fix the confirmed image-readiness observation boundary; verify both image
   variants, navigation, and server location invariants.
3. Resolve ContextPanel initialization/geometry deterministically, preserving
   merged tooltip and gutter coverage.
4. Harden permission activation and investigate draft freshness, then add causal
   startup/exit/terminal evidence and cleanup at their existing owners.
5. Keep worker/stale-click leads as targeted recurrence diagnostics. Handle PR #28
   installation through its dependency owner separately.

Refresh accounting: production, configuration, tests, generated code **+0/-0**;
documentation only. No runtime abstractions or machinery added or removed.

## Implementation design

Requested after the refresh: design, Oracle review, and implementation. The
candidate starts at `9c1fd1d`; no other worktree is edited. Use Node `24.20.0`
through `mise exec node@24.20.0 -- …`. The frozen-lockfile installation succeeds
on this branch, so the separate dependency PR requires its owner's scoped update.

### Ownership and failure policy

| Boundary                                  | Owner and lifetime                                                                 | Ordering, cancellation, and recovery                                                                                                                                                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Image observation / permission activation | Existing browser acceptance scenario                                               | Observe image readiness atomically. Hold hydration before navigation, release it before one enabled/focused activation. Never retry a mutation.                                                                                        |
| Diff initialization / geometry            | Story fixture and real Pierre renderer                                             | Prepare only layout fixtures' language/theme resources before mounting. Assert content-relative geometry and the existing collapsed gap; retain unpreloaded readiness coverage.                                                        |
| Checkout / reload                         | Workspace submission, project mutation lock, pinned server watcher                 | Keep application-owned work alive across navigation. No notification or arbitrary catalog read can substitute for a checkout-generation acknowledgement. Retain the checkout/draft and fail closed when refresh cannot be established. |
| Inspection acquisition / shutdown         | Inspection process, supervised by its test fixture                                 | Preparation has its own bounded owner. Signal requests retain ownership until acquisitions settle, then close resources before deleting the profile. Evidence distinguishes acquisition from post-ready shutdown.                      |
| Runner exit                               | Existing child-process fixture                                                     | Drain bounded output and attach exit observation at spawn. Terminate and await only the owned child on failure; retain the blocker listener.                                                                                           |
| Terminal faults / resources               | Scenario owns injected routes and its remote PTYs/sessions; workspace owns sockets | Restore faults, release held routes, reconcile only owned resources, attempt every cleanup and await settlement. Report primary and cleanup failures together.                                                                         |
| Packaged startup prerequisites            | Existing packaged suite and app/profile runner                                     | Label single actions, retain acknowledged seed IDs and original failure, fail downstream dependencies promptly, and always quit/await owned processes.                                                                                 |
| Syntax worker errors                      | Existing renderer pool/cache and reporting boundary                                | Preserve the nested error and stage, ten-second budget, failed-slot invalidation, same-key recovery, and awaited runtime disposal.                                                                                                     |

### Review and verification

Oracle reviewed the design and the pinned-server regression seam in session
`ses_ee332a3e1ffesReMHQXrGZZKO4`. Accepted corrections:

- Preload `github-light-high-contrast` and `github-dark-high-contrast`, not Pierre
  defaults. Keep the unpreloaded Diff story's real body-readiness check; syntax
  Worker Pool coverage is a different highlighter boundary.
- Preserve first-row/content-start alignment as well as each collapsed item's
  literal 30px header + 8px gap. Relative spacing alone misses bottom alignment.
- The pinned agent plugin ignores a root-only supplementary-directory update
  when Config entries stay unchanged. Reproduce with its actual plugin, Config
  test layer, filesystem parser, and real Agent service; stub only Bus publication.
- Correct complete location identity, but do not claim events acknowledge a
  checkout generation. The API has no such contract.
- Terminal cleanup must start before creation, preserve baseline PTYs, restore
  faults before resource cleanup, detach individual socket listeners, and attempt
  every cleanup. Keep original and cleanup errors together.

### Implemented boundaries

- Browser images: exact file-source locator and one sample of blob source,
  completion and decoded dimensions before/after navigation.
- Collapse/virtualization: actual-resource preparation and body readiness;
  content-relative alignment, literal collapsed heights/gaps, and full windowing
  contract. The ordinary Diff story retains unpreloaded initialization coverage.
- Permissions: held matching hydration, disabled-state observation, enabled and
  focused control, one Enter, exactly one successful reply and UI/server settlement.
- Drafts: pinned-core root-invalidation patch, full location filtering, bounded
  required/observed/pending metadata and cancellable agent-state diagnostics.
  Missing confirmation still retains the checkout/draft and sends nothing.
- Inspection: separate cold bundle preparation, named acquisition/teardown phases,
  and controlled IPC tests holding the acquired result while a signal is handled.
- Occupied port: drained output and spawn-owned exit observation, sanitized
  diagnostics, original blocker probe and released-port check.
- Terminal: fixture-owned IDs, bounded reads, fault restoration, all-attempted
  remote cleanup and socket-listener disposal, stage/state diagnostics, forced
  early-failure coverage and controlled recreated-shell Unicode input.
- Packaged startup: labeled single actions, acknowledged fixture IDs, safe first
  failure state, prerequisite failure for dependents, and unique screenshots.
- Syntax worker: known failure stages and printable cause type without source/token
  payloads; nested timeout, terminated slot, same-key replacement and disposal.

Oracle's implementation review additionally corrected these ownership boundaries:

- Terminal scenarios own disposable renderer pages: server deletion alone leaves
  retained UI records. Fault restoration precedes a dynamically drained cleanup
  list, including callbacks registered while restoration awaits. Ambiguous session
  or PTY creation cannot be certified clean merely because a list is empty; it
  reports unresolved isolation and stops dependent work. Baseline acquisition is
  bounded/protected and cleanup failures retain the original failure.
- The inspection gate initiates server acquisition and observes its rejection
  immediately, then holds publication until the signal is handled and the parent
  releases it. The late handle remains owned and is closed before profile removal.
- Packaged clicks retain their prior/default action deadlines; only the original
  New Session boundary explicitly uses the startup deadline.
- Unrelated agent notifications assert no invocation of the delegated real
  filesystem scan, in addition to unchanged agent state and reload count.

The unpreloaded Diff story covers readiness, not guaranteed cold initialization:
Pierre's singleton can already be warm. Syntax diagnostics expose the known stage
and cause type at the production catch boundary, retaining the full internal cause;
they do not claim tokenizer detail or universal redaction of every story console.

The watcher regression fails on all four spellings before the patch and passes
after it, including unrelated notifications, descendant notifications, root
replacement, and awaited plugin-scope cleanup. The lockfile change is restricted
to the core patch registration/hash and affected dependency references; frozen
installation succeeds with the release-age policy intact.

**Remaining uncertainty:** the patch establishes a real missed-invalidation bug,
not which native notification sequence caused the historical run. Checkout
generation acknowledgement remains absent. Terminal timeout, original stale-click
remount, and cold-worker internal-stage causes remain historical diagnostic leads;
their fixture/reporting boundaries are hardened rather than assigned speculative
production repairs. PR #28's installation change belongs to its separate branch.

Baseline focused local checks pass: ContextPanel and real-worker stories (23
cases), server/inspection integration (11 cases), and image browser cases (4
cases). These establish current execution surfaces, not that historical races
are gone.

### Candidate verification

Follow-up cleanup review found and repaired a page-disposal race: terminal creation
can start while the page is closing, so settlement is checked after closure and
listeners are detached even if closure fails. Both paths have regression coverage.
The disposable page now captures its own renderer errors; its redundant viewport
and clipboard-method restoration is removed, while shared clipboard permissions
are released. Resize response observers and actions are awaited together to retain
early rejections. Refresh diagnostics derive observed events from required/pending
state rather than maintaining another mutable set.

Local evidence (Node `24.20.0`):

- Root `pnpm check`: passes formatting, lint/types, WDIO types, styles, component
  ownership checks and unused-code checks.
- Root `pnpm test`: passes 1,575 cases across the three fast-tier projects after
  rebasing onto `d768b3b` (the pre-rebase cleanup passed 1,548).
- ContextPanel and real syntax-worker stories: 23 pass.
- Draft storage/controller: 47 pass, including wrong-workspace filtering,
  diagnostic cancellation, saved-agent revalidation and subscription cleanup.
- Runner/inspection integration: 13 pass; the subsequently corrected
  in-acquisition signal gate passes its four inspection cases.
- Images and permission keyboard: five focused browser cases pass. Both
  disposable-page terminal cases pass, including forced early failure, retained
  baseline PTYs, renderer disposal and a usable succeeding scenario. Real draft
  local/worktree flow passes with its prerequisite browser setup.

PR preparation rebased onto `d768b3b`, preserving main's platform/artifact paths,
Linux keyring checks and lint boundaries. Frozen installation, root checks/tests,
and seven focused permission/image/terminal browser cases pass on this result.

The first PR CI run passed fast, integration and both Linux/macOS native jobs.
The static Storybook build passed, but Components failed `Captured Dark` in the
unchanged BrowserAnnotations story with `aria-hidden-focus` after preview closure.
Its nine focused cases pass locally; this is not evidence that the intermittent
failure is repaired. CodeQL flagged two existing environment-derived startup reads
moved by the PR. Those reads now use the existing `runnerPath` validator against
Electron's reported user-data path. The follow-up rebases onto `c3b70d0`.
Frozen installation, root `pnpm check`, all 1,575 fast tests and all 391 component
cases pass locally after this follow-up. Fresh CI is required to establish the
CodeQL result and Linux component outcome.

Full heavier component/integration/build/packaged CI evidence for this candidate
is pending. Packaged native actions were type-checked; their changed diagnostics
were not executed in a packaged app locally. No budget increase or repeated
mutation is used as a repair.

### Complexity accounting

Production (including the underlying pinned-core patch): **+93/-37, net +56**.
Configuration: **+9/-2, net +7**. Tests/stories/fixtures: **+1,422/-372, net +1,050**.
Documentation for the complete PR (including the original report): **+865/-0,
net +865**. Generated lockfile:
**+5/-4, net +1**. Stored patch: **+15/-0**, including its diff envelope; the
underlying core code is already included in the production count above.

No new application runtime/service/coordinator is introduced. New test boundaries
are the terminal fixture's owned resource ledger/page disposal, spawn-owned runner
observation, named acquisition/action diagnostics, and small atomic-readiness
helpers. Removed machinery is split image sampling, transient geometry anchoring,
late child-exit registration, duplicated bare runner spawning and the terminal
scenario's incomplete late `finally`. Remaining growth is concentrated in actual
failure-mode regressions and deterministic ownership/cleanup; it is not a state
mirror of the SDK's application behavior.

---

## Archived original investigation

Original investigation: 2026-10-08, independent session
`ses_ee47ce485ffe7RMh1cCoW3e6d9`, worktree `proud-panda`.
This is an investigation/design deliverable. No implementation, dependency
installation, test execution, branch integration, or changes in another worktree
were performed by this session.

## Findings at a glance

- A substantial reliability repair already exists, **uncommitted in
  `hidden-falcon`**. Reuse its SDK inbox, focus lifecycle, stable transcript-row,
  highlighter-test, and fixture-cleanup corrections.
- **PR #14 merged during this investigation**, as `9df86b8`. Its ContextPanel
  tooltip settlement and ModelPicker pending-switch focus repairs are now on
  remote main. Its tier separation changes verification commands and CI ownership.
- **PR #18 fixes Long Path Tooltip, not Collapse All.** Collapse All has distinct
  missing-disclosure and row-position failures; neither is established fixed.
- Real-worker highlighting and terminal persistence have confirmed intermittent
  failures, but the supplied failures do not establish their causal stage.
- Packaged failures have several different primary causes. PR19's owner already
  implemented the Linux PTY resolver and display-aware resize repairs. A separate
  PR16 startup stale-element failure remains unidentified.
- All ten inspected original dependency-PR platform jobs failed during installation
  on the same release-age policy; they did not execute application tests.

## Coverage, snapshots, and limits

### Source baseline

The investigation checkout remains detached at PR19's original `68f3209`.
Its merge base with the initially fetched remote main is `6627e71`. Relevant
source comparisons and historical logs use these fixed SHAs.

Remote main subsequently advanced to `9df86b8a915e618870acd9eca0be74061b8fe7bb`
through PR #14. Local main initially diverged at `612164c`: five additional UI
integration commits versus eight remote commits. Another session independently
rebased those five commits; local main is now `a2294f2`, also published as PR #22.
This investigation did not perform that rebase or modify PR19.

Future implementation should start from the then-current remote main and preserve
PR19's native evidence separately. Do not reapply old worktree histories merely
because squash/rebase integration leaves their original SHAs outside ancestry.
`git cherry` alone also misses some squash-equivalent multi-commit changes;
PR state and actual source comparison are required.

### Sessions

Code Mode discovery exposed only session move/rename tools, with no list/history
tools. The default CLI exposes a different, older session store. Authenticated
history was nevertheless accessible through the installed desktop V2 CLI:

`/Users/alex/Library/Application Support/ai.opencode.desktop/cli/2.0.24/opencode-cli`

Its actual `/openapi.json` contract was inspected before using project-filtered
session/message endpoints. The complete project metadata traversal returned
**271 sessions, including 89 roots**; the subsequent page was empty. Recent
assistant history was read for **88 other roots and 179 other child sessions**,
covering **2,884 messages**. Five additional older-store sessions not in that
list were exported read-only, covering **108 messages**; four are terminal
reviews and one is a project overview. The four older terminal reviews describe
repairs subsequently integrated with Ghostty, not outstanding implementations.

History inspection is bounded: up to 20 recent assistant messages per root and
10 per child, supplemented by retained tool logs and source diffs. It is not a
claim to have read every historical message. Deleted locations, absent Codex/T3
conversation records, older pages, and unavailable CI DOM/native artifacts remain
coverage limits. Current sources/statuses were inspected for all registered
worktrees, including those with no accessible conversation record.

### Worktrees, refs, and evidence retention

**86 registered worktrees** were inventoried, including detached and Codex
worktrees. All tracked dirty diffs were captured read-only; untracked relevant
repairs were inspected in their owning worktrees. Repository AGENTS.md variants
were read. The initial snapshot had 17 dirty worktrees; the later snapshot had 19
as other sessions continued working. **140 local/remote refs** were classified
by ancestry and patch equivalence at the ref snapshot.

Full evidence is retained under:

`/private/var/folders/0m/8pbhxmdx1c73_s21w3n7pcr40000gq/T/opencode/`

Important index files:

- `test-investigation-inventory.json`: initial 86-worktree snapshot, guides,
  ancestry, filenames, and tracked uncommitted diffs.
- `test-investigation-worktrees-final.json`: later worktree/status snapshot,
  including ongoing PR19 and PR18 changes.
- `test-investigation-refs.json`: all 140 ref classifications.
- `test-investigation-v2-sessions.json`, `test-investigation-sessions.json`:
  session metadata from the two accessible stores.
- `test-investigation-history-*.json`, `test-investigation-v1-history-*.json`:
  bounded histories and older-store exports. These are local evidence, not files
  intended for publication.
- `test-investigation-session-failure-excerpts.json` and
  `test-investigation-log-failures.json`: failure leads and retained-log index.
- `test-investigation-prs-final.json`: one final open-PR snapshot; subsequent
  checks and head changes remain their existing owners' responsibility.

The `linux-ci-test*` local logs are **macOS evidence**, despite their filenames.
The serial-labelled run does not itself prove a one-worker Vitest configuration.
Native Ubuntu evidence is identified by its GitHub job, not by the log prefix.

## Ownership inventory

Paths abbreviated below are under
`/Users/alex/.local/share/opencode/worktree/973cf2/`, unless stated otherwise.

| Work/session                                          | Source and status                                                                                                                      | Relevant ownership/overlap                                                                                                                                                                                                           |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `hidden-falcon`; `ses_ee7cfae28ffeE5rA6vIhfUnPL2`     | Dirty detached `41b208b`; `docs/test-reliability-investigation.md:556–714`, dependency patches and regression files                    | Broad reliability repair already implemented. Latest recorded root test fails only Collapse All geometry; 24 SDK cases, 36 browser cases, and rebuilt 8-case packaged acceptance pass. Root gate is still failed.                    |
| `playful-river`; `ses_ee75cf7b3ffeApmCogzOxYDUyo`     | PR #14, `968afe4`, merged as `9df86b8`                                                                                                 | Tier infrastructure, tooltip settlement, and pending ModelPicker focus. Preserve these when reconciling PR19 workflow and hidden-falcon stories.                                                                                     |
| `shiny-orchid`; `ses_ee4afa46fffeOzWDMqox0QlPdJ`      | PR #18; original `0c30174`, later `72eaa89` merges current main                                                                        | Frame-aligned Long Path Tooltip regression. Reuse original fix; current head's new verification is pending at snapshot.                                                                                                              |
| `brave-planet`; `ses_ee753d36effeI637Bno7iYVoDU`      | PR #19; published original `68f3209`; local native repair `c22e3f4`, rebased to `f3085ce` at snapshot, with a further test-typing edit | Parent owns native CI and packaging. Linux PTY resolver and macOS display-aware resizing are fixed there pending combined verification/publication. Syntax worker is a different resource.                                           |
| `happy-moon`; `ses_ee7542084ffeD82j1DRnHWJisB`        | PR #15; original `608a782`, rebased remote `bba3846`                                                                                   | Focus Shared Treatment waits for exact invalid-field shadow after transition. Existing focused/old full CI passes; new rebased checks pending.                                                                                       |
| `silent-cactus`; `ses_ee7d08328ffeNdh6W8JdDtHVKM`     | PR #13; local `1444292`, rebased remote `0df1d87`                                                                                      | Background process identity/rendering regression work. Its unrelated Long Path Tooltip failure is PR18's ownership.                                                                                                                  |
| `clever-harbor`; `ses_ee7c35d74ffeDRHEL25MpHFW15`     | PR #20; local `f74227e`, rebased remote `efbda0c`                                                                                      | Retry/status feature. Records Virtualized List, Gutter Range Selection, Worker Pool, and inspection-startup failures outside its change.                                                                                             |
| `mighty-wizard`; `ses_ee4a04c6fffe5WLoUtxtZfvnWC`     | PR #21, `6a94a3a`                                                                                                                      | External-image read roots, including drive/UNC casing. Failing-before feature regressions are corrected by this owner, not new flake work.                                                                                           |
| Main/UI integration; `ses_ee4793c94ffeFPrcPkk3clWnGd` | PR #22, `a2294f2`; five rebased commits                                                                                                | Picker typography, provider heading, browser scrollbars, composer/transcript growth, project subtitles. Preserve its rendering/scroll changes when integrating stable transcript rows.                                               |
| `tidy-rocket`; `ses_ee4a0add8ffeJWeC735dV56DmH`       | Dirty detached `612164c`                                                                                                               | Idle/stopped-send placement, uncertain acknowledgement/retry ownership, continuous steering-flash browser regression. Overlaps hidden-falcon ConversationRegion and browser files; SDK patch is complementary.                       |
| `misty-circuit`; `ses_ee7da36c4ffeuXagdLYDOkGbJB`     | Large dirty CSS/UI/test change on `612164c`                                                                                            | Geometry, short panels/composers, pressed feedback, question-card wrapping, nested-list scrolling, suggestion popover. Owner already repairing its new red/green stories. Do not turn its development red logs into duplicate tasks. |
| `curious-tiger`                                       | Dirty detached `8ace437`                                                                                                               | New-session checkout wording/setup and browser assertions; no worker-pool production correction.                                                                                                                                     |
| `hidden-cabin`; `ses_f36dfc262ffevnMywKcEbvjUU1`      | Dirty `refactor/visual-foundations`, `b204105`                                                                                         | Older radius/activity/scenario-lab development; committed foundation changes are patch-equivalent to integrated work. Dirty proposals need reconciliation, not bulk application.                                                     |
| `glowing-meadow`; `ses_f4eae1823ffejXKhc1L5WwHM9B`    | Dirty detached `a88ba2f`                                                                                                               | Older themes/elevation/scenario-lab work; no exact unresolved PR19 repair found.                                                                                                                                                     |
| `native-browser-annotations`                          | Dirty on `08b524e`                                                                                                                     | Browser native/annotation/shared-contract work, overlapping composer and browser-flow files. Preserve owner changes.                                                                                                                 |
| `neon-meadow-upstream`, six `spike-*` worktrees       | Dirty experiments on `83f5711`                                                                                                         | Editor, paste, IME, offset, attachment and Markdown probes. Production prompt-editor integration/consolidation is already on main. Experimental counterexamples are owned design evidence, not main-suite failures.                  |
| `swift-canyon`; `ses_f011e943cffe6wZDpTvJGC7m2O`      | Dirty composer-width demonstration                                                                                                     | User preferred the existing single-row design; candidate wrapping was held out. Historical failure leads are retained separately.                                                                                                    |
| `sunny-harbor`; `ses_f01e2f811ffeqzyK6NyJtt162O`      | Untracked UI audit document                                                                                                            | Audit registry and independent task ownership, not a pending test repair.                                                                                                                                                            |
| `misty-forest`; `ses_ee48cb167ffe9Wic5lKds9uUEZ`      | Untracked Codex Cloud investigation document                                                                                           | No test implementation.                                                                                                                                                                                                              |
| `happy-moon/.opencode/`                               | Untracked metadata                                                                                                                     | Preserved; not counted as a source fix.                                                                                                                                                                                              |

Other registered worktrees include historical integrations, clean snapshots, and
already-integrated feature branches. The complete path/head/status inventory is
in the evidence indexes above. In particular, `gentle-moon` Ghostty (`1f13e63`),
`happy-cabin` highlighting contracts (`9d6d595`), production-only Storybook
cleanup (`032e2f1`), and prompt-editor consolidation (`146ac15`) already precede
PR19/main. The retained branches for PRs #1–5, #11–12, and #17 are historical
integrations even where original branch SHAs are not ancestors.

### Open PR snapshot

The final snapshot includes **#6–10, #13, #15–16, and #18–22**. PR #14 is merged.

- #6–10: dependency updates; original ten platform jobs stopped on installation
  policy. Newly rebased tier jobs include failures/queued jobs; original failures
  are not evidence of executed tests.
- #13, #15–16, #18, #20–22: updated heads have passing and/or pending checks.
  Earlier passes do not certify newly rebased heads.
- #19: original published head's rerun was underway in the final metadata
  snapshot; the parent separately owns newer local repair verification.

## Exact fixes to reuse

| Test/scenario                                                                        | Existing correction                                                                                                        | Classification/status                                                                                      |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `syntax-highlight.test.ts`: concurrent workers and replacement after `messageerror`  | Hidden-falcon waits for `worker.requests`, not construction; adds reported worker error/postMessage failure settlement     | Fixed in uncommitted work; no production highlighter change                                                |
| `syntax-tokenizer.test.ts`: preserves whitespace and changes theme                   | Hidden-falcon checks exact source reconstruction/colors/theme/reuse instead of cold/warm lexical partition equality        | Fixed in uncommitted work; Shiki's bounded cold tokenization makes partition equality invalid              |
| `TranscriptCodeBlock.test.tsx`: real tokens, fallback, disposal, code/theme recovery | Hidden-falcon preinitializes that unit fixture's tokenizer and adds controlled failures/stale results                      | Fixed in uncommitted work; cold real-worker story remains separate                                         |
| Worker Pool story observation window                                                 | Hidden-falcon adds bounded observer headroom to 12 seconds                                                                 | Existing partial correction only: cannot fix a production request that already failed at 10 seconds        |
| Queue/steer/cancel/reload pending messages and transcript exclusion                  | Hidden-falcon pinned SDK cache patch plus 24 real-SDK regressions                                                          | Reproduced cache defects fixed in uncommitted work; retain SDK ownership                                   |
| Queue scenario leaking its held provider turn into annotations/reviews               | Main #2 already added cleanup; hidden-falcon strengthens one hold owner, forced early failure and dual-error reporting     | Reuse both current main and pending strengthening                                                          |
| Review Comments after Escape                                                         | Main #2 uses asynchronous role lookup after Pierre render                                                                  | Already integrated; distinct from other ContextPanel failures                                              |
| Gutter Range Selection readiness                                                     | Hidden-falcon changes a nonthrowing false-return wait into an assertion-based wait                                         | Pending repair of a confirmed helper defect; does not prove every historical gutter failure has this cause |
| GlobalForms Default/Narrow close focus                                               | Hidden-falcon UI patch forwards native close autofocus, tracks opening identity, removes GlobalForms timer                 | Reproduced lifecycle repair implemented and reviewed; pending integration                                  |
| Browser attachment durable update / packaged missing thumbnail                       | Hidden-falcon stable/reactive transcript rows, actual TranscriptView regression, message-scoped packaged click diagnostics | Reproduced remount mechanism repaired; historical thumbnail attribution remains qualified                  |
| Long Path Tooltip single-click disclosure                                            | PR18 frame-phase regression plus awaited `aria-expanded`; PR14 has overlapping settlement fix                              | PR14 is integrated; retain PR18's complementary reproduction coverage                                      |
| ModelPicker focus after pending model switch                                         | PR14 `968afe4`: restores after trigger becomes enabled                                                                     | Now integrated; real production focus defect, not only an e2e wait                                         |
| Branch-picker-to-model-picker focus                                                  | Main #2 `d7e872f` waits for branch close/focus settlement                                                                  | Integrated; preserve alongside ModelPicker production repair                                               |
| Focus Shared Treatment invalid shadow                                                | PR15 `608a782`: awaits final literal neutral color/geometry                                                                | Fixed in open PR; retain exact checks in both themes                                                       |
| Linux packaged worker startup                                                        | PR19 `c22e3f4` / rebased `f3085ce`: resolve `pty-linux-x64-gnu`                                                            | Owned fix pending final integration/verification; distinct from syntax highlighting                        |
| macOS packaged resize                                                                | Same PR19 repair bounds requested content to display work area minus native frame                                          | Owned repair; cascading missing fixtures/PID errors must not become separate fixes                         |
| Idle/stopped send placement and late acknowledgement/retry                           | Dirty tidy-rocket tests and composer placement tracking                                                                    | Reproduced feature workflow repair already owned                                                           |
| External-image navigation and Windows/UNC casing                                     | PR21 `6a94a3a` real browser/path regressions                                                                               | Reproduced feature regressions already corrected/owned                                                     |

## Deduplicated remaining scenarios

"Confirmed" below refers to the failed observation, not automatically to its
cause. A later focused/full pass is retained evidence, not proof of resolution.

| Scenario                                   | Failed boundary                                                                   | Disposition/design                                                                                            |
| ------------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| TranscriptCodeBlock / Worker Pool          | First styled span absent at ten seconds, twice                                    | Cause unresolved; hidden-falcon observation/fallback work is partial coverage. Design A.                      |
| ContextPanel / Collapse All                | Initial first-file disclosure absent; separate transient-baseline geometry 126→62 | Two unresolved manifestations of one scenario, not PR18's tooltip failure. Design E.                          |
| ContextPanel / Virtualized List            | Initial `path(0)` remains undefined at story line 347                             | Confirmed initial render-readiness failure, before virtualization scroll action. Design J.                    |
| ContextPanel / Gutter Range Selection      | Drag on `src/generated/added.ts` produces no selection                            | Confirmed; hidden-falcon readiness helper correction already owned, causal attribution conditional. Design J. |
| Browser terminal retention/navigation/WSS  | Whole test exceeds 180 seconds; precise stage missing                             | No exact unmerged fix found; diagnostics/owned early-failure cleanup first. Design B.                         |
| Inspection cleans up after SIGINT          | Readiness expires before signal                                                   | Confirmed startup failure; shutdown failure unestablished. Design F.                                          |
| Standalone runner occupied port            | Expected exit 1 absent after 15 seconds                                           | Confirmed exit deadline failure; pre-bind versus teardown unknown. Design G.                                  |
| Real permission reply via keyboard         | First card stays visible after Enter                                              | Concrete enabled/focus prerequisite gap; historical causality conditional. Design H.                          |
| Draft local branch/worktree preparation    | Markdown-agent refresh barrier fails before saved-agent validation                | Confirmed barrier failure; server reload/event ordering cause unresolved. Design I.                           |
| Packaged first startup/seed scenario, PR16 | Stale element on unidentified first-scenario click                                | Confirmed primary failure; later missing Model/Prompt/fixtures are dependent observations. Design C.          |

PR19 Linux startup and macOS resize are **fixed-in-owned-unmerged-work**, with
verification pending. Dependency PR failures are **installation blockers, not
executed tests**. Older ChangesRegion/NewSession/localStorage findings remain
historical leads; obsolete stories and intentional editor counterexamples have
the dispositions in J.

## Remaining failure designs

### A. Cold real-worker highlighting

**Confirmed:** PR19 local full runs fail at the initial styled-span assertion after
10,041/10,049 ms; focused story passes in 639 ms. Relevant blobs are identical
between `6627e71` and `68f3209`. No baseline execution was performed. Logs expose
only `[SyntaxHighlightError]`, not its underlying cause. Hidden-falcon's same cold
story later passes in 8,571 ms in a full run; that is useful timing evidence, not
a causal diagnosis.

**Files/owner:** `syntax-highlight.ts`, `syntax-highlight.worker.ts`,
`syntax-tokenizer.ts`, `opencode/connection.ts`, and
`stories/TranscriptCodeBlock.stories.tsx`; renderer runtime owns pool/cache;
story runtime owns its test resources. Coordinate test changes with hidden-falcon.
PR19's OpenCode utility-worker repair is not a syntax-worker repair.

**Minimal design:** retain the actual nested failure at the existing adapter/story
reporting boundary. Distinguish timeout, Worker error/messageerror, reported
tokenizer error, malformed response, and startup/network failure. First use
bounded fixture-level timestamps for construction, posted request, module/network
completion, settlement, and termination; add worker-stage protocol only if this
cannot identify the stalled boundary. Diagnostic listeners use existing callback
cleanup. No new readiness coordinator or retry queue is justified yet.

Keep the production ten-second request budget. Pool acquisition and DOM observation
start at different boundaries; reuse hidden-falcon's observation headroom, but
still fail/report production timeout. Add to the existing fake-timer timeout
case: assert nested `TimeoutError`, termination, successful same-key replacement,
and awaited runtime disposal. Preserve subscriber-aware shared cancellation,
obsolete-result suppression, safe plain source and later-request recovery.

**Targeted reproduction:** one verification owner compares equivalent cold full
conditions on fixed baseline/candidate SHAs, records effective concurrency/cache
conditions, and captures the actual error. Compare bounded concurrency only after
recording those conditions. Cache corruption, duplicate runtimes, and load
causality are unproven; peer variants alone establish none of them.

### B. Terminal persistence / WSS recovery

**Confirmed:** one local macOS scenario times out at 180 seconds; subsequent run
passes in 8,890 ms. Retained original PR19 native CI shows this browser scenario
passing on Ubuntu in 9,628 ms and macOS in 15,253 ms. The failing local log lacks
the stalled stage. Ghostty implementation/lifecycle protections are already on
main; hidden-falcon does not change this terminal scenario.

**Files/owner:** `test/e2e/browser.test.mjs:2668–3003` on `6627e71`, its TLS fixture,
`opencode/terminal-sessions.ts`, retained `TerminalSurface.tsx`, and font cache.
The fixture owns injected faults/routes/sessions; workspace owns terminal records,
sockets and mutations; remote server owns shell processes until explicit close.

**Minimal design:** add named checkpoints for font retry/held font, attachment,
navigation, resizing, reconnect, recreation and cleanup. Bound and cancel bare
scenario API reads through supported SDK request signals. Record surface/tab
status, request/socket state and owned IDs, stripping ticket URL parameters.

Strengthen the scenario's existing `finally`: release held fonts; restore proxy;
remove routes/listeners; reconcile and delete only owned PTYs/sessions; await
cleanup and expose both original and cleanup errors. Current early-failure cleanup
does not remove surviving scenario PTYs/sessions before later sequential tests.
If cleanup cannot settle, the fixture owner must stop dependent work.

An older precise failure occurs at recreated-shell Unicode input, after recovery
passed (`glowing-cabin-linux-uncached-verification.log:3107–3128`). Readline redraw
and incomplete command input do not prove emulator corruption. If reproduced,
compare sent input and resulting bytes; use the existing controlled input script
for the recreated shell, asserting real keyboard/IME bytes on disk and output.

If diagnostics establish terminal recovery exhausts while the TLS proxy waits for
SSE reconnection, synchronize fault/restoration on actual socket/SSE state and
cover bounded versus manual recovery separately. Change production policy only
against an established longer-outage requirement. Do not increase 180 seconds.

**Checks:** forced early-failure cleanup plus subsequent usable scenario; existing
terminal controller/surface/font lifecycle tests; real pinned-server browser
scenario alone, then shared preceding flow. Native acceptance only for affected
production/assets/shutdown changes. Keep one verification owner.

### C. Packaged startup stale element and cascading prerequisites

**Confirmed:** original PR16 macOS job `113304324490`, run `37775243258`, fails its
first scenario on a stale element during a WebDriver click. It then reports
missing Model/Prompt, zero expected fixture sessions, and missing Native fixture
one. `test-investigation-pr16-macos.log:4664–4748` identifies this ordering, but
does not locate the first click. PR16 changes only guidance; no test causality
follows from that documentation change.

PR19's newer native failures are different: Linux never reaches connected state;
macOS fails `resizeWindow` before PID recording/session seeding. Their later
undefined PID/missing-fixture failures are prerequisites, not independent
provider/browser/project/terminal regressions. The parent already owns their
resolver/display repairs.

**Files/owner:** `packaged-startup.e2e.ts` first scenario and
`createBundledSessions`, `wdio.conf.ts:76–83`, existing provider/project/browser
flow prerequisites. Packaged runner owns app/profile/provider lifetime and process
cleanup. Preserve unconditional quit and recorded PID-exit checks.

**Minimal unresolved design:** label each startup/seed click and emit sanitized,
bounded diagnostics at the first failure: selector, target connectivity, selected
session identity, active element, menu/dialog state, acknowledged seed IDs and
owned runtime state. Existing screenshot naming overwrites earlier failure
screenshots; retain stage-specific evidence or bounded output so cascades cannot
erase the primary state.

After establishing the remount boundary, wait on its actual SDK/UI settlement and
query a fresh target immediately before the single action. If stable row identity
is broken, add a targeted identity regression rather than repeated clicking.
Retain acknowledged session IDs and explicit prerequisite state. Dependent flows
should fail promptly with the original setup dependency instead of consuming
multiple unrelated element deadlines. Do not automatically repeat session/project
creation when acknowledgement is uncertain; reconcile through server state.

**Checks:** first startup/seed flow under a controlled list replacement; first
failure evidence survives later failures; valid prerequisites still run all
eight scenarios; failure always quits/settles owned processes. Final existing
packaged suite on the affected platform, through the repository runner.

### D. Dependency PR installation policy

**Confirmed:** all ten original #6–10 Linux/macOS jobs reject
`legacy-javascript@0.0.3`, published `2026-10-08T00:08:53.168Z`, before tests.
For example `test-investigation-pr6-linux.log:225–226` reports
`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`. This shared transitive resolution is
separate from the five requested package updates.

**Minimal design:** dependency-PR owners inspect why each lockfile refresh admitted
that transitive version; preserve the existing release-age policy and unrelated
main lockfile entries. Resolve with an eligible existing version or rerun after
the policy's age window has elapsed, retaining frozen-lockfile verification.
No flaky-test retry or application repair is implicated. Newly rebased tier jobs
must be diagnosed from their own logs rather than inheriting a historical pass.

### E. Collapse All: two different unresolved observations

**Geometry failure:** hidden-falcon's latest root gate captures initial first-row
top **126**, then observes settled collapsed top **62**
(`hidden-falcon-oracle-test.log:770,973–980`). The story captures its initial
position immediately after finding a header. Header existence does not establish
Pierre's height/sticky/scroll reconciliation. Upward movement alone does not prove
the bottom-alignment defect the original assertion intends to detect.

**Initial readiness failure:** PR19's first local run cannot find
`Collapse src/renderer/components/Workspace.tsx` before any collapse action.
Its first `diffs-container` is empty while the second file has a header
(`linux-ci-test.log:895–899,1070–1093,1472–1478`). This is distinct from geometry
and from Long Path Tooltip's post-click render timing.

**Files/owner:** `stories/ContextPanel.stories.tsx:293–316`,
`components/App/ConnectedApp/Changes/ContextPanel/DiffView/DiffCodeView.tsx`,
Pierre 1.2.10's CodeView/FileDiff renderer. Story owns
initialization and layout assertions; DiffCodeView owns its metric adapter;
upstream owns scheduled rendering. The scenario uses Pierre main-thread
highlighting rather than a DiffHighlightProvider. Installed renderer code can
return before publishing a header while missing language/theme assets initialize.
That establishes a possible mechanism, not the failed run's cause.

**Minimal design:** identify the specific first file and viewport; establish both
headers and body/measurement readiness before capture. Assert the intended
settled geometry against the viewport's content start and the collapsed
header-plus-gap contract, preserving per-file expanded states and scroll anchoring.
Record bounded pre/post viewport/row bounds, scrollTop, scaffold/sticky heights,
and header/asset readiness on failure. A longer comparison against a transient
captured baseline is not a correction.

For a layout-focused story, initialize the necessary real Pierre language/theme
resources explicitly before mounting. Keep cold loading/error behavior in its
appropriate integration check. If cold initialization stays in this story, make
it an explicit measured boundary and surface asset/render failures. If settled
metric disagreement survives readiness, correct only the DiffCodeView/Pierre
metric boundary; preserve the existing 8px collapsed-gap regression. No
collapse-state rewrite is justified by a failure before the first click.

**Checks:** existing Collapse All collapse/expand and alignment contract, plus a
controlled delayed first-file initialization and frame reconciliation. Run this
focused story and the full ContextPanel suite on the combined candidate, including
virtualization, gutter selection, review comments and tooltip interactions.

### F. Inspection cleans up after SIGINT: readiness failed first

**Confirmed:** `concise-retry-pr-verification.log:1270–1282` and
`tidy-rocket-gates.log:896–908` fail the **30-second readiness deadline before
SIGINT is sent**. One captures no child output; another reaches Vite scanning and
bundling. Neither failure exercises the cleanup assertion in the test's name.

**Files/owner:** `test/browser-inspection.test.mjs:22–38`,
`test/e2e/inspect-browser.mjs:36–63,97–124`,
`scripts/opencode-server-build.mjs:139–153`. Inspection process owns acquisition
and teardown; test owns its process tree, output, signal and exit observation.
The build-lock acquisition alone permits 120 seconds, exceeding the test's
complete readiness budget. That mismatch is established; a stuck build lock,
optimizer starvation, or a shutdown defect is not.

**Minimal design:** bounded phase start/end diagnostics for build-lock/build,
provider/project, Vite, server, final readiness and teardown. Keep startup failure
separate from post-signal cleanup evidence. If preparation dominates, explicitly
prepare the bundle in the owning fixture, with a separate bounded cold-preparation
check. Do not silently remove cold preparation from verification or merely extend
30 seconds after a focused pass.

Stop during acquisition must retain ownership until settlement; late-acquired
resources must close. If settlement cannot complete, terminate only the owned
process tree and report forced cleanup. Remove disposable state after resources
settle; preserve useful startup failure profiles.

**Checks:** SIGINT/SIGTERM after readiness, controlled interruption during each
relevant acquisition boundary, acquisition failure after earlier resources exist,
late acquisition cleanup, released ports and profile deletion after settlement.
PR14 moved this test into `web`; that movement is not a startup repair.

### G. Occupied-port standalone runner

**Confirmed:** `tidy-rocket-gates.log:874–893` expects exit
`{ code: 1, signal: null }` but receives a **15-second timeout**. Retained earlier
logs repeat this outcome. The piped child stdout/stderr are not consumed/included
in that assertion, so whether the child reached binding is unknown.

**Files/owner:** `test/e2e/opencode-server.test.mjs:276–289`,
`scripts/opencode-server.ts:101–127`, pinned server process/listener implementation.
Fixture owns blocker socket, child, output drains and cleanup; runner scope owns
application/listener acquisition and finalization. Pinned server uses an explicitly
supplied port exactly; there is no evidence that it silently selected another port.

**Minimal design:** drain bounded output from spawn and register exit observation
immediately. Capture whether startup/bind was reached. If bind fails promptly
but scope cleanup hangs, fix that finalizer boundary. If imports/build/pre-bind
work consumed the budget, measure and isolate that stage first. Keep expected
nonzero exit and blocker preservation; add no fallback listener or automatic
restart. Await owned child termination and identify forced versus graceful exit.

**Checks:** binding rejection and exit 1; blocker still usable; no surviving
listener; startup SIGTERM/open-event-stream shutdown remain passing. The same
fixture cleanup must execute when the expected bind failure does not arrive.

### H. Permission card survives keyboard activation

**Confirmed:** `happy-moon-pr-verification.log:749–762` and
`question-drafts-integration-main-baseline.log:768–781` retain the first
`per_acceptance_1` card after keyboard activation. The failure lacks matching
reply-request and active-element evidence.

**Concrete test race:** the test navigates back, focuses Allow once, then sends
Enter without checking that the control is enabled or actually focused.
`selectSession` establishes sidebar selection, not permission hydration. A
rendered card can coexist with disabled reply controls during the fresh read.
The final dump's nonbusy state does not establish readiness at activation time.

**Files/owner:** `test/e2e/browser.test.mjs:1892–1896`,
`Permissions/createPermissions.ts:308–330,399–405`,
`ConversationRegion.tsx:165–170`. Existing workspace permissions owner owns reply,
reconciliation/fences and shutdown; Solid owns focus; test owns one keyboard
activation. Dirty misty-circuit's scrollable card attributes do not repair replies.

**Minimal design:** await enabled state, focus, assert active element, activate
once, observe the matching request/response, then assert both UI removal and
server absence. On failure retain bounded enabled/focus/request/recovery state.
If enabled confirmed focus produces no request, investigate keyboard/remount
behavior. If successful reply/server absence leaves the UI card, inspect the
SDK snapshot/event boundary. Preserve current lost-response reconciliation and
owned settlement; do not automatically repeat a permission mutation.

**Regression:** hold hydration after navigation, release it, and assert exactly
one keyboard reply and UI/server settlement. Existing controller cancellation,
blocked recovery, navigation, lost-response and shutdown tests remain authoritative.

### I. Draft checkout configuration refresh

**Confirmed:** `gentle-river-pr-verification.log:690–734,779–790` identifies the
`markdown-hidden-build-agent` branch and the application message:

> The checkout changed, but its configuration refresh could not be confirmed.
> Nothing was sent.

The later test timeout expects saved-agent unavailability, a validation step that
was never reached. Earlier local/worktree subcases passed. This is an observed
ten-second checkout-refresh barrier failure; delayed/missing reload, watcher
handover, event delivery loss and prior reload ordering remain alternatives.

**Files/owner:** `new-session/submit.ts:163–215,255–258`, current real browser draft
flow, pinned server config watcher/agent plugin. Existing workspace submission,
durable attempt and project mutation lock own Git/preparation/send; server owns
configuration discovery and reload. Dirty curious-tiger/tidy-rocket changes do
not establish a correction for this failure.

**Minimal design:** at the barrier retain branch/commit, complete location,
required/observed event names and a read-only server agent snapshot. The Markdown
subcase needs `agent.updated`. If server already reports `build.hidden=true`,
inspect notification/barrier semantics; if state is old, inspect config/agent
watcher reconciliation, especially `.opencode` creation/removal and debounce.
Events lack checkout-generation acknowledgement; an arbitrary same-location
event is not an authoritative freshness proof. If the repair requires such a
contract, establish it at the server boundary and verify the pinned behavior.
Do not create a renderer state mirror or retry Send.

Preserve successful partial checkout and saved draft on failure. Release
subscriptions/locks on every exit. Navigation cannot abandon application-owned
submission; interruption/shutdown must settle Git/shell work and persist its
interruption status.

**Checks:** relevant reload after checkout; unrelated/prior events cannot authorize
Send; missing notification retains fail-closed message/no session or prompt;
listener cleanup on failure/interruption; four supported Markdown directory
spellings; retained checkout and draft after partial failure.

### J. Virtualized List, gutter, and older leads

`concise-retry-pr-verification.log:796–800,1006–1032` records current-generation
ContextPanel Virtualized List and Gutter Range Selection failures. Virtualized
List fails its initial `path(0)` assertion, before scrolling; it is not evidence
that offscreen window recycling is broken. Gutter fails selection after dragging
`src/generated/added.ts`. Keep both separate from Collapse All and tooltip
post-click settlement.

Hidden-falcon already corrects the false-returning gutter readiness helper, but
historical causality is not proven. Reuse it, then verify actual line/utility DOM
identity and scheduled utility positioning before a single pointer action; retain
range/side assertions. If replacement interrupts an active drag, reproduce that
ordering at the renderer pointer boundary before changing production selection.
Do not add more retries around the existing ten-attempt helper.

For Virtualized List, retain specific item/viewport, rendered-item count, scroll
offset and measurement/asset state at the failed initial assertion. Use the same
explicit real-resource readiness boundary designed in E before testing viewport
windowing. Preserve the full contract: bounded visible items, last item after
scroll, first-item eviction, return-to-start reuse. An independent cold-readiness
failure must remain visible. Do not disable virtualization or enlarge the whole
suite's budgets.

Older remaining evidence has different dispositions:

| Lead                                                                     | Disposition and minimal next design                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ChangesRegion `does not reparse patches when only a review body changes` | Historical retained failures include `curious-tiger-wording-test.log:976`. No current causal reproduction. Hold parsing/initial rendering steady, mutate only the review body, distinguish reparsing from delayed DOM publication, then repair only that boundary if the present implementation fails. Keep parse-count and updated-body assertions. |
| NewSessionFlow `clears the failed session error after adding a project`  | Repeated historical timeout reports; original complete failure artifact unavailable. Observe catalog-ready/project registration/mutation settlement separately in the existing fixture. Retain recovery behavior and clean up owned work; no blanket timeout repair is justified by later passes.                                                    |
| WarmPaper Interactive Review missing comment button                      | The obsolete showcase story was intentionally removed by production-only cleanup. Current real ContextPanel/ConversationRegion stories own useful behavior; do not restore the synthetic app to repair this historical test.                                                                                                                         |
| App/browser-host/appearance localStorage failures                        | Historical 33-failure inventory; old unavailable-storage diagnosis is not newly established. Current corruption/unavailability coverage exists. If reproduced, compare environment/storage descriptor and adapter initialization with current mocks, repair only the actual boundary, retaining persistence/fallback assertions.                     |
| Older style-token/NewSession timeouts                                    | Historical source/tool reports, not an identified current failing candidate. Separate tool startup/traversal from intended assertions before changing their budget or implementation.                                                                                                                                                                |
| Prompt-editor expected failures / codec limitations                      | Superseded spikes and current documented passing corpus contracts, not unnoticed root-suite failures. Compare production package tests before proposing a feature repair; preserve text/skill/offset contracts and do not reintroduce historical duplicate probes.                                                                                   |
| New misty-circuit geometry/wheel/popover development failures            | Owner has focused passing follow-ups; latest retained full gate's sole failure is the tokenizer equality case already repaired in hidden-falcon. Preserve owner work and combine with that correction before declaring another unresolved geometry task.                                                                                             |

## Integration and verification order

1. Start from current remote main. PR14's tier changes and ModelPicker repair are
   integrated. Reconcile PR18's reproduction coverage with the overlapping tooltip
   wait. Preserve PR15's neutral focus literals and transition settlement.
2. Let PR19's parent finish resolver/display repair and native CI. Reconcile its
   workflow with the merged tier workflow; this session does not supervise it.
3. Resolve the independent ContextPanel failures to unblock hidden-falcon's root
   gate. Then integrate its reviewed SDK/UI patches and stable transcript/test
   changes through its owner, verifying combined behavior and exact patch version.
4. Reconcile tidy-rocket's placement tracking with hidden-falcon's pending/cache
   and transcript-provenance work. Preserve PR22's composer/scroll changes and
   misty-circuit's live geometry/editor work. These sessions share files but own
   different behavior; do not bulk overwrite browser.test.mjs or ConversationRegion.
5. Add only remaining causal diagnostics/fixture cleanup for the cold syntax
   worker, terminal timeout, and packaged stale click. Use findings to choose any
   production correction; implementation scope remains a later user decision.
6. Each dependency-PR owner resolves installation separately. Experimental red
   tests remain with their feature owners unless promoted to production.

Before commands, reread `.node-version` on the actual candidate and verify exact
Node (current pin **24.20.0**). This session executed no Node checks/tests/builds
and required no dependency installation. Relevant pinned APIs were inspected in
existing installed worktrees; no Effect code was written.

On a future implemented candidate, run root `pnpm check` and `pnpm test` as required
by its guidance. After PR14 these are the fast/local gates; use current
`docs/app-verification.md` and scripts for affected component/integration/build
tiers and CI evidence. A passing local fast gate is not a full Storybook/browser
pass. Focused heavier reproduction remains justified for these unresolved cases.
Do not manually replay already-passing automated flows without a remaining visual
or native question. Preserve full logs, bounded output, and one verification owner.

Useful proposed focused commands, after the exact Node check and prerequisite
builds, are:

```sh
pnpm --filter desktop exec vp test run --project=storybook stories/ContextPanel.stories.tsx
pnpm --filter desktop exec vp test run --project=storybook stories/TranscriptCodeBlock.stories.tsx
pnpm --filter @oc-ui/opencode-session-tools build
pnpm --filter desktop exec vp test run --project=web test/browser-inspection.test.mjs
pnpm --filter desktop exec vp test run --project=web test/e2e/opencode-server.test.mjs
pnpm --filter desktop exec vp test run --project=web test/e2e/browser.test.mjs
```

Permission/draft/queue scenarios share preceding setup; selecting an isolated
title without arranging those prerequisites is not a useful reproduction.
Current-main aggregate commands are `pnpm test:components`,
`pnpm test:integration`, and `pnpm test:all`; `pnpm ready:ci` additionally builds
all targets. They are proposals for the future owner, not checks run here.
PR19 additionally supplies Linux packaged acceptance; main at `9df86b8` does
not yet contain that command. Use the owner’s integrated candidate for it.

## Change accounting

Production, configuration, tests, and generated code: **+0 / -0 / net 0**.
One documentation report is added. No application abstractions, coordinators,
state mirrors, or existing machinery were added or removed. External evidence
indexes are investigation artifacts, not production/generated repository code.
