# OpenCode beta 19271 upgrade

Updated 2026-09-11 from `0.0.0-beta-18866` to `0.0.0-beta-19271`, the npm
`beta` tag at inspection time. CLI, client, schema, server, UI, util, release-age
exceptions, and the runtime version check move together. Effect remains
`4.0.0-rc.112` and Kobalte remains `0.13.13`, matching upstream requirements.

The [published release](https://github.com/anomalyco/opencode-beta/releases/tag/v0.0.0-beta-19271)
has no written changelog. This selection comes from the 317 commits between the
source revisions recorded by the [18866 publishing run](https://github.com/anomalyco/opencode/actions/runs/33583347688)
and [19271 publishing run](https://github.com/anomalyco/opencode/actions/runs/34161100416):
[519cd8c to 013ded3](https://github.com/anomalyco/opencode/compare/519cd8c7712fc2ca6d2ca1d356d7f52cbd6d5808...013ded3743eb9c198d8f544afdfd60fdad1e68a4).

## Changes relevant to oc-ui

- **Worktree APIs now use a location.** Create/list/remove/refresh derive the
  project from the request location; `projectID` is removed. Worktree defaults
  can be configured, and plugins can supply strategies. oc-ui retains its
  explicit Git strategy, destination, and immutable starting commit. Creation
  now supplies the source directory as the location. Cleanup lists using the
  session directory and removes using the registered worktree root as its
  location. Existing ownership, cancellation, uncertain-result handling,
  survivor checks, and workspace exclusions remain in place.
  [Upstream change](https://github.com/anomalyco/opencode/pull/47358).
- **More resilient event streams.** The SDK detects a stream receiving no bytes
  for 45 seconds and reconnects it; keepalive frames count as activity. oc-ui
  uses this connection helper, so it inherits the watchdog. The same upstream
  change adds foreground/network resync when `pageLifecycle` is enabled;
  oc-ui does not currently enable that option, so that portion is an adoption
  opportunity. [Upstream change](https://github.com/anomalyco/opencode/pull/47571).
- **Less duplicate SDK work.** Location reads are shared, catalog refreshes are
  coalesced during event bursts, and streamed message updates target the
  affected message directly. These changes reach oc-ui through its existing
  SDK data store. [Shared reads](https://github.com/anomalyco/opencode/pull/46831),
  [catalog refreshes](https://github.com/anomalyco/opencode/pull/47561),
  [message updates](https://github.com/anomalyco/opencode/pull/46924).
- **Long-session recovery and compaction.** The server preserves more context,
  settles abandoned compactions before resuming, retries transient failures,
  and adds persistent provider-side compaction context plus automatic
  scheduling. Useful for long coding sessions; no new oc-ui control is added.
  [Recovery](https://github.com/anomalyco/opencode/pull/47178),
  [provider context](https://github.com/anomalyco/opencode/pull/47322),
  [automatic compaction](https://github.com/anomalyco/opencode/pull/47324).
- **Provider compatibility.** Codex GPT versions compare by major/minor,
  GPT prompting is updated, Bedrock can use the AWS default credential chain,
  and MiniMax and Meta providers are added. These are server capabilities;
  live provider credentials were not used in this upgrade's tests.
  [Codex models](https://github.com/anomalyco/opencode/pull/47404),
  [prompts](https://github.com/anomalyco/opencode/pull/47447),
  [Bedrock](https://github.com/anomalyco/opencode/pull/47436),
  [MiniMax](https://github.com/anomalyco/opencode/pull/47827),
  [Meta](https://github.com/anomalyco/opencode/pull/47826).
- **Plugin and MCP reliability.** Failed plugin transforms disable the plugin,
  local helpers can reload without restarting, MCP initialization retries
  without Code Mode on HTTP 400, and MCP skill authentication routes through
  the UI. [Plugin failures](https://github.com/anomalyco/opencode/pull/47083),
  [MCP compatibility](https://github.com/anomalyco/opencode/pull/47507),
  [skill authentication](https://github.com/anomalyco/opencode/pull/47738).
- **Session and resource handling.** Sessions whose directories disappeared can
  be deleted, active executions are interrupted and settled before inactivity
  eviction, and the server log is bounded by trimming old content. Relevant
  to removed worktrees and long-running embedded servers.
  [Missing directories](https://github.com/anomalyco/opencode/pull/47774),
  [inactivity cleanup](https://github.com/anomalyco/opencode/pull/47629),
  [log bounds](https://github.com/anomalyco/opencode/pull/47676).
- **Shared comment controls.** Upstream adjusts comment cancel styling and
  active comment options; oc-ui imports `LineComment` for transcript annotations.
  [Cancel styling](https://github.com/anomalyco/opencode/pull/46743),
  [active options](https://github.com/anomalyco/opencode/pull/46747).

Upstream also adds browser tabs, session search, timeline settings, and desktop
SQLite persistence. Those live in upstream app/desktop code and are not added
to oc-ui by upgrading these packages. The session-ui diff/Markdown performance
work is likewise a reference for future work; oc-ui owns its transcript and
uses Pierre for review diffs.

## Local compatibility changes

The production migration changes the pin and worktree request arguments.
The server start test doubles also implement the new `updateAvailable` and
`updated` callbacks; oc-ui does not opt into automatic server updates.
Existing worktree tests now assert location-based requests, including cleanup
across projects and removal through the registered root directory.

## Verification

- `pnpm check`: passed (type, lint, formatting, styles, component layout, unused code).
- `pnpm test`: 91 files, 759 tests passed, including Storybook and all eight
  real-server browser acceptance scenarios.
- `pnpm test:acceptance:mac`: production build, binary staging, package signature
  and architecture checks, and all five packaged Electron scenarios passed.
  This covers connection persistence, prompts/forms/cancellation, annotations,
  reviews, worktree creation/removal, reload, restart, and owned-process shutdown.
- `pnpm opencode:version`: `opencode2 v0.0.0-beta-19271`.
- `git diff --check`: passed.

The browser permissions setup initially failed twice in the full suite but
passed alone: a live UI could reload the location being evicted. The fixture
now unloads the UI while preparing the unavailable historical directory and
reconnects afterward. The eviction, missing-directory, permission discovery,
and saved-approval revocation assertions are preserved; the full suite passes.

Tests used disposable state and a scripted provider. Live provider behavior,
Windows/Linux packaging, historical database migration, and full visual
regression were not verified. The macOS app is ad-hoc signed, not notarized.
Dependency installation used the available pnpm 11.19.0; the manifest still
specifies 11.23.0. Peer warnings remain for Storybook/Vite+ and
bun-ffi-structs/TypeScript; neither prevented the checks or packaged tests.

Full logs: `/tmp/ocui-opencode-check.log`, `/tmp/ocui-opencode-test.log`, and
`/tmp/ocui-opencode-packaged.log`.

Production code: 7 lines added, 5 removed, net +2. Tests: 35 added, 16 removed,
net +19. Workspace configuration: 25 added/25 removed. Generated lockfile:
215 added/184 removed, net +31. Documentation is counted separately. No new
production abstraction or coordinator was added; obsolete project-ID request
arguments were replaced. Growth comes from location arguments, updated server
test doubles, and isolating the browser fixture.
