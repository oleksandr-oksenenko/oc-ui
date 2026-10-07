# Storybook production-component inventory

Storybook mounts production components from `src/`, workspace packages, or the
pinned `@opencode/ui` **2.0.3** package. Fixture data, controlled callback state,
viewport constraints, and required real providers are permitted. Story-only
widgets, visual copies, token catalogs, alternative designs, and scenario/showcase
applications are not. A fixture must not restyle the component it mounts.

This audit covers every file under `apps/desktop/stories/` at `8ace437`, plus
Storybook configuration and repository references. Paths below are relative to
that stories directory unless otherwise specified.

## Retained authoritative stories

| Story file                              | Production target and useful coverage                                                                                                                                                                                                                       |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AddProjectDialog.stories.tsx`          | AddProjectDialog; server directory listing, validation, mutation errors, focus and narrow layout.                                                                                                                                                           |
| `AppShell.stories.tsx`                  | AppShell/ShellRegion with real Titlebar, Workspace, sidebar, conversation and changes components; panel reopen, responsive overlays, isolation and focus return.                                                                                            |
| `Attachments.stories.tsx`               | UserMessage; SDK attachment fixtures, inline skills, browser metadata, read-only shared pills, nested image modal and focus return in light/dark/narrow states. Synthetic proposal stories removed.                                                         |
| `BrowserAnnotations.stories.tsx`        | BrowserAnnotations; controlled capture data, comment typing and add/cancel callbacks.                                                                                                                                                                       |
| `BrowserPane.stories.tsx`               | BrowserPane; connection states, address navigation and tab actions. Fake native-page viewport removed; Electron owns actual embedded-page verification.                                                                                                     |
| `BuiltInStartup.stories.tsx`            | BuiltInStartup; starting, stopped and failed states.                                                                                                                                                                                                        |
| `CodeReviewRemovalDialog.stories.tsx`   | CodeReviewRemovalDialog through the real dialog provider.                                                                                                                                                                                                   |
| `Composer.stories.tsx`                  | Composer; literal neutral/flush focus, compound delegation, editing, copy, paste/drop, image/review inputs, pickers, running, submitting, disabled and error states.                                                                                        |
| `ConnectionForm.stories.tsx`            | ConnectionForm; desktop/browser hosts, saved connections, warnings and connection failures.                                                                                                                                                                 |
| `ContextPanel.stories.tsx`              | ContextPanel/DiffReviewView; real diffs, virtualization, range selection, review comments, close focus, scrolling and long-path tooltip.                                                                                                                    |
| `DeleteSessionDialog.stories.tsx`       | DeleteSessionDialog; child sessions, pending deletion, errors and long/narrow content.                                                                                                                                                                      |
| `PermissionRequestCard.stories.tsx`     | PermissionRequestCard; exact reply values, missing patterns, submitting/disconnected/error, keyboard access and long resources. Synthetic loading/failure UI replaced by ConversationRegion coverage.                                                       |
| `QuestionForm.stories.tsx`              | QuestionForm; complete fields, disabled/error/narrow states, real TranscriptView slot mounting. Default-style alternative and copied transcript markup removed.                                                                                             |
| `QueueingSteering.stories.tsx`          | SessionPane, PendingMessages, Composer and TranscriptView; controlled queue/steer/cancel/stop callbacks and attachment-only sending.                                                                                                                        |
| `SessionPane.stories.tsx`               | SessionPane; no-selection state, actual transcript/composer placement and return-to-latest geometry.                                                                                                                                                        |
| `SessionSidebar.stories.tsx`            | SessionSidebar/SessionTree; status glyphs, hierarchy, filtering, disclosure/selection ordering, drafts, errors and mobile close focus.                                                                                                                      |
| `SkillsComposer.stories.tsx`            | Composer suggestions; commands/skills, keyboard/pointer selection, retry, partial failure, undo/redo, multiline/paste/reset. Demo intro and submitted-message preview removed.                                                                              |
| `Titlebar.stories.tsx`                  | Titlebar/ContextTitlebarRegion; panel visibility, no session and native titlebar inset.                                                                                                                                                                     |
| `TranscriptAnnotations.stories.tsx`     | Production annotation owner, TranscriptView, Composer and AnnotationPopover; editing/caret stability, source selection/navigation, running restrictions and nested output scrolling. Historical Comparison renamed Interactive; exploration chrome removed. |
| `TranscriptCodeBlock.stories.tsx`       | Production Markdown with SyntaxHighlightProvider; worker highlighting and copy interaction.                                                                                                                                                                 |
| `TranscriptView.stories.tsx`            | TranscriptView; SDK message union, Markdown/images/tables, tool/shell/activity states, streaming updates, deferred mounting, selection pause, reading anchors and horizontal output scrolling. Copied subagent layout replaced by ConversationRegion.       |
| `design-system/Buttons.stories.tsx`     | Direct upstream Button props: primary, recovery, destructive, loading and disabled. Synthetic catalog framing removed.                                                                                                                                      |
| `design-system/IconActions.stories.tsx` | Direct upstream IconButton props: panel/row/primary/disabled. Copied session row and forced stale 2px/2px focus specimen removed.                                                                                                                           |
| `design-system/Inputs.stories.tsx`      | Direct upstream TextInput props and controlled value: clearable, invalid, disabled and long value. Synthetic field catalog removed.                                                                                                                         |
| `design-system/Focus.stories.tsx`       | Actual upstream control families and production embedded annotator card; literal neutral colors, 1px flush outlines, compound-field delegation, keyboard/pointer and Escape. Fake compound textarea removed; real Composer retains that regression.         |

## Replacements using existing production components

- `NewSessionScreen.stories.tsx` directly mounts NewSessionScreen/NewSessionSetup
  and Composer. It retains the useful showcase's project/location/branch choices,
  unavailable-project keyboard/retry behavior, draft/file preservation during
  picker changes, preparing/error/interrupted states, and light/dark/mobile views.
  Application-owned persistence/navigation remains covered by browser acceptance.
- `ConversationRegion.stories.tsx` mounts ConversationRegion with typed controller
  fixtures and the real registry/workspace owner/annotation store. It covers
  loading/failure/pending requests and measures the actual subagent group at narrow
  width, replacing a copied group and the synthetic permission states.
- `global-forms/GlobalFormsRegion.stories.tsx` replaces
  `global-forms/GlobalFormsBeacon.stories.tsx`. It mounts GlobalFormsRegion and its
  real ReviewDialog for loading/error/disconnected/empty/long states, dismissal,
  reopen/focus restoration, mobile and short-height usability.

## Retained minimal helpers and fixture data

- `DialogStory.tsx`: pushes an actual dialog into the production provider and
  closes it on unmount; no visual wrapper.
- `attachment-fixtures.ts`, `composer-fixtures.ts`, `image-fixtures.ts`,
  `browser-annotation-fixtures.ts`,
  `question-form-fixtures.ts`, `session-fixtures.ts`, `transcript-fixtures.ts`, and
  `transcript-catalog-fixtures.ts`: typed input data and boundary callbacks.
  The orphaned attachment File-conversion helper was removed.
- `BrowserAnnotationComposerFixture.tsx`: production Composer and its real
  controller/providers with fixture captures and a per-mount SDK transport;
  preserves the browser-batch removal and failed-send retry coverage added on main.
- `global-forms/global-form-fixtures.ts`: typed controlled request transport;
  unused live-demo insertion/removal helpers removed.
- `queueing-steering/QueueingSteering.tsx`: controlled props/callbacks for the four
  real components above; its prototype stylesheet removed.
- `transcript-annotations/TranscriptAnnotations.tsx`: real state owners with a
  simulated SDK transport, owned registry/scope cleanup, and upstream buttons to
  drive required state transitions. Its exploration stylesheet removed.
- `transcript-catalog/ActivityStatesFixture.tsx`: SDK activity-state data mounted
  through TranscriptView.
- `transcript-catalog/TranscriptActivityFixture.tsx` and
  `transcript-catalog/TranscriptUpdatesFixture.tsx`: controlled streaming updates
  driven by upstream Buttons; retain scroll/selection/remount regressions.
- `transcript-catalog/TranscriptPendingFixture.tsx`: real QuestionForm and
  PermissionRequestCard content for the public pending slot, in a semantic article
  so their headers/footers are not page landmarks. Copied production selectors and
  subagent markup removed.

There are no remaining story-only stylesheets or artwork assets. `image-fixtures.ts`
provides deterministic image bytes for actual attachment/preview rendering.

## Removed exploration and old machinery

- Attachment alternatives: `AttachmentOptions.stories.tsx`,
  `AttachmentChips.stories.tsx`, `AttachmentTiles.stories.tsx`,
  `AttachmentSummary.stories.tsx`, `AttachmentPills.stories.tsx`,
  `AttachmentSummaryPills.stories.tsx`, `ComposerAttachmentProposal.stories.tsx`
  and `ComposerAttachmentProposal.css`.
- Attachment renderers/styles: `attachments/AttachmentProposal.tsx`,
  `attachments/attachments.css`, all five `attachments/compact/*Option.tsx`
  components, and `chips.css`, `tiles.css`, `summary.css`, `pills.css`,
  `summary-pills.css`, `comparison.css` in that directory.
- Showcase: `WarmPaperWorkspace.stories.tsx` and every file in
  `workspace-showcase/`: `WorkspaceAddProject.tsx`, `WorkspaceBrowser.tsx`,
  `WorkspaceConnection.tsx`, `WorkspaceNewSession.tsx`, `activity-fixture.ts`,
  `permission-fixture.ts`, `workspace-showcase.css`, and `README.md`.
- Scenario lab: every file in `scenario-lab/`: `ScenarioLab.stories.tsx`,
  `ScenarioLab.tsx`, `ScenarioLab.css`, `ApprovalLab.tsx`, `ApprovalLab.css`,
  `SupervisionLab.tsx`, `SupervisionLab.css`, `lab-fixtures.ts`,
  `supervision-fixtures.ts`.
- Synthetic catalogs: `design-system/Content.stories.tsx`,
  `DataDisplay.stories.tsx`, `Elevation.stories.tsx`, `Feedback.stories.tsx`,
  `Foundations.stories.tsx`, `Navigation.stories.tsx`, `Selection.stories.tsx`,
  `StoryLayout.tsx`, and `design-system.css`. Actual transcript/content, session
  rows, project/model pickers and feedback are covered by their production stories.
- Demo-only scaffolding: `SkillsComposer.css`,
  `queueing-steering/queueing-steering.css`,
  `transcript-annotations/transcript-annotations.css`,
  `global-forms/global-forms.tsx`, `global-forms/global-forms.css`,
  `global-forms/beacon.css`, and the timed LiveQueue demo.
- References: removed the showcase lint exception; updated component inventory
  and CSS-plan links and `docs/new-session-location-ui.md` coverage; replaced
  `docs/transcript-attachments-proposal.md` with the
  current [attachment contract](transcript-attachments.md). Removed superseded
  `docs/transcript-annotation-exploration.md` and
  `docs/transcript-source-recovery-spike.md`; the current annotation specification
  remains `docs/transcript-annotations-design.md`.

## Mounting and verification boundaries

`.storybook/preview.ts` retains actual ThemeProvider and ServerFlowDialogProvider,
production styles, host markers and viewport presets. `.storybook/main.ts` retains
production dependency prebundling. The accessibility failure gate stays enabled.
No widgets were promoted to production, and production CSS/behavior was not changed.

IME composition guards remain covered by the real prompt-editor DOM/plugin tests
in `packages/prompt-editor/src/plugins.test.ts`; no such coverage was removed.

Use [App verification](app-verification.md) and
[Storybook verification](storybook-verification.md) for the required root checks,
automated Storybook interactions/accessibility, static build, and targeted visual
inspection. A Storybook fixture cannot verify Electron's native embedded view.
