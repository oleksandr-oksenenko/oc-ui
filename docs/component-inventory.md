# Renderer component inventory

Production components live under `apps/desktop/src/renderer/`. Each production
`.tsx` file contains one component; private children live under a directory named
after their parent. Stories live separately under `apps/desktop/stories/` and
exercise production props with fixture data.

## Component tree

`src/renderer/App.tsx` is the application root. The presentation boundaries below
are relative to `src/renderer/components/`:

```text
App/
  ConnectionForm.tsx
  BuiltInStartup.tsx
  ConnectedApp.tsx
  ConnectedApp/
    Shell/
      AppShell.tsx
      ShellRegion.tsx
      Titlebar.tsx
      ContextTitlebarRegion.tsx
      Workspace.tsx
    Sessions/
      SessionSidebar.tsx
      SessionSidebar/
        SessionHeader.tsx
        SessionTree.tsx
        DeleteSessionFlow/DeleteSessionDialog.tsx
        NewSessionFlow/AddProjectDialog.tsx
    Conversation/
      ConversationRegion.tsx
      NewSessionScreen.tsx
      NewSessionScreen/NewSessionSetup.tsx
      SessionPane.tsx
      SessionPane/
        Composer.tsx
        PendingMessages.tsx
        TranscriptView.tsx
        TranscriptView/
          UserMessage.tsx
          AssistantMessage.tsx
      AnnotationPopover.tsx
    Changes/
      ChangesRegion.tsx
      ContextPanel.tsx
      ContextPanel/DiffView.tsx
    Browser/
      BrowserPane.tsx
      BrowserAnnotations.tsx
    GlobalForms/
      GlobalFormsRegion.tsx
      ReviewDialog.tsx
```

Shared renderer UI lives under `src/renderer/ui/`, including QuestionForm,
PermissionRequestCard, AttachmentPills, ReviewAttachmentDetails, ImagePreview,
ServerDirectoryBrowser, ThemeProvider and ServerFlowDialogProvider.

## Ownership

- App owns the saved-connection boundary and upstream toast region.
- ConnectedApp composes production controllers. OpenCode's Workspace owns SDK
  caching, optimistic updates, rollback and events; stories do not duplicate that
  application state.
- ShellRegion/AppShell/Titlebar/Workspace compose panels, titlebar controls,
  responsive overlays and resizing. SessionSidebar and SessionTree own session
  presentation, hierarchy and status glyphs.
- ConversationRegion composes pending forms/permissions, inbox, transcript,
  annotation popup and Composer. TranscriptView owns scrolling and deferred
  rendering; message components render the SDK message union.
- NewSessionScreen and NewSessionSetup are controlled presentation for project,
  location and branch choices; their production owner handles drafts and admission.
- Composer owns editor/selector interaction and controlled attachment presentation.
  Session workflow owners supply submission, recovery and draft lifetime.
- ChangesRegion/ContextPanel own change-review presentation. BrowserPane renders
  browser controls; Electron owns the native embedded page.
- GlobalFormsRegion owns the request launcher and ReviewDialog presentation.
- ServerDirectoryBrowser lists locations on the connected server. Shared
  `serverPath` owns POSIX, Windows-drive and UNC navigation; renderer code does not
  apply Electron host path rules to remote locations.

## Authoritative Storybook coverage

See [Storybook inventory](storybook-inventory.md) for every retained story,
fixture/helper, replacement, and removed catalog/lab/showcase. Storybook mounts
production components with the minimum real providers and controlled fixture data.
It contains no alternative designs or copied production presentation.

Focus and Composer retain literal neutral-color and flush-outline geometry
regressions in both themes. Interaction/accessibility coverage also exercises
IME, caret preservation, scrolling, selection, overlays, dismissal, remounting and
focus restoration. Server-backed workflows use the existing browser acceptance
suite; native embedded pages require Electron checks. Current verification
requirements are in [App verification](app-verification.md).
