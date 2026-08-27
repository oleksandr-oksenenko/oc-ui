# Renderer component inventory

This inventory translates the selected AMOLED workspace mockup into implementation units. The
saved design brief is authoritative for dimensions, state semantics, and generated-image
corrections.

## File layout rule

Every production `.tsx` file contains one component. A component's private child components live
under a directory named after the parent component. For example, `TranscriptView.tsx` owns
`TranscriptView/UserMessage.tsx` and `TranscriptView/AssistantMessage.tsx`.

Stories do not live beside components. They live under `apps/desktop/stories/` and exercise the
same public props that production uses.

## Verified component tree

```text
apps/desktop/src/renderer/
  App.tsx
  components/
    App/
      ConnectionForm.tsx
      ConnectedApp.tsx
      ConnectedApp/
        AppShell.tsx
        AppShell/
          Titlebar.tsx
          Workspace.tsx
          Workspace/
            SessionSidebar.tsx
            SessionSidebar/
              SessionTree.tsx
              SessionTree/
                SessionTreeItem.tsx
              NewSessionFlow.tsx
              NewSessionFlow/
                AddProjectDialog.tsx
                NewSessionDialog.tsx
                NewSessionDialog/
                  ProjectSelection.tsx
                  WorktreeForm.tsx
            SessionPane.tsx
            SessionPane/
              TranscriptView.tsx
              TranscriptView/
                UserMessage.tsx
                AssistantMessage.tsx
                AssistantMessage/
                  ReasoningBlock.tsx
                  ToolCall.tsx
              Composer.tsx
              Composer/
                ComposerPicker.tsx
            ContextPanel.tsx
            ContextPanel/
              ContextTabs.tsx
              DiffView.tsx
              DiffView/
                DiffFile.tsx
              FilesView.tsx
              FilesView/
                FileTreeItem.tsx
```

Shared renderer UI lives under `apps/desktop/src/renderer/ui/`. `ServerDirectoryBrowser` is shared
by the Add project and worktree forms. It reads the connected server filesystem through the
OpenCode file API and reports successfully resolved directories.

### Ownership

- `App` owns saved-connection setup and the connected/disconnected boundary.
- `ConnectedApp` owns OpenCode-backed controller state: catalog hydration, selection, drafts,
  prompt submission, reconnection, and opening the new-session flow.
- `ConnectedApp` owns the production left/right visibility signals; the full showcase owns its own
  fixture visibility signals.
- `AppShell` is the presentation-only frame. `Titlebar` renders the selected session title, panel
  callbacks, and the friendly server selector.
- `Workspace` renders the three-pane grid from controlled visibility props. Its caller decides when
  the right panel collapses first at a narrow width.
- `SessionSidebar` owns loading, empty, error, and tree presentation.
- `NewSessionFlow` owns project refresh, project registration, direct session creation, worktree
  creation, session admission, and retry rules. `AddProjectDialog` and `NewSessionDialog` own their
  modal and form presentation. Neither component reads the Electron host filesystem.
- `SessionTree` is a controlled recursive renderer; its caller owns expanded node IDs.
  `SessionTreeItem` owns one row, disclosure, depth, selection, and its single status glyph.
- `SessionPane` owns transcript/composer placement and the no-selection state.
- `TranscriptView` owns scrolling and transcript-level states. Message components own semantic
  rendering; reasoning and tool calls remain assistant-message children.
- `Composer` is controlled by `value` and `onInput`; it owns the draft editor behavior, optional
  selectors, submission presentation, and icon submit action.
- `ContextPanel` receives controlled Diff/Files selection and owns panel-level presentation. Diff
  and file-tree children own their respective domain presentation without a shared generic tree or
  code-row abstraction.
- `ConnectionForm` keeps its one-use field, warning, error, and action fragments inline.

## Component audit

The initial breakdown was reduced after an independent review:

- `ConnectionBar` is removed. Its useful server state moves into `Titlebar`; keeping both would
  duplicate connection identity.
- `SessionHeader` is removed. The selected session title belongs in the combined titlebar.
- Generic `SidebarState`, `TranscriptState`, and `EmptyState` wrappers are removed. Each area owns
  different retry and accessibility behavior.
- `SidebarToggle`, `ServerSelector`, `SendButton`, and `WorkingIndicator` remain small local markup
  inside their owning component until they gain independent behavior or reuse.
- `ToolOutput` stays inside `ToolCall`, and diff hunk rows stay inside `DiffFile`; extracting them
  would create one-use domain wrappers without clearer ownership.
- `ComposerPicker` is shared by model and reasoning controls because the interaction and shape are
  identical. The option data and labels remain explicit props.
- Session activity and attention are separate inputs. When a session is both running and waiting,
  the needs-input glyph takes precedence over the activity spinner.
- Session, tool, and connection statuses do not share a generic status component. They have
  different semantics and accessible names.

No visible mockup region is unowned: the titlebar, server selector, session hierarchy and states,
transcript prose/lists/quotes, reasoning, tool calls/output, composer controls, Diff/Files panel,
loading/empty/error states, and both panel toggles all map to the tree above.

## Runtime boundary

Production continues to use the existing OpenCode state as its authority. The current runtime can
honestly provide a connected server, flat top-level sessions, selected-session text messages,
working state, drafts, and prompt submission.

The following selected-design capabilities are implemented as provider-neutral optional props and
Storybook fixtures, but are not fabricated in production until their runtime milestones exist:

- nested child-session loading and synchronization;
- needs-input request handling;
- model and reasoning discovery/selection;
- reasoning summaries and tool-call projection;
- Diff and Files data.

Production therefore omits unavailable controls or panels rather than showing controls that cannot
work. Storybook's integrated workspace story supplies realistic fixture data for the complete visual
target.

The explicit user decision to remove session timestamps is followed by the renderer even though the
older first-slice requirements still describe an updated-time row. The runtime may retain
`time.updated` for ordering without presenting it.

## Storybook coverage

Stories are grouped under `apps/desktop/stories/`:

- `Showcase/AMOLEDWorkspace`: complete target fixture, with left/right panel toggles, Diff/Files
  switch, session expansion, composer selectors, and submit interaction. This is the visual target
  showcase; `Shell/AppShell` focuses on shell composition states using the same real child
  components.
- `Shell/Titlebar`: connected, reconnecting, long server name, and both panel visibility states.
- `App/ConnectionForm`: blank, connecting, saved URL, non-loopback warning, unauthorized,
  unreachable, and incompatible-version errors.
- `Sessions/SessionSidebar`: loading, empty, error, flat production list, four-level
  hierarchy, selected, running, needs-input, and needs-input precedence.
- `Projects/AddProjectDialog`: server-directory browsing, loading, validation,
  add-project failure, and mutation.
- `Sessions/NewSessionDialog`: project selection, empty catalog, direct and worktree choices,
  worktree inputs and preview, both mutation phases, validation and creation failures, and
  orphan-worktree retry.
- `Session/SessionPane`: no selection and selected transcript/composer placement.
- `Transcript/TranscriptView`: empty, loading, text, streaming, failure, rich
  prose/list/quote/link, reasoning, tool calls, and expanded output.
- `Composer/Composer`: idle, multiline growth, running draft, submitting, error, and optional
  model/reasoning selectors.
- `Context/ContextPanel`: Diff, Files, loading, empty, error, and close control.
- `Shell/AppShell`: integrated, main-only, and a narrow controlled state with the right panel
  collapsed first, using real `SessionPane`, `TranscriptView`, `Composer`, and `ContextPanel`
  children. `ConnectedApp` is intentionally excluded from visual Storybook because it is the
  runtime/provider-bound controller; its presentation children are covered by the stories above.
