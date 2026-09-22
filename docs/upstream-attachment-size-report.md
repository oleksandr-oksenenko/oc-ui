# Draft upstream report: large inline text attachments fail with a `RangeError`

**Status: draft, not posted.** This document is an internal draft of an upstream
OpenCode bug report. Do not post it without reviewing the reproduction against
the then-current release.

The desktop app stays clear of this by capping text attachments at 2 MiB
(`MAX_TEXT_ATTACHMENT_BYTES` in `apps/desktop/src/renderer/opencode/attachments.ts`),
but the server misbehavior is outside this repository.

## Environment

- `@opencode/server` 2.0.3 (pinned; health reports `version: 2.0.3`)
- `@opencode/client` 2.0.3, `@opencode/schema` 2.0.3
- `effect` 4.0.0-rc.112
- Node.js v24.20.0 (server bundle), Electron 42.3.3 (packaged desktop runtime)
- macOS (arm64), local authenticated server

## Summary

`POST /api/session/:sessionID/prompt` accepts inline `data:` attachments up to
roughly 3.2 MiB of decoded content, then fails with HTTP 500 and an empty body
for larger payloads. Nothing is stored. The documented per-file cap is 20 MiB
(`MAX_ATTACHMENT_BYTES` in `SessionPrompt.materializeAttachment`), so the
reachable ceiling is far below the contract and the failure is opaque to
clients.

The failure is a `RangeError: Maximum call stack size exceeded` thrown by
`RegExp.test` while validating the generated base64 string against
`Prompt.Base64`. On Node.js v24.20.0 the first failing base64 length is
4,473,916 characters (≈3.2 MiB decoded). The regex is authored by OpenCode
(`@opencode/schema`); Effect only forwards it to `RegExp.test`.

## Root cause

The pattern is defined in
`apps/desktop/node_modules/@opencode/schema/dist/prompt.js:16`
(identical in the published `@opencode/schema@2.0.13` tarball; sha256
`e5b1c434cb1e1b33abe854dfd965f437bd936cc86b814517e4075f991d3451a9`):

```js
export const Base64 = Schema.String.check(
  Schema.isPattern(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
).annotate({ identifier: "Prompt.Base64" });
```

Effect's `isPattern` (`effect@4.0.0-rc.112`, `dist/SchemaAST.js:2588`) is a thin
wrapper that runs the supplied expression through `RegExp.test`:

```js
export function isPattern(regExp, annotations) {
  const source = regExp.source;
  const pattern = new globalThis.RegExp(source, regExp.flags);
  return makeFilter(
    (s) => {
      pattern.lastIndex = 0;
      return pattern.test(s); // SchemaAST.js:2593
    },
    {/* annotations ... */},
  );
}
```

Call path for a prompt attachment:

```
POST /api/session/:sessionID/prompt
  Session.prompt
  SessionPrompt.prepare                       (out/opencode-standalone/opencode-server.mjs:42729)
  Effect.forEach(files, materializeAttachment, { concurrency: 8 })
  SessionPrompt.materializeAttachment         (opencode-server.mjs:42767)
    decodeDataURL / readFileAttachment        (file: and data: URIs both reach here)
    normalizeImageAttachment(input, Buffer.from(content).toString("base64"), mime)  (opencode-server.mjs:42785)
      Base64.make(data4)                      (opencode-server.mjs:42797)
        SchemaParser.parseLocal
          collectIssues
            Filter.run                        (effect/dist/SchemaAST.js:2519)
              RegExp.test                     (effect/dist/SchemaAST.js:2593)
                -> RangeError: Maximum call stack size exceeded
```

The overflow comes from the quantified group `(?:[A-Za-z0-9+/]{4})*` in
OpenCode's pattern, not from Effect and not from the JS call stack:

- The pattern is the trigger. `(?:[A-Za-z0-9+/]{4})*` overflows at ~4.47 M
  chars, while the single-character-class form `^[A-Za-z0-9+/]*$` matches
  27,962,028 chars (20 MiB decoded) in ~26 ms.
- It is not the machine stack: `--stack-size=984`, `2000`, and `4000` (JS
  recursion depth 6,205 vs 42,471) all leave the boundary at 4,473,912 /
  4,473,916 chars, and it is reproducible across processes.
- Both V8 regexp execution paths fail at roughly the same input length:
  forcing the interpreter (`--regexp-interpret-all`) moves the boundary by
  only one group (4,473,920 pass / 4,473,924 fail) and still throws at
  27,962,028 chars. The limit is internal to V8's regexp engine and tracks
  input length, not the JS stack.
- Effect does not catch it: the `RangeError` escapes `Base64.make` as a defect
  (not a `SchemaIssue`), which is why the HTTP layer answers 500 with an empty
  body.

The failure is deterministic for a given V8 build and string content, but the
exact boundary is not a contract and can shift by one 4-character group with
the final padding group.

## Threshold measurements

Standalone Node v24.20.0, applying the exact pattern and the pinned schema
(`Base64.make`) to canonical base64 of repeated `0x41` bytes:

| Decoded size               | Base64 length | Result                                         |
| -------------------------- | ------------- | ---------------------------------------------- |
| 3 MiB (3,145,728 B)        | 4,194,304     | accepted                                       |
| 3,355,435 B (3.199992 MiB) | 4,473,916     | accepted (tail `QQ==`)                         |
| 3,355,436 B (3.199993 MiB) | 4,473,916     | `RangeError: Maximum call stack size exceeded` |
| 3.5 MiB (3,670,016 B)      | 4,893,356     | `RangeError`                                   |
| 20 MiB − 1 B               | 27,962,028    | `RangeError`                                   |

Largest reliably passing base64 length on this machine: 4,473,912 chars
(3,355,434 bytes decoded). First failing length: 4,473,916 chars
(≈3.2 MiB decoded, base64 input of 4.47 MB). The cutoff is an engine-internal
limit on this V8 build, not a documented contract: it may differ on other
Node/V8 builds.

## Minimal reproduction

Server-independent (Node.js v24.20.0, no dependencies):

```js
const pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
pattern.test("A".repeat(4_473_916));
// RangeError: Maximum call stack size exceeded
//     at RegExp.test (<anonymous>)
```

Against the pinned schema:

```js
import { Base64 } from "@opencode/schema/dist/prompt.js";
Base64.make("A".repeat(4_473_916));
// RangeError: Maximum call stack size exceeded
//     at RegExp.test (<anonymous>)
//     at makeFilter.expected (effect/dist/SchemaAST.js:2593:20)
//     at Filter.run (effect/dist/SchemaAST.js:2519:85)
//     at Module.collectIssues (effect/dist/SchemaAST.js:3184:27)
//     at parseLocal (effect/dist/SchemaParser.js:930:36)
```

End to end:

1. Start the pinned server with authenticated local access.
2. Create a session.
3. Send one prompt with a single inline text attachment whose decoded bytes are
   3.5 MiB:

   ```js
   const text = "a".repeat(3.5 * 1024 * 1024);
   await fetch(`${server.url}/api/session/${session.id}/prompt`, {
     method: "POST",
     headers: { ...server.headers, "content-type": "application/json" },
     body: JSON.stringify({
       text: "Probe",
       files: [
         {
           uri: `data:text/plain;base64,${Buffer.from(text).toString("base64")}`,
           name: "probe.txt",
         },
       ],
     }),
   });
   ```

4. Repeat with a server-local `file:` URI pointing at the same content: the
   result is identical, so the failure is in materialization, not HTTP body
   size.

Observed on the pinned release:

| Decoded size | `data:` URI                               | `file:` URI                          |
| ------------ | ----------------------------------------- | ------------------------------------ |
| 2 MiB        | accepted, exact bytes stored              | accepted, exact bytes stored         |
| 3 MiB        | accepted (base64 exactly 4,194,304 chars) | accepted                             |
| 3.5 MiB      | HTTP 500, empty body, nothing stored      | HTTP 500, empty body, nothing stored |
| 4–20 MiB − 1 | HTTP 500, empty body, nothing stored      | HTTP 500, empty body, nothing stored |

The client SDK surfaces it as `UnexpectedStatus`.

Server log for the 4 MiB attempt:

```
RangeError: Maximum call stack size exceeded
    at RegExp.test (<anonymous>)
    at makeFilter.expected (effect/dist/SchemaAST.js:2593)
    at Schema.make (opencode-server.mjs:42797)
    at SessionPrompt.normalizeImageAttachment (opencode-server.mjs:42785)
    at SessionPrompt.materializeAttachment
    at SessionPrompt.prepare
```

## Upstream status

Checked 2026-09-22 against the npm registry and the public repository
(`github.com/anomalyco/opencode`, default branch `dev`):

- Not fixed in the release channel. Latest published
  `@opencode/schema@2.0.13` ships a byte-identical `dist/prompt.js` (same
  sha256 as the pinned 2.0.3), and `@opencode/core@2.0.13` still calls
  `Base64.make(Buffer.from(content).toString("base64"))` from
  `materializeAttachment`/`normalizeImageAttachment` with the same 20 MiB
  `MAX_ATTACHMENT_BYTES`.
- Not fixed in Effect. Latest `effect@4.0.0-rc.117` still runs
  `pattern.test(s)`; the only change in `isPattern` since rc.112 is the
  `arbitrary` -> `arbitraryConstraint` annotation shape. No matching issue in
  `github.com/Effect-TS/effect`.
- The unreleased `dev` branch has restructured prompt schemas
  (`packages/schema/src/prompt.ts`, `prompt-input.ts`) so `FileAttachment` is
  `{ uri, mime, name, ... }` with no inline base64 `data`, and the core prompt
  module re-exports `@opencode-ai/schema/prompt`. The failing validation path
  appears absent there, but this is unreleased and not a verified fix.
- Existing upstream issues (same validator, different failure modes, both
  open, no linked fix):
  - #45558 attachments: dragging file or pasting file path into input fails
    session setup (Prompt.Base64 500 on /prompt) -
    https://github.com/anomalyco/opencode/issues/45558 (still reproducing on
    2.0.3; the failure there is a schema `InvalidValue`, not the stack
    overflow)
  - #50336 Mentioning/Opening large xlsx file crashes session -
    https://github.com/anomalyco/opencode/issues/50336 (2.0.12)
- No issue or PR was found for this stack overflow (searches for
  "Maximum call stack size exceeded" + base64, and `Prompt.Base64` +
  `RangeError`, return no matching report).

## Expected

- An attachment up to the documented 20 MiB cap is accepted and stored.
- A payload over the cap is rejected with a typed, non-empty error that names
  the limit (the `Attachment exceeds the 20971520 byte limit` response used for
  oversize `file:` inputs is a good shape).
- Validation does not recurse per group.

## Actual

- Decoded content above roughly 3.2 MiB returns HTTP 500 with an empty body and
  stores nothing, for both inline `data:` and server-local `file:` URIs.
- The failure is a `RangeError` from validating `Prompt.Base64` with
  `Schema.isPattern(/^(?:[A-Za-z0-9+/]{4})*…$/)`: Effect's `makeFilter` calls
  `RegExp.test` on the whole base64 string, and V8's compiled regexp engine
  overflows for multi-megabyte inputs.
- The size cap is already checked before validation for both URI kinds
  (`materializeAttachment`, `opencode-server.mjs:42776`), so the 20 MiB limit
  itself is fine; the validator is the broken step.
- The client cannot distinguish "too large" from a server defect, so retrying
  is pointless and the user sees a generic send failure.

## Suggested fix direction

- Replace the catastrophic pattern in `@opencode/schema` with a stack-safe
  equivalent. The following was verified to produce the same verdict as the
  current pattern (0 mismatches over 299,593 exhaustive strings of length ≤ 6
  over `{A,B,/,+,=,a,space,\n}` and 200,000 random strings), and it accepts
  27,962,028 chars (20 MiB decoded) in ~26 ms:

  ```ts
  const base64Body = /^[A-Za-z0-9+/]*$/; // single unbounded class: no regexp recursion
  const isBase64 = (value: string): boolean => {
    if (value.length % 4 !== 0) return false;
    const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
    return base64Body.test(value.slice(0, value.length - padding));
  };
  export const Base64 = Schema.String.check(
    Schema.makeFilter(isBase64, {
      expected: "a base64 string",
      representation: { id: "Prompt.Base64", payload: null },
    }),
  ).annotate({ identifier: "Prompt.Base64" });
  ```

  Note: `Buffer.from(value, "base64")` round-trip is also stack-safe but is not
  verdict-equivalent: it rejects non-canonical padding (`"AB=="`, `"AAB="`)
  that the current pattern accepts. Either behavior is defensible; choosing it
  intentionally would tighten validation for a few malformed inputs.

- Add a regression test at ≥3.5 MiB decoded for both `data:` and `file:` inputs
  that asserts a stored attachment, plus a Node-level test on `Base64.make`
  with a 4.5 M-character string.
- Optionally, return the typed oversize error when a `data:` URI exceeds
  `MAX_ATTACHMENT_BYTES` before decoding, mirroring the `file:` stat check.

## Evidence

Recorded by the Phase 4 attachment spike (throwaway worktree
`spike-attachments`): scripts `spike-attachments-e2e.mjs`,
`spike-attachments-limit.mjs`, `spike-attachments-error.mjs`, logs
`attachments-e2e-*.log`, `attachments-limit-*.log`, `attachments-error-*.log`,
and the captured server log `ocui-spike-attachments-server-error.log` under the
session spikes directory.

Root-cause reproduction (throwaway scripts under the session temp directory,
not committed): `repro.mjs` (direct pattern, binary-search threshold, stack
trace), `variants.mjs` (isolates `(?:…{4})*` and engine flags),
`real-schema.mjs` (pinned `@opencode/schema` + `effect` stack trace and
malformed-input parity), `byte-threshold.mjs` (smallest failing decoded size),
`equivalence.mjs` (replacement equivalence and 20 MiB run).
