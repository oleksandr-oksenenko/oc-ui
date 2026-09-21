# @oc-ui/prompt-editor

Internal, framework-free core of the prompt composer: the markdown schema and
codec, the skill atom, editor plugins, and the paste/slash queries. The Solid
view stays in the app; this package is consumed by it.

## Ownership

In this package:

- the schema and the `skill` atom specification
- the draft codec: `fromDraft`, `toDraft`, `serializeSlice`
- document queries and policies: `pasteContent`, `slashQuery`
- editor plugins: `promptPlugins` (history, keymap, input rules)
- `decodeNumericEntities` on the `./markdown-text` subpath

In the app:

- the Solid view, node views, CSS, menus, focus, and composition handling
- the controlled-value echo guard and submission shortcuts
- clipboard acquisition, attachments, MIME routing, and upload limits
- transcript rendering

## Rules

- No imports from `apps/desktop` in this package.
- Markdown formatting policy belongs to the serializer, not to callers. When
  the serializer moves to `mdast-util-to-markdown` the public API stays the
  same.
- `src/markdown-corpus.test.ts` is the frozen contract. Documented losses and
  instabilities may only shrink, and every change to them must be explicit.
