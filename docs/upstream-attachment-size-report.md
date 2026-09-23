# Large inline attachments fail with a `RangeError` in `Prompt.Base64`

**Status: finding, upstream issue not filed.** The stack overflow has no
upstream report yet; opencode#50336 and opencode#45558 cover related
`Prompt.Base64` failures. File it when decided.

## Root cause

`@opencode/schema` validates attachment base64 with an open-ended regexp:

```js
/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
```

Effect's `isPattern` runs that expression through `RegExp.test` on the whole
string. V8's compiled regexp engine overflows its internal stack on
multi-megabyte inputs, so `Base64.make` throws
`RangeError: Maximum call stack size exceeded` as a defect, not a
`SchemaIssue`. The HTTP layer answers 500 with an empty body and stores
nothing. Inline `data:` URIs and server-local `file:` URIs both reach the
validator through `SessionPrompt.materializeAttachment`, and the documented
20 MiB cap is checked before validation, so the validator is the broken step.

## Measured threshold

Standalone Node.js v24.20.0: the largest reliably passing base64 is 4,473,912
characters (3,355,434 bytes decoded); the first failing length is 4,473,916
characters (≈3.2 MiB decoded, ~4.47 MB of base64). 3 MiB decoded (4,194,304
chars) passes; 20 MiB − 1 B (27,962,028 chars) fails. The cutoff is an
engine-internal limit on this V8 build, not a contract, and can shift by one
4-character group. It tracks input length, not the JS stack: `--stack-size` and
`--regexp-interpret-all` move the boundary by at most one group, and the
single-class form `^[A-Za-z0-9+/]*$` matches 27,962,028 chars in ~26 ms.

## Minimal reproduction

Server-independent (no dependencies):

```js
const pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
pattern.test("A".repeat(4_473_916));
// RangeError: Maximum call stack size exceeded
```

`Base64.make("A".repeat(4_473_916))` throws the same error from
`effect/dist/SchemaAST.js`. End to end, `POST /api/session/:sessionID/prompt`
with one inline text attachment of 3.5 MiB decoded returns HTTP 500 with an
empty body and stores nothing; the client SDK reports `UnexpectedStatus`.

## Current mitigation

The desktop app caps every attachment at 2 MiB decoded
(`MAX_ATTACHMENT_BYTES` in `apps/desktop/src/renderer/opencode/attachments.ts`),
about 37% below the measured failure. The cap is temporary and applies to text,
files, and images alike because the server re-encodes all of them through the
same path.

- opencode#50336 — a large xlsx file crashes the session through `Prompt.Base64`
- opencode#45558 — `Prompt.Base64` 500 on `/prompt`

## Follow-up

- File this stack overflow upstream with the reproduction above. Checked
  2026-09-22: `@opencode/schema@2.0.13` and `effect@4.0.0-rc.117` still ship
  the failing pattern, and no matching issue was found.
- Replace the pattern with a stack-safe equivalent, add a ≥3.5 MiB regression
  test for `data:` and `file:` inputs, and remove the 2 MiB cap once the server
  validator is fixed.
