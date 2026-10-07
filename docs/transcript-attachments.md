# Transcript attachments

The production transcript and Composer share `AttachmentPills`,
`AttachmentDetailPill`, `AttachmentImagePill`, and `AttachmentFilePill` from
`apps/desktop/src/renderer/ui/AttachmentPills.tsx`. Sent attachments omit removal
controls. Reviews and transcript annotations open read-only popovers; annotation
quotes retain their source-opening callback. Agents and non-inline skills are
not listed as attachments. Inline skill mentions remain in the prompt text.

## Data and ownership

The pinned OpenCode client and UI are **2.0.3**. `SessionMessageUser` supplies
files, skill mentions, and metadata. `UserMessage` classifies that saved data;
stories supply representative SDK messages through its production props.

Browser captures use versioned `oc-ui/browser-annotations` metadata, including
capture context and explicit indices into screenshot files. Composer owns this
metadata alongside admitted files and snapshots it for retries. Removing a
batch's screenshot drops its grouping; clearing or consuming files releases its
draft metadata. Screenshot bytes remain in SDK file attachments.

The transcript folds only intact generated browser text into a pill. Edited
text stays visible. Old messages, invalid metadata, and missing screenshot
references retain text and ordinary file rendering. Review and annotation
metadata uses the existing session-prompt decoder and its legacy fallback.

The composer limits one draft to 16 files, 2 MiB per file and 24 MiB total.
Browser capture additionally limits annotations and capture bytes before passing
through composer admission. Non-image files have no invented open/download
action. Image preview uses saved bytes and the production modal.

## Presentation and verification

Image thumbnail and filename form one preview trigger. Removal is separate from
preview activation. Composer bounds large batches to its scrollable attachment
area; attachment-only submission uses the controlled count.

Review details use `ReviewAttachmentDetails`. Annotation popup behavior belongs
to `createTranscriptAnnotations` and `AnnotationPopover`: comments navigate only
to validated source ranges, keep edits through dismissal, and report unavailable
sources without guessing. Popup code excerpts share the transcript's code-block
stylesheet and keyboard scrolling.

Authoritative stories:

- `Transcript/Attachments`: real `UserMessage` fixtures, mixed and attachment-only
  messages, inline skills, browser captures, light/dark/narrow shared pills,
  keyboard activation, nested image modal dismissal, and focus restoration.
- `Composer/Composer`: real file/image/review inputs, paste/drop, draft retention,
  disabled and error states, and literal neutral, flush focus assertions.
- `Transcript/Annotations`: real annotation controller, popover, transcript and
  composer with simulated transport; source navigation and nested output scrolling.
- `Context/BrowserAnnotations`: real capture-comment editing and add/cancel callbacks.

Historical attachment alternatives and proposal renderers have been removed.
Current verification commands and evidence requirements are in
[App verification](app-verification.md).
