# Transcript source recovery spike

2026-09-02, worktree `e0a3`, repository revision `fd06a36`.

**Historical investigation, superseded in scope.** The user subsequently clarified that annotation happens only after the model turn finishes and source text remains unchanged. The [implementation design](transcript-annotations-design.md) is authoritative, including retained post-send source highlights and comment-popup access. Only this spike's unchanged-content offset restoration evidence applies to that design; append evidence, live event adapters, and changed-source identity/recovery are not implementation requirements. The report below preserves what was tested under the earlier assumptions.

## Result

The spike changes the proposed recovery policy. **A unique quote plus surrounding text does not establish that the original passage survived.** The candidate incorrectly reattached in three adversarial cases. The revised resolver declines uncertain recovery and passed the 28-case browser matrix and seven Node tests, including 288 generated checks.

This settles the algorithm boundary, not the full feature: preserve exact positions in unchanged sources and through verified appends that preserve the rendered prefix. Keep the note and message-level source link when exact recovery is unresolved. Do not automatically search another passage after an arbitrary source rewrite.

This supersedes the earlier suggestion to recover changed source text automatically through quote/context matching in [the initial exploration](transcript-annotation-exploration.md).

## Why the original approach fails

Consider selecting TARGET in the first of two identical passages:

```text
original section
[long identical prefix] TARGET [long identical suffix]

copied section
[long identical prefix] TARGET [long identical suffix]
```

If the first passage is deleted, only the second match remains. Its quote and nearby text are identical, but it is the wrong source occurrence. Increasing the surrounding excerpt merely increases how much duplicated text is needed to reproduce this failure.

The same before/after text can also arise from deleting the other copy. Those histories require different answers. A snapshot-only resolver cannot distinguish them. A diff or nearest-position score would choose a plausible mapping, not establish the original passage's identity.

The browser candidate also failed when a source was replaced by a different passage with identical nearby text, and when an assistant content position was reused by an identical block. These are synthetic histories with explicitly declared expected outcomes, designed to expose what snapshots cannot tell us.

## Revised resolver contract

Capture the source reference, raw source snapshot, rendered text snapshot, and selection start/end in DOM text units. The spike stores full snapshots for clarity; a production storage representation is not decided here.

Resolve in this order:

1. If the original source is absent, return unresolved. Keep the captured quote and note.
2. If source identity is uncertain, return unresolved. An array position does not establish identity.
3. If both the raw source and its rendered text are unchanged, rebuild the range from the saved offsets.
4. If a verified update appended to that same source, require both the new raw source and rendered text to retain their complete captured prefixes. Then the saved offsets still identify the selected text.
5. Otherwise, return unresolved. Do not fall back to quote-only, nearest-position, partial-context, or cross-block matching.

The spike's `sameSource` and `append` flags represent evidence supplied to the resolver. They are not invented OpenCode APIs, and the spike does not implement the runtime adapter that would establish them. A production implementation must invalidate that evidence when the source is replaced, content order changes, or stream continuity is lost. Completing a full snapshot that happens to look like an append is not append evidence.

This policy deliberately leaves some surviving passages unresolved, including insertions/deletions before a selection and Markdown rewrites. Supporting those automatically would need reliable edit/source mapping or an explicitly weaker product guarantee. A byte-identical snapshot establishes textual equivalence under a validated source binding, not unknowable historical character identity.

## Browser evidence

The temporary Storybook fixture imported the actual local `Markdown` component and changed its reactive text prop. That exercises the pinned `marked` and DOMPurify rendering path, rather than a hand-built HTML approximation. It rebuilt browser Ranges and verified their text, with an independent expected offset for repeated occurrences. A visual check confirmed the highlight remained on `Tests → Passed` after appending a third table row.

| Scenario                                                            | Conservative result                                                                  |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Unchanged source rerender                                           | Correct offset restored                                                              |
| Known streaming append, including another copy of the quote         | Original offset preserved                                                            |
| Full final snapshot merely resembles an append                      | Unresolved                                                                           |
| Reconnect loses content identity                                    | Unresolved                                                                           |
| Insertion or deletion before selected passage                       | Unresolved; no heuristic movement                                                    |
| Selected passage or block removed                                   | Unresolved                                                                           |
| Second occurrence of repeated word                                  | Correct occurrence restored                                                          |
| Multiple identical passages or deleted original duplicate           | Unresolved                                                                           |
| Source replaced with identical nearby quote/context                 | Unresolved                                                                           |
| Array position reused or another message has identical text         | Unresolved                                                                           |
| Closed source / reopened unchanged source                           | Unresolved while absent / restored when available with valid identity                |
| Streaming completes emphasis around earlier text                    | Unresolved because rendered prefix changes                                           |
| Streaming closes code fence                                         | Correct offset restored when rendered prefix is preserved                            |
| Table gains a row                                                   | Correct second occurrence restored                                                   |
| Emoji and combining characters before/inside selection              | Correct UTF-16 range restored                                                        |
| Range spanning bold/italic elements or table cells                  | Correct multi-node range restored; table native selection retained its tab separator |
| Different insertion/deletion histories yielding identical snapshots | Unresolved in both histories                                                         |

All 28 case expectations passed: 11 restored exact ranges and 17 deliberately returned unresolved. The table-row expectation was corrected during the experiment: the actual renderer preserved the full text prefix, so the correct second occurrence could be restored. The original quote/context candidate returned three wrong occurrences. These results are a bounded test outcome, not proof against every possible text history.

The separate Node suite passed seven tests, including 288 generated unchanged/append/replacement/deletion checks. It directly includes the deleted-duplicate counterexample, an invalidated source position, another message, and an append whose Markdown projection changes.

## What the pinned OpenCode client actually exposes

Verified against `@opencode-ai/client@0.0.0-beta-18155`:

- `dist/promise/generated/types.d.ts:1111`, `1372`, and `1855`: text start/delta/end events carry `sessionID`, `assistantMessageID`, and `ordinal`. Delta carries appended text; end carries the full text. Reasoning has corresponding events.
- `dist/solid/data.js:640`: text start pushes a new content item, delta appends with `+=`, and end replaces the complete text. The reducer chooses the latest item by type and does not retain the event ordinal.
- `dist/solid/data.js:739`: reasoning uses the same append/full-replacement pattern.
- `dist/promise/generated/types.d.ts:707`: projected assistant text/reasoning content has no part ID or ordinal. Tool content does have an ID.
- `dist/solid/data.js:1201`: message synchronization fetches snapshots and reconciles the message array. A current content-array position is not a durable part identity across replacement/reordering.
- `dist/solid/connection.js`: reconnect opens a fresh event subscription without replaying from a saved cursor. Ephemeral deltas cannot be assumed continuous across that boundary.

The app already owns a typed event bridge in `apps/desktop/src/renderer/opencode/event-source.ts:25`. `runtime.ts:55` feeds it to the SDK data layer and other consumers. If implementation needs live append evidence, integrate with that existing owner rather than opening a second event stream. No new endpoint or parallel transcript store is warranted by this spike.

For sources loaded from snapshots, assistant array positions still require validation against the captured message/content structure. The live event ordinal is useful for event correlation, but cannot simply be treated as an ID already present in all snapshot content. Reconnect/source replacement must degrade to unresolved when identity cannot be established.

## Artifacts and limits

Reproducible probe, runner, Node tests, and machine-readable browser results:

`/Users/alex/.codex/visualizations/2026/09/02/01a06255-3d5d-74e3-bb29-eb75229938d9/transcript-source-recovery/`

The artifact README gives reproduction steps. Temporary `AnchorRecoverySpike.stories.tsx` and `anchor-recovery-spike.mjs` were removed from the repository's stories after testing. No production files or dependency pins were changed.

Two independent read-only agents reviewed adversarial cases and the SDK event/identity contract. The parent tested the actual Markdown renderer in the in-app browser. The existing graph project was confirmed ready at generation `2026-09-02T13:48:49Z`; relevant searches/traces were complete and exact local source coverage had no recorded gaps. Installed dependencies were inspected directly because they are outside the repository graph.

This spike did not wire the live event adapter, implement draft/card/send UI, contact an OpenCode server, or verify the Electron app. Closed/reopened and identity-loss cases are resolver inputs, not new end-to-end collapse/reconnect tests. The first exploration separately exercised real collapsible mounting. There is no need for another general selection spike; the remaining adapter and lifecycle checks belong to implementation, with unresolved as the safe fallback.

After removing the temporary stories, `pnpm check` passed and `pnpm test` passed all 467 tests across 70 files. The test run emitted jsdom `scrollTo` warnings but completed successfully. The repository changes are the new spike report and the correction link in the earlier exploration document; the executable probe and its results remain in the artifact directory above.
