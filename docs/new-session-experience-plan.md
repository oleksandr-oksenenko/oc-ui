# New-session experience implementation plan

Status: UI, persistent drafts/navigation, checkout preparation, session creation,
and first-message submission are implemented.

The draft slice replaces the dialog with the approved centered composer, supports
multiple saved drafts, restores text/skills/files/choices from IndexedDB, and keeps
navigation available. It reuses the workspace, Composer, SessionRow, and Add Project
browser. The old creation dialog, coordinator, styles, stories, and obsolete tests
have been removed. The existing worktree boundary now accepts the selected starting revision.

See [persistent drafts and workspace navigation](new-session-drafts-design.md)
for ownership, the implemented contracts, and verification evidence.

Send and session creation are implemented in [the submission slice](new-session-send-design.md),
including its ownership, failure handling, and self-review.

## Outcome and agreed behavior

Replace the New session dialog with a centered composer in the main area. A
muted, rounded panel above it contains Project, Local / Worktree, and Branch,
following the supplied Codex screenshot. Do not add an environment control.

- Reuse the existing composer, attachments, agent/model controls, and keyboard
  behavior. Move to the normal conversation layout after successful setup.
- Remember the previous project and branch; remember Local / Worktree per
  project, initially Local. Revalidate remembered choices; never silently use
  a different branch when a remembered branch is unavailable.
- Offer local branches only. Local mode switches the actual server checkout
  using ordinary Git behavior, without force or automatic stashing. Local also
  allows creating a named branch from the repository default branch.
- Worktrees always remain detached. Their branch control selects the starting
  branch/commit; it does not offer branch creation.
- Apply checkout changes and create resources only on Send. Capture and lock
  the submitted content and choices, and disable repeat submission.
- Keep the composer centered while preparing, with a spinner and readable
  status. Navigation remains available. A preparing draft also shows progress
  in the sidebar. Background completion must not steal selection or focus.
- Support multiple drafts in a Drafts section above the sessions. A fresh
  untouched composer need not create a stored row. Text or attachments make a
  meaningful draft; attachment-only drafts need a useful fallback title.
- Persist draft content, attachment bytes, skills, and setup choices across
  restart. Draft labels use the first line or an attachment fallback, without a
  project label in the row. Provide explicit
  deletion for idle drafts; do not let deletion abandon a running operation.
- On worktree creation failure, preserve the prompt, leave any server resources
  alone, and notify the user. Do not add worktree cleanup or recovery machinery.
- Restart and server switching interrupt unfinished setup. Restore an
  interrupted notice, not an automatic retry or resubmission.
- Use a small reusable IndexedDB Effect service. Leave existing localStorage
  preferences unchanged. Protect shared drafts against conflicting browser tabs.

Windows worktree support, remote branch tracking, environment selection, named
worktrees, multiple retained server connections, and automatic recovery are out
of scope. This feature does not make every existing conversation draft durable.

## 1. Establish the implementation base

- [x] Inspected checkout status and ancestry; preserved the existing plan.
- [x] Rebased onto local main at `79ea98e`, including the merged default-branch
      worktree preparation fix and shared Warm Paper design.
- [x] Reuse that default-branch policy. For an explicitly selected local branch,
      resolve that branch to a commit at Send; do not replace it with the default.
      Default-branch resolution is needed for new Local branches and initial choices
      without remembered state. Use the current branch for a first Local selection;
      use the detected default for a first Worktree selection. Represent an existing
      detached checkout honestly, without inventing a branch name.
- [x] Read the installed Effect AGENTS.md completely before writing Effect code.
      Verify unfamiliar APIs against the installed source. No dependency upgrade is
      required for branch mutations; the investigated newer SDK lacks those APIs too.

## 2. Define ownership and small interfaces

Keep the concrete caller operations simple: load drafts for a server, save a
draft at its expected revision, delete an idle draft, and submit a captured draft.
These are draft-feature operations, not a generic repository framework.

| Responsibility                                               | Owner                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------- |
| Open/close database, transactions, storage errors            | One renderer-runtime Effect storage service             |
| Draft records, attachment references, revisions, preferences | Draft feature using that service and atoms              |
| Preparation and first-message submission                     | Connected workspace scope, independent of view lifetime |
| Draft/session selection                                      | One explicit workspace selection model                  |
| Sessions, optimistic messages, reconciliation                | Existing OpenCode SDK store/helpers                     |
| Focus, menus, layout, editor interaction                     | Solid components                                        |

- [x] Add only database operations required by current callers. Use one initial
      schema version and ordinary IndexedDB upgrade handling; no migration framework,
      pluggable backends, generic repository classes, or speculative storage APIs.
- [x] Persist plain validated data: stable draft ID, revision, timestamps,
      server identity, complete project location, existing/new branch choice, mode,
      text, skills, attachment IDs, and agent/model/variant.
      A branch-choice union is justified because creation is valid only in Local.
- [x] Add submitted-attempt details with the Send workflow.
- [x] Identify the built-in server independently of its ephemeral port. Remote
      identities use the normalized configured server origin. Scope remembered
      project/branch/mode choices accordingly; never persist credentials.
- [x] Separate metadata from attachment bytes within the same database, with
      atomic updates where their consistency matters. Load bytes only for an opened
      or submitted draft. Retain existing attachment admission limits.
- [x] Serialise saves and check revisions transactionally. Prevent a delayed save
      from resurrecting a deleted draft. Show storage failures and retain in-memory
      edits. Do not rely on an unload callback to save.
- [x] Confirm the submitted snapshot is durable before starting a server mutation,
      and prevent delayed edits from resurrecting a submitted draft.

## 3. Implement persistent drafts and cross-tab ownership

- [x] Connect draft hydration to server selection. Keep stored records when the
      connected workspace is disposed.
- [x] Save edits and selections continuously, tracking save status internally
      and showing failures without a permanent Saved/Saving label. Flush
      pending changes on controlled navigation. Acknowledging a
      saved snapshot requires transaction completion, not merely an enqueued write.
- [x] Use revision checks for edits and
      BroadcastChannel notifications to reread committed records. Subscribe before
      initial loading and reread on activation so missed notifications are harmless.
- [x] On conflicting edits, preserve unsaved text and files, with explicit actions
      to keep a separate copy or use the saved version.
- [x] Flush before Send and acquire a per-draft Web Lock. Reread revision and state after
      acquiring the lock. A released lock does not clear an in-progress marker.
      Do not interpret another tab's active attempt as interrupted merely because
      this tab has just loaded.
- [x] Distinguish active preparation from an abandoned attempt using actual lock
      ownership. Mark abandoned work interrupted without performing server actions.
      Recheck state under the lock before any user-initiated subsequent attempt.
- [x] Delete draft metadata and its attachment bytes together. Handle denied
      storage, quota errors, and unreadable records visibly. Use ordinary database
      lifecycle handling; defer custom upgrade UI until a schema upgrade exists.
      Do not automatically evict user drafts to make room.

## 4. Replace the singleton creation workflow

Use these observable stages, represented by one operation state rather than
parallel booleans:

`editing -> saving submission -> preparing location -> creating session -> sending`

Preparation displays “Preparing worktree…” or the applicable Local checkout
status. Expected failures and interrupted operations retain the submitted data.

- [x] Replace the single open `NewSessionFlow` controller with draft-keyed
      operations. Use workspace-owned fibers; unmounting a view must not interrupt
      accepted work. Cancel obsolete project/branch/catalog reads.
- [x] Resolve and validate local branch refs on the server. The SDK's mixed
      local/remote name list alone cannot reliably establish local-ref identity;
      use verified local refs rather than guessing from slash-separated names.
- [x] Keep shell handling at one server boundary. Validate branch names and
      quote arguments; preserve complete location context. Reuse the existing shell
      completion/error handling rather than creating another coordinator.
- [x] Serialise conflicting checkout/preparation operations for the same server
      project. Recheck Git state at execution time. This coordinates oc-ui operations;
      it does not lock out other Git tools or make Local sessions isolated.
- [x] Keep native worktree creation, configured startup, and returned location
      authoritative. Preserve capability restrictions for logical workspaces and
      unsupported shells. Non-Git projects use Local without a branch control.
- [x] Persist an attempt marker before mutation and a generated session ID before
      passing it to SDK session creation. Save returned locations/IDs when known.
      An ID or missing response is not proof of resource creation or absence.
- [x] On worktree failure, terminate this attempt and notify; no automatic retry,
      deletion, or recovery. Switching servers/shutdown stops dependent steps and
      settles owned I/O/cleanup where possible; uncertain remote results remain
      interrupted. Never claim cancellation rolled back the server.
- [x] Keep the draft until its content is safely admitted to the created session.
      Associate a failed first message with that session and preserve its saved
      payload. A later send must not create a second session. Unconfirmed slash
      commands require inspection rather than automatic replay.

## 5. Reuse submission without depending on selection

- [x] Refactor the existing composer submission path to accept a specific session
      and immutable payload. Keep the selected-conversation adapter as a thin caller.
      Do not temporarily select a session merely to call its send method.
- [x] Remove the global active-send bottleneck where it prevents an unrelated
      background first message. Retain per-session admission guards and SDK message
      IDs/echo reconciliation. Do not duplicate SDK optimistic state.
- [x] Resolve commands, skills, agent, and model against the intended location,
      not whichever session is on screen. Revalidate at the prepared location; branch
      contents can change project-provided configuration. Report unavailable choices
      instead of silently changing the submitted intent.
- [x] Split session admission from selection. When the viewed draft completes,
      transition to its conversation; otherwise update the list and notify without
      changing selection. Keep existing conversation drafts untouched.

## 6. Build the controlled UI and remove superseded machinery

- [x] Add controlled Storybook states for the centered composer and compact
      project/mode/branch panel before connecting server mutations. Match the supplied
      screenshot's structure and density using existing oc-ui tokens and primitives.
- [x] Reuse Composer, upstream menus/list/popover/icons, and Add Project's
      server-directory browser. Preserve paste, attachments, IME, keyboard, and
      accessibility behavior. Add an explicit input lock for submitted drafts;
      disabling the Send button alone does not freeze the current editor.
- [x] Add Drafts above session groups in the shared sidebar scroll area. Include
      filtering, meaningful empty states, progress/error labels, and deletion. Keep
      drafts available even when the server session catalog is loading or fails.
- [x] Extend selection to distinguish draft/session. Ensure titlebar, right-side
      panels, browser, and context actions never show a previous session as if it
      belonged to the selected draft. Returning to a session restores its context.
- [x] Replace modal opener/dismiss/focus assumptions with navigation behavior.
      Preserve Add Project as a separate dialog and return to the originating draft.
- [x] Remove the old NewSessionDialog, its obsolete stories/styles, singleton
      new-session state, and superseded coordinators. Preserve useful test scenarios
      by moving them to the new owner. Keep unrelated deletion flows unchanged.
- [x] Update new-session and browser-storage documentation after implementation.

## 7. Verification and completion

Use [App verification](app-verification.md) and
[Storybook verification](storybook-verification.md). Keep one verification owner,
full saved logs, and bounded output. Do not re-run passing flows without a relevant
change, failure, or unresolved question.

| Boundary      | Required evidence                                                                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Storage       | Independent drafts; text/files after reload and restart; atomic metadata/files; write failure; stale revisions; deletion racing a save; interrupted marker                 |
| Multiple tabs | Conflicting edits preserve both copies; duplicate Send admits once; remote row updates; tab closure leaves interrupted state; completed state survives missed notification |
| Branches      | Existing/default branch choices; Local creation; missing/deleted branch; ordinary dirty switching and refusal; non-Git; no remote-only refs; detached worktree             |
| Lifecycle     | Navigation/remount during preparation; no selection theft; concurrent drafts; server switch; shutdown; uncertain mutation; no automatic resubmission                       |
| First message | Correct destination despite navigation; attachments/skills/commands; invalid catalog choice; late acknowledgement; failure retains payload and same session                |
| UI            | Empty/loading/saving/failed/interrupted/preparing states; locked submitted editor; focus/keyboard/IME; long names; attachment-only draft; accessibility; responsive layout |

- [x] Use focused controller tests for ordering and failure cases, real browser
      IndexedDB tests for storage/coordination, and Storybook for component behavior.
- [x] Extend the existing real-server browser acceptance suite for draft-to-session
      flows. Use isolated profiles/projects and the pinned server/scripted provider.
- [x] Extend packaged Electron acceptance for restart with text/attachments and
      the built-in server's changed port. The earlier isolated storage probe does
      not replace verification through the actual app.
- [x] Run root `pnpm check` and `pnpm test`, then applicable packaged acceptance
      (`pnpm test:acceptance:mac`). Inspect captured real-browser screenshots for
      the centered panel, preparation state, failure actions, and sidebar; use the
      packaged native suite for Electron behavior. Do not manually replay passing flows.
- [x] Inspect the combined diff for duplicated state, unnecessary helpers, and
      restored old worktree logic. Report production lines added/removed/net, tests
      and documentation separately, abstractions added, and old machinery removed.
      Explain remaining growth and report unrelated failures without repairing them
      as part of this feature. No commit, push, or PR is included in this plan.

Historical evidence: isolated Chromium and Electron IndexedDB probes preserved
attachment bytes across restart; Chromium also passed transaction-abort checking.
The earlier focused baseline had 51/52 passes, with one NewSessionFlow timeout
passing alone afterward. Neither is a current end-to-end implementation result.
