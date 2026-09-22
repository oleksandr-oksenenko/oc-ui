# Session file attachments

Add three ways to attach local files to the current session prompt:

1. drag and drop onto the composer,
2. paste a file from the OS clipboard,
3. a composer button that opens the native file picker.

Attached bytes are inlined by the renderer and travel to the connected server as
`data:` URIs; the server owns the filesystem, so no desktop path may cross the
renderer/server boundary.

This document records the root causes, the design, and the review of that design.

## Current behavior and root causes

### 1. Attachment drag and drop is not implemented

No composer attachment `drop` handling exists. ProseMirror itself does handle
drag and drop (it cancels `dragover`, and inserts dragged text or URIs), and
Electron's `will-navigate` guard in `main/index.ts:321-325` cancels the browser's
default file navigation. So dropping a file is not "inert because navigation is
blocked" - it produces no attachment because nothing consumes it, and any text
that accompanies a drag can still land in the editor.

Fix: make the composer `<form>` (`Composer.tsx:248`) a capture-phase drop target
for file drags only. A bubbling handler would run after ProseMirror's editor
listener and cannot undo an inserted text transaction.

### 2. Pasting non-image files

I reproduced the paste path with a standalone probe on the pinned toolchain
(Electron 42.3.3, `sandbox: true`, `contextIsolation: true`, macOS arm64):

- A file copied in Finder yields `types: ["Files"]`, `files: [sample.txt]`, and an
  empty `text/plain`. ProseMirror's `handlePaste` receives it.
- An osascript `text/uri-list` file reference yields the same `Files` result.
- An image paste also arrives as `Files`.

The current code does not discriminate against non-image files: `PromptEditor`
forwards every `clipboardData.files` entry (`PromptEditor.tsx:209-214`), the
callback is always supplied (`ConversationRegion.tsx:286-288`), and both prompt and
command submission read them (`createSessionComposer.ts:379-408`). Non-image
Finder paste therefore already works in this configuration; the reported failure
is not reproducible from the OS clipboard alone.

There is, however, a concrete bug in the text fallback
(`PromptEditor.tsx:215-220`): `getData("text/plain")` returns `""`, not
`undefined`, when the format is absent. The handler treats that as a text paste,
replaces the selection with an empty slice, and returns `true`. Consequences:

- A file- or URI-only paste with an active selection can delete prompt text.
- URI-only content is dropped instead of being inserted, because ProseMirror's own
  `text/uri-list` fallback is suppressed.

Fix: only dispatch custom text insertion when meaningful plain text exists;
otherwise leave the selection untouched and decide deliberately whether to defer
to ProseMirror.

Remaining plausible causes for the original report (hypotheses, not established):

- Paste is only wired to the ProseMirror editor. Nothing focuses the prompt on
  session selection, and a form listener only receives paste targeted inside the
  composer.
- Only `clipboardData.files` is read; sources that expose files solely as
  `DataTransferItem`s of `kind: "file"` are ignored.
- Chromium on Windows is known not to surface Explorer-copied files as `File`s.

### 3. No picker button

There is no control to choose files. Fix: a hidden `<input type="file" multiple>`
inside the composer, triggered by an `IconButton`. This opens the OS-native picker
in Electron and works unchanged in the web build, with no new IPC or main-process
surface. `input.value` is reset after each selection so choosing the same file
again re-fires `change`.

## Design

### Contract

All three entry points converge on the existing per-session `fileDrafts` atom in
`createSessionComposer`. Rename the controller method `pasteFiles` to
`attachFiles` and the composer prop to `onAttachFiles`; draft semantics are
unchanged (append to the selected session, keep across navigation, consume by
identity on successful admission).

```
readonly files: Accessor<readonly File[]>;
readonly attachFiles: (files: readonly File[]) => void;
readonly removeFile: (file: File) => void;
```

`PromptEditor` loses both the file branch and its attachment callback; ProseMirror
keeps owning text paste.

### Extraction

One helper, `collectFiles(dataTransfer)`:

- read `dataTransfer.files` first;
- read file-kind `dataTransfer.items` only when `files` is empty;
- preserve order, drop null `getAsFile()` results, and avoid adding the same
  `File` object twice (removal and completion operate by identity).

Do not merge both representations and rely on identity de-duplication, and do not
de-duplicate distinct `File` objects that share a name and size - that does not
prove identical contents.

### Drop target

On the composer form, using capture-phase listeners (Solid's delegated event set
does not include drag/drop or paste, so use `oncapture:...` or explicit native
listeners with cleanup):

- During `dragenter`/`dragover`, detect a file drag from `dataTransfer.types`
  containing `"Files"` or file-kind items. Do not require a populated `files` list;
  drag data may be protected until `drop`. Cancel the event and set
  `dropEffect = "copy"`.
- On a file `drop`, synchronously extract files, cancel, and stop propagation
  before ProseMirror handles it.
- Leave ordinary text drags and editor-internal text moves alone.
- A rejected file drop must still not navigate or insert a path.

Overlay state: keep a drag-depth counter rather than "show on enter, hide on
leave"; reset on drop, genuine exit, cancellation, and session/availability
changes. Do not rely on `dragend` for OS-origin drags. Keep the overlay
`pointer-events: none`, nonfocusable, inside the positioned form.

### Paste

Composer owns file-paste extraction through a native capture `paste` listener on
its form; ProseMirror owns text paste. For a payload with files, Composer calls
`onAttachFiles` once, cancels, and stops propagation; for text it does nothing and
lets the corrected ProseMirror handler run. This also covers paste while another
composer button has focus.

Scope is explicit: paste works anywhere inside the composer. It does not reach
paste targeted at the sidebar, transcript, or `body`. Making paste
application-wide would need a single workspace-level owner with exclusions and is
out of scope. If the prompt is expected to be focused after selecting a session,
that is a separate focus-policy change.

### Availability

Preserve draft semantics: attachments stay editable whenever a session is selected
and an attachment callback exists, including during sending, reconnecting, and
transcript loading - just as text remains editable. Do not reuse the
submission-disabled flag to disable only the picker. The attach button is disabled
only when `onAttachFiles` is absent, and paste and drop follow the same rule, so
all three entry points agree.

Picker specifics: `type="button"`, no image-only `accept`, copy `input.files`
before resetting `input.value`, and bind each selection to the session that
opened the chooser. The composer stays mounted across session changes, so a
selection made for session A is discarded rather than attached to session B, and
the pending chooser identity is cleared when the session changes.

### Notice lifecycle

Attachment feedback is transient and session-tagged. A new attachment selection
replaces any earlier size or read notice for that session, including a command
attachment error. Starting a prompt or command attempt clears the session's
attachment notice first, so a later ambiguous network failure is reported as
such instead of being masked by an older "not sent" message.

A read failure on a retry of an uncertain request does not assert that the
message was never sent, because the earlier attempt may already be in flight.
That notice is associated with its request, so a confirming durable echo clears
it; a newer, unrelated size notice is preserved. When a draft size rejection is
raised while a send is pending and that send then fails, the composer reports
both rather than hiding either.

Completion therefore does not blanket-clear attachment notices. The earlier
"clears on success" wording applies only to the request-associated notice.

### Limits and errors

The server validates attachment base64 in `SessionPrompt.materializeAttachment`,
and its validator fails or overflows on large payloads (the desktop app caps
every attachment at `MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024` decoded as a
temporary mitigation; see the comment on that constant for the filed issues).
`createSessionComposer` owns validation and errors:

- `attachFiles` is the single entry point for files, so it validates metadata
  before appending. It accepts valid files and reports oversized ones by name (or
  count, for several) rather than discarding an entire mixed selection.
- Per session draft, at most `MAX_DRAFT_ATTACHMENTS = 16` attachments totaling
  at most `MAX_DRAFT_ATTACHMENT_BYTES = 24 MiB` are held; a selection past
  either bound attaches what fits in order and reports the rest with a notice
  naming the action that releases room. Drafts are per session and are released
  by clear or a confirmed send.
- Distinguish a local read failure from an ambiguous network outcome. A prompt
  file-read failure now reports the file name and that nothing was sent, instead
  of collapsing into "Couldn't confirm the message was sent". Command failures do
  the same.
- Keep errors in controller state tied to the session; clear a request-associated
  notice when its confirming echo arrives, and clear draft feedback on removal,
  retry, and session cleanup. The composer's existing `role="alert"` is enough.

Count/aggregate size is bounded per session: at most 16 draft attachments and
24 MiB total, and at most one retained paste recovery of
`MAX_RETAINED_PASTE_UNITS = 4 Mi` UTF-16 code units (`MAX_ATTACHMENT_BYTES`
bounds each attached text separately). A text paste that cannot become an
attachment - over the per-file cap or past the aggregate budget - is retained
through the recovery surface with a message that names its reason; a payload
past the recovery bound is not retained at all rather than truncated. A paste
while a recovery is pending is refused until it is restored or dismissed.

### Encoding

`readPromptFile` keeps turning a `File` into `{ uri: <data URL>, name }`
(`PromptInput.FileAttachment`). The connected server inlines `data:` URIs and
detects MIME from bytes, so non-image files need no new transport. Do not create
data URLs eagerly on attach; `ImagePreview` already revokes object URLs and
`readPromptFile` aborts in-flight readers on cleanup.

Do not add a client MIME allowlist, do not forward any desktop path, and do not
derive `uri` from the filename. Files with an unrecognized binary MIME type are
stored and named but contribute no model content; that is upstream behavior
(`@opencode/core` 2.0.3 `mime-gqrjg9m0.js`) and is not reimplemented.

### Deferred / rejected

- Deferred: a main-process clipboard bridge (`text/uri-list`, `public.file-url`,
  `NSFilenamesPboardType`). The reproduced macOS path already works; a bridge adds
  privileged filesystem access, platform formats, IPC validation, session
  targeting, limits, and cancellation. A reproducible supported-platform case
  where a trusted paste supplies only native file references would justify a
  narrowly scoped bridge that returns bytes plus basename.
- Rejected: resolving file URIs from ordinary pasted text, separate
  `pasteFiles`/`dropFiles`/`pickFiles` operations, filename/size de-duplication,
  content hashing, upload queues, eager encoding, a custom native-picker IPC
  endpoint, and second preview or MIME layers.
- Out of scope: folder attachment. Only files are accepted; a dropped folder is
  not traversed. Directory detection is left to the browser, and a folder that
  yields no file contributes nothing.

### Directory and filename handling

`collectTransferFiles` accepts `File` objects only. It does not inspect
`webkitGetAsEntry`, so a folder drop either yields no extractable file or a
regular file row whose read fails; recursive folder upload is explicitly out of
scope. Filenames remain display metadata: nothing derives a filesystem path or
`uri` from `File.name`, and picker fake paths (`C:\fakepath\...`) are never
forwarded.

## UI

- `IconButton` in the picker row, `aria-label`/`title` "Add images and files",
  icon `plus` (the pinned `@opencode/ui` set has no paperclip). `type="button"`.
  Upstream i18n confirms the labels: "Add images and files", "Images and files",
  "Drop files to add", "Remove attachment".
- The attachment list keeps its rows and thumbnail; its `aria-label` becomes
  "Images and files".
- Drop overlay: a `data-dropping` attribute and a small `pointer-events: none`
  overlay reading "Drop files to add", hidden after drop/exit/cancel.

## Tests

| Boundary      | Assertions                                                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Extraction    | non-image `files`; items-only; null `getAsFile`; files and items both present attach once; stable order                                                                                     |
| Paste/editor  | file plus text attaches once without text insertion; URI-only fallback behaves deliberately (empty plain text and selection preservation are covered); ordinary multiline text inserts      |
| Drop          | drop on ProseMirror with file and text payload inserts no text; file drag accepted while `files` is empty during dragover; child transitions do not flicker; text/internal drags still work |
| Picker        | multiple files; repeated selection after reset; cancellation; callback absent; session change while open                                                                                    |
| Controller    | exact 2 MiB boundary; oversize rejection before reads; mixed batch policy; prompt and command local read failure produce no API call and a specific message; errors isolated per session    |
| Ownership     | existing navigation, new-attachment-during-admission, retry identity, subscriber unmount, shutdown, identity consumption tests stay green                                                   |
| Resources     | preview URL revocation on removal/session change/unmount; reader abort on interruption                                                                                                      |
| Server-backed | send a MIME-less text file and an image/PDF fixture against the pinned server; verify persisted inline source, name, and bytes across navigation                                            |

JSDOM and Storybook prove routing, not OS clipboard exposure; real-app
verification covers the ProseMirror event-ordering regression and the picker.

## Empirical notes

The probe artifacts used to establish the paste behavior are throwaway and are not
part of the change. Real-app verification should cover: Finder non-image paste with
editor focus; the chosen behavior immediately after session selection; image
paste; dropping a file over editor text and over controls; using and cancelling
the native picker; selecting the same file twice; and confirming a local file
reaches a connected server as inline bytes without that path existing on the
server.
