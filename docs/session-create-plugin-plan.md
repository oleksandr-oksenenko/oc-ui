# Session creation plugin implementation plan

Status: implemented and verified, 2026-09-12.

## Outcome and agreed contract

Add an OpenCode server plugin in this repository, bundled with oc-ui's built-in
server and separately installable on compatible remote servers. It registers
`session_create`, which starts a fresh, independent session in the same project.
Use only supported plugin APIs; fork support is excluded.

```ts
type Input = {
  prompt: string;
  worktree?: { create: { baseRef?: string } } | { existing: { directory: string } };
  agent?: string;
  model?: { providerID: string; modelID: string };
  variant?: string;
};

type Output = {
  sessionID: string;
  location: LocationRef;
  promptAccepted: true;
};
```

`LocationRef` represents the existing upstream full location contract; reuse its
actual exported type rather than introducing a parallel application type.

- A prompt-only call creates a new worktree from the calling checkout's `HEAD`.
- Agent, model, and variant each inherit the caller's value unless overridden.
  Changing agent must not silently change the inherited model. Validate the
  resolved combination before mutations; do not silently replace an invalid variant.
- OpenCode generates the title and worktree name. No title or context input.
- Existing destinations must be another valid worktree in the same project.
- No parent relationship, copied messages, automatic result notification, or
  lifetime dependency on the caller. Normal destination project instructions apply.
- Return after the initial prompt is accepted, not after the new agent finishes.
- New worktrees contain committed state only. Do not fetch, copy dirty files,
  create a named branch, or apply the UI's origin-default-branch policy.

## Current integration points

- `pnpm-workspace.yaml` already includes `packages/*` and pins OpenCode to
  `0.0.0-beta-19271`.
- The published plugin package supports Effect tool registration through
  `ctx.tool.transform`, and session get/create/switch/prompt plus worktree APIs.
  Its session interface does not expose fork.
- `apps/desktop/src/main/opencode-launch-settings.ts` supplies configuration
  to the library server before startup. It currently supplies empty inline
  content while enabling project configuration and a dedicated config directory.
- `apps/desktop/src/main/opencode-worker.ts` owns the built-in server lifetime.
- `apps/desktop/electron.vite.config.ts`, `tools/stage-opencode.mjs`, and
  `tools/opencode-runtime-packages.mjs` build and stage the library runtime.
- Root `test` currently selects `desktop#test`. Adding a workspace package alone
  will not make its tests part of the completion gate.
- The renderer's `create-session-worktree.ts` implements a different starting-ref
  policy. Inspect its verified upstream calls, but do not import renderer ownership
  or origin-fetch behavior into this plugin.

## 1. Verify the supported boundary

Install dependencies from the existing lockfile. Before writing Effect code, read
the installed Effect AGENTS.md completely and follow required links. Add the
plugin dependency at the exact existing OpenCode version when scaffolding.

Inspect the pinned plugin, schema, and client sources to confirm:

- Reading the actual caller from the tool's session ID, including project,
  complete location, agent, model, and variant. The plugin instance's location
  must not be assumed to be the caller's current location.
- Registered worktree listing, source selection, destination naming, startup
  command settlement, and complete location resolution using supported methods.
- Passing the explicit ref or `HEAD` to worktree creation. The supported plugin
  API does not expose a separate ref-to-commit operation; OpenCode resolves the
  ref during creation. Do not add a private API or shell workaround.
- Creating without a parent, applying the resolved model/variant before prompting,
  automatic title generation, prompt acceptance, and ordinary session events.
- Supported permissions, cancellation, mutation IDs, and recovery reads.
- Local plugin loading and configuration merging in development and packaged
  builds, with no network installation required at built-in server startup.

Record any unsupported required operation as a concrete blocker. Do not substitute
private core imports, an HTTP escape hatch, fork/export/import, or direct database
access. Keep findings narrowly tied to this contract.

## 2. Implement the workspace package

Create `packages/opencode-session-tools` with an ESM plugin entry, input/output
schemas, one creation workflow, and focused tests. Use
`@opencode-ai/plugin/effect` pinned alongside the other OpenCode packages.

The plugin registers the tool; the workflow owns validation and creation ordering;
OpenCode owns sessions, worktrees, model execution, and persistent state. Use the
host plugin scope and native Effect primitives. Do not compose an extra runtime,
session store, background-job system, or generic orchestration framework.

Workflow:

1. Decode input, read caller state, resolve independent defaults, and check
   permissions and model/agent compatibility before allocating resources.
2. Validate an existing registered destination or prepare a new worktree from
   the selected source ref. Reject non-Git or cross-project destinations
   clearly rather than falling back to the caller's directory.
3. Wait for worktree readiness, preserving complete location context.
4. Create a standalone session with the resolved selections and no parent.
5. Submit the initial prompt exactly once within the confirmed operation.
6. Return its ID and location when acceptance is confirmed.

### Lifetime and failure policy

The plugin owns the creation operation until settlement; the server owns the new
session after creation. Caller cancellation must not interrupt the new session.
Forward cancellation to interruptible reads and supported external operations.
For mutations already dispatched, use supported settlement/reconciliation and
bounded critical sections rather than treating cancellation as proof of failure.
Await owned cleanup during plugin/server shutdown; independence does not imply
survival of server shutdown.

Failures identify the stage, whether its outcome is confirmed or uncertain, and
any known worktree location or session ID. Retain created resources after partial
failure. Do not add forced deletion, automatic mutation retries, or rollback that
could remove work used by another session. If upstream supports stable mutation
IDs, use them for reconciliation; do not claim retry idempotence without evidence.
No new public retry/resume API is included in this slice.

## 3. Load and package it with the built-in server

Add the package to the desktop's workspace dependencies and existing build graph.
Resolve and load its built ESM entry through the launch configuration using the
pinned supported plugin mechanism. Preserve user/project configuration and existing
plugins; verify merge behavior and avoid duplicate registration.

Update runtime bundling/staging so plugin files and necessary dependencies resolve
inside the installed app, without source-checkout paths or downloads. Keep the
plugin version aligned with the staged server. Extend existing launch-settings and
runtime-packaging tests to cover loading, resolution, and configuration preservation.

Use normal upstream session events and the existing catalog for visibility. Do not
add renderer state, IPC, a new tool-result UI, or change the new-session dialog.
Any discovered visibility regression must be explained before expanding scope.

## 4. Verification

Integrate package checks/tests into the existing root gates and build graph;
check discovery explicitly, including the existing `ready` command. Extend the
current test tooling rather than creating a parallel permanent verification command.

Focused tests cover:

- Prompt-only defaults; independent agent/model/variant overrides; invalid
  combinations rejected before mutations.
- Source `HEAD` and explicit refs; existing worktrees; invalid, same-checkout,
  cross-project, missing, and non-Git destinations.
- Worktree readiness before session creation; selections before prompt acceptance.
- No parent or caller history; initial prompt delivered once on success.
- Failure and uncertain acknowledgement at each mutation boundary, retained IDs
  and locations, cancellation ordering, and plugin/server shutdown settlement.

Extend the existing scripted-provider acceptance fixtures so a real model tool
call invokes `session_create`. Verify the persisted independent session, project,
destination, selections, prompt, and resulting worktree against the pinned server.
Have the spawned fixture response finish without spawning again. Exercise caller
completion/interruption without cancelling the independent session.

Use browser acceptance for visibility through the existing session catalog and
packaged WebdriverIO acceptance for automatic plugin loading and packaged paths.
Reuse disposable profiles, repositories, provider, logs, and process cleanup.
Do not use personal projects or live provider credentials.

Required final commands: `pnpm check`, `pnpm test`, `pnpm build`, and
`pnpm test:acceptance:mac`, following [App verification](app-verification.md).
Run the relevant focused suites during development. No DMG delivery is required.
Report blocked checks accurately and retain full logs with bounded summaries.

## 5. Remote setup and completion

Document building and installing the standalone package, exact compatible
OpenCode version, server-side plugin configuration, reload/restart requirements,
and verifying that the tool is available. Explain defaults, independent lifetime,
committed-only worktrees, and retained resources after partial failures. Remote
installation remains an explicit server-administration step; oc-ui does not push
plugins to connected servers.

Completion requires verified tool behavior through supported APIs, automatic loading
in a packaged app, package tests included in root gates, and remote setup instructions
checked against the produced package. Report production lines added/removed/net,
tests/docs/generated changes separately, new abstractions, and any superseded code.
Expected growth is one plugin package and narrow launch/build integration; no old
coordinator is being replaced by this additive feature.

## Implementation results

The package is `packages/opencode-session-tools`. Its scoped Effect tool validates
selections and locations, creates or reuses a worktree, creates a session without
a parent, and submits only the supplied prompt. Creation survives caller
interruption; plugin shutdown owns cleanup. Mutations are never retried and
partial failures retain resources with diagnostic metadata.

The pinned standalone CLI embeds its own Effect copy, so tool input/output use
Standard Schema wrappers without Effect AST fields. This avoids private parser
sentinels crossing runtime copies. New locations can briefly expose an empty agent
catalog; the tool repeats only that read for up to five seconds before failing.

Desktop builds emit the plugin beside the worker. The packaging resource map
copies it outside ASAR, and launch configuration supplies its absolute directory
URL. The existing session catalog receives the resulting upstream events. No
renderer state, IPC, or coordination service was added or replaced.

Verification on the implemented source:

- `pnpm check`: passed without warnings or errors.
- `pnpm test`: 12 plugin tests and 775 desktop tests passed, including browser
  acceptance against the pinned server and a scripted provider.
- `pnpm build`: passed.
- Standalone archive: built with `pnpm pack`, installed in an isolated directory
  with lifecycle scripts disabled, and imported successfully.
- `pnpm test:acceptance:mac`: all six flows passed, including delivered plugin
  files, active plugin inventory, the model tool call, independent session
  execution, shutdown, and restart. The runner also verified the app signature.

Remote setup is documented in the package README. Live provider behavior and
remote installation on another operating system were not exercised.

## Simplification

The workflow now converts upstream failures once, at its outer error boundary.
One location resolver owns project membership, agent availability, and startup
readiness for both source and destination. Existing destinations are resolved
once. Worktree inventory refresh/list runs only when reusing an existing worktree.
Ownership, mutation settlement, retained-resource diagnostics, input/output, and
all regression tests remain in place.

A shared build recipe replaces the two esbuild configurations. The executable
plugin no longer has a declaration-emission pipeline. Its runtime dependency is
only Effect; OpenCode packages are bundled from development dependencies. The
isolated archive installation decreased from 282 packages to 9 and still imports
successfully. Root type checking remains enabled for the source and shared build.

After simplification, root checks, all 787 tests, the build, and all six packaged
macOS acceptance flows passed again. Production/build edits add 117 lines and
remove 137 (net −20); the existing regression tests are unchanged.
