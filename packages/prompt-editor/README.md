# @oc-ui/prompt-editor

Internal, framework-free core of the prompt composer: the markdown schema and
codec, the skill atom, editor plugins, and the paste/slash queries. The Solid
view stays in the app; this package is consumed by it.

## Ownership

In this package:

- the schema and the `skill` atom specification (headings admit the atom)
- the draft codec: `fromDraft`, `toDraft`, `serializeSlice`
- the literal codec: `fromPlainText`, `pastePlainText`
- document queries and policies: `pasteContent`, `slashQuery`
- editor plugins: `promptPlugins` (composition guard, history, keymap, input
  rules)
- `decodeNumericEntities` on the `./markdown-text` subpath

In the app:

- the Solid view, node views, CSS, menus, and focus
- the controlled-value echo guard, submission shortcuts, and the composition
  rechecks around clipboard reads
- clipboard acquisition, attachments, MIME routing, and upload limits
- transcript rendering

## Codec contract

- Drafts are CommonMark: one dialect for the composer, the transcript, and the
  model. Parsing is `prosemirror-markdown`; serialization is
  `mdast-util-to-markdown` with skill placeholders substituted afterwards. A
  single newline is the composer's hard break, raw HTML stays literal text, and
  mention offsets are UTF-16 code-unit ranges into the draft text.
- Mentions are kept only while they still match the text: stale or overlapping
  ranges stay ordinary text, and every accepted mention satisfies
  `text.slice(start, end) === name` with ordered, non-overlapping ranges.
  `fromDraft -> toDraft` is a fixed point for canonical drafts.
- One delimiter-boundary case is a documented loss: an emphasis that closes at
  a code span immediately before a skill atom reparses with literal `*`
  delimiters, because the closing `*` would precede the name's first letter.
  The skill atom, its mention offsets, and the visible text survive; the
  authoritative record is the `emphasis adjacent to skill` corpus case.
- `pasteContent` is the Markdown policy: a code block inserts the text as-is,
  anywhere else the text parses as a draft. `pastePlainText` is the literal
  policy: characters are never reinterpreted, carriage returns normalize to
  line feeds, and a single newline becomes a hard break. An all-blank payload
  has no insertion of its own; the router refuses it as a no-op.
- Formatting policy belongs to the serializer, not to callers; callers choose
  between the Markdown and literal policies and do not post-process output.

## Rules

- No imports from `apps/desktop` in this package.
- `src/markdown-corpus.test.ts` is the frozen golden-output contract; it is not
  independent parsing evidence, because its documents are built with the same
  codec it checks. Direct parse-structure claims live in `src/document.test.ts`.
  Documented losses and instabilities may only shrink, and every change to them
  must be explicit.

## App-side bounds

The app owns clipboard acquisition and attachment memory: the text-flavor
fallback order, a 16,384 UTF-16-unit routing threshold for inline text, a 2 MiB
UTF-8 cap per text attachment, and per-session draft bounds (16 attachments /
24 MiB). An over-cap or over-budget text paste is refused with an error notice
and retains nothing. The numbers and their refusal behavior are documented in
`docs/file-attachments-design.md`.
