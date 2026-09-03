# OpenCode beta upgrade evaluation

Evaluated 2026-09-02: `0.0.0-beta-18155` to `0.0.0-beta-18866`.
Recommendation: upgrade before implementing automatic worktrees. The required
compatibility changes are small and were validated in a temporary checkout.
Adopted as commit `ee1735a` on 2026-09-02. The task checkout now pins beta
`18866`; root checks, all 467 tests, and production build passed again using
the declared pnpm `11.23.0`. The findings below record the preceding trial.

## Benefit for automatic worktrees

The new `worktree.create.branch` input accepts an immutable commit ID as well
as a branch ref. A live server test confirmed direct detached creation at that
commit, automatic naming, and an unchanged dirty source checkout. This removes
the separate shell checkout and its failure/rollback path from the existing
design. The initial checkout is at the selected commit before any configured
startup command runs; the API returns success after that command succeeds.

```ts
await api.worktree.create({
  projectID,
  strategy: "git",
  from: sourceRoot,
  directory: automaticParent,
  branch: fetchedCommit,
});
```

The API still requires the parent directory and does not fetch from origin.
Shell preparation remains necessary for the server's XDG directory, cached
default commit, and fresh-fetch attempt. No OpenCode fork or additional server
endpoint is needed. `vcs.base` and `vcs.branches` are read operations.

## Smallest coordinated change

| Area                                                 | Trial adjustment                                                                                                                               |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenCode CLI, client, UI, transitive schema/protocol | Align at beta `18866`; update the existing catalog, release-age exclusions, lockfile, and shared version constant.                             |
| Effect                                               | `4.0.0-rc.111` to `4.0.0-rc.112`, matching the new client's exact peer requirement.                                                            |
| Kobalte                                              | `0.13.11` to `0.13.13`, matching the new UI package so the app and UI share one primitive implementation.                                      |
| Event bridge                                         | Derive a local mapped event type from upstream `OpenCodeEvent`, matching the new Solid data callback contract. No runtime event logic changes. |
| Project selection type                               | Use upstream `Project["vcs"]`; the field now permits arbitrary strategy strings. Existing Git-only worktree checks remain valid.               |

The retained trial patch changes six files: `pnpm-workspace.yaml`,
`pnpm-lock.yaml`, the desktop package manifest, `shared/desktop-api.ts`,
`opencode/event-source.ts`, and `NewSessionDialog.tsx`.
There is no vendor patch, focus workaround, new dependency abstraction, or
change to tests to make the upgrade pass.

### Why Kobalte must move with the UI

An initial trial left the app on Kobalte `0.13.11` while the UI loaded `0.13.13`.
The project picker was visible but inaccessible to the dialog's focus handling:
focus stayed on the outer Close button, and the popup was absent from the
accessibility tree. One Storybook interaction test failed consistently.

Aligning the app at `0.13.13` reduced the installation to one Kobalte version
and fixed both the automated test and the Electron behavior. No change to
OpenCode's dialog source was needed. An upstream dialog-modal change was also
observed, but it was not established as the cause; dependency alignment alone
was sufficient.

## Validation results

| Check                                         | Result                                                                                                                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unchanged `18155` baseline, root `pnpm check` | Passed.                                                                                                                                                                               |
| Unchanged baseline, root `pnpm test`          | 70 files, 467 tests passed.                                                                                                                                                           |
| Final coordinated trial, root `pnpm check`    | Passed.                                                                                                                                                                               |
| Final coordinated trial, root `pnpm test`     | 70 files, 467 tests passed.                                                                                                                                                           |
| Final production build                        | Passed.                                                                                                                                                                               |
| Exact binary packaging/staging validation     | Passed for beta `18866`, macOS ARM64.                                                                                                                                                 |
| Actual Electron smoke test                    | Connected to the exact new server; project search received focus, accepted typing, showed its empty state, restored trigger focus on Escape, and refocused search on keyboard reopen. |
| Isolated server worktree probe                | Commit ID and `origin/trunk` both created detached worktrees directly; generated names, listing, invalid-ref rejection, session create/get/delete, and forced removal passed.         |
| Isolated persistent-data upgrade probe        | A project/session created by `18155` remained readable under `18866` with the same IDs, title, and location.                                                                          |

The final Electron smoke test explicitly verified its process environment,
profile arguments, server version, and open database path under temporary
directories. It used the repository's `pnpm dev` entrypoint. All trial app and
probe servers were stopped afterward.

The initial trial used pnpm `11.19.0`; adoption was rechecked with the declared
`11.23.0`. The existing
Storybook/Vite+ peer-range warning also occurs independently of OpenCode and
remains outside this upgrade; the new Effect mismatch was resolved.

## Limits and operational findings

- This is a macOS ARM64 evaluation. Windows/Linux runtime compatibility,
  arbitrary historical databases, and database downgrade compatibility were
  not established. The migration probe used synthetic project/session records,
  not a copy of the user's full history.
- The new server can run configured worktree setup scripts. The fixture had no
  setup script, so script success/failure behavior was not exercised. The
  automatic-worktree implementation must retain any reported created path on
  a late creation failure.
- Client SSE subscription sharing/replay and background-service PTY handoff
  changed upstream. Existing connection/service tests and the app connection
  smoke test passed; this is not an exhaustive reconnect/terminal audit.
- Full visual regression testing and packaged-app acceptance were not run.
  The Electron checks above specifically covered the observed focus risk.

### Development-launch isolation incident

Early smoke launches were not fully isolated: electron-vite overwrote an
environment-supplied argument list, and the task runner stripped inherited XDG
variables. One trial used the normal Ocui profile and a later trial server
opened the normal OpenCode database. Those processes were stopped; the normal
profile's original beta `18155` server was restored and its health verified.
No user prompts, session deletions, or intentional data edits were performed,
but these runs must not be described as having avoided the user's database.

The final smoke launch passed explicit profile arguments and set HOME/XDG in
the task command after the task runner's environment filtering. Process and
database-file inspection verified the isolation before UI checks continued.
Launch-only script changes were removed from the retained candidate patch.

## Retained evidence

Temporary evaluation root:
`/var/folders/0m/8pbhxmdx1c73_s21w3n7pcr40000gq/T/ocui-beta18866-eval-ifq0mow0`.
It contains `checkout/`, the unchanged `baseline/`, `candidate.patch`, check/test
and build logs, and before/after focus screenshots. The evaluation checkout is
detached at the task's base commit `fd06a36`; nothing was committed or merged.

Server probes: `/tmp/ocui-beta18866-probe.py` and
`/tmp/ocui-beta18155-to-18866-session-migration.py`.
The new Darwin ARM64 binary SHA-256 is
`57662acc39c1436358f16d486686feb5373f5eaf36c966977b4f2417ed0970db`.

Upstream references:

- [Merged worktree starting-ref support](https://github.com/anomalyco/opencode/pull/44906)
- [Merged read-only VCS base inference](https://github.com/anomalyco/opencode/pull/46031)
- [Published beta 18866](https://github.com/anomalyco/opencode-beta/releases/tag/v0.0.0-beta-18866)

The updated [automatic-worktree design](managed-worktree-design.md) passes the
captured commit through `worktree.create.branch` and removes the post-creation
checkout and its rollback step. Fetch fallback and last-session cleanup
requirements are unchanged; automatic-worktree behavior is not implemented yet.
