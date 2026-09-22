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
roughly 3 MiB of decoded content, then fails with HTTP 500 and an empty body for
larger payloads. Nothing is stored. The documented per-file cap is 20 MiB
(`MAX_ATTACHMENT_BYTES` in `SessionPrompt.materializeAttachment`), so the
reachable ceiling is far below the contract and the failure is opaque to
clients.

## Minimal reproduction

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

The cutoff is stack-dependent (Node build/stack size), not a documented
contract: on this machine it sits between 4.19 MB and 4.92 MB of base64
(≈3.0–3.5 MiB decoded). The client SDK surfaces it as `UnexpectedStatus`.

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

## Expected

- An attachment up to the documented 20 MiB cap is accepted and stored.
- A payload over the cap is rejected with a typed, non-empty error that names
  the limit (the `Attachment exceeds the 20971520 byte limit` response used for
  oversize `file:` inputs is a good shape).
- Validation does not recurse per character.

## Actual

- Decoded content above roughly 3 MiB returns HTTP 500 with an empty body and
  stores nothing, for both inline `data:` and server-local `file:` URIs.
- The failure is a `RangeError` from validating `Prompt.Base64` with a schema
  pattern (`Schema.isPattern(/^(?:[A-Za-z0-9+/]{4})*…$/)`): Effect's
  `makeFilter.expected` calls `RegExp.test` on the whole base64 string, and V8's
  regexp engine overflows the stack for multi-megabyte inputs.
- The client cannot distinguish "too large" from a server defect, so retrying
  is pointless and the user sees a generic send failure.

## Suggested fix direction

- Validate base64 with a bounded, non-recursive check (length and alphabet
  classes, or `Buffer.from(value, "base64")` round-trip for the size the server
  already reads into memory) instead of a single catastrophic pattern.
- Split materialization so the size cap is checked before base64 validation and
  return the typed oversize error for every URI kind.
- Add a regression test at 3.5 MiB decoded for both `data:` and `file:` inputs.

## Evidence

Recorded by the Phase 4 attachment spike (throwaway worktree
`spike-attachments`): scripts `spike-attachments-e2e.mjs`,
`spike-attachments-limit.mjs`, `spike-attachments-error.mjs`, logs
`attachments-e2e-*.log`, `attachments-limit-*.log`, `attachments-error-*.log`,
and the captured server log `ocui-spike-attachments-server-error.log` under the
session spikes directory.
