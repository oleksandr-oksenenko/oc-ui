# Native IME release checklist — Composer (ProseMirror)

> **Status: deferred (2026-09-23).** The current maintainer does not type
> through an IME, so this run is not a gate for the current change. The
> implemented guards stay in the editor (composition closes the suggestion
> menu, the menu owns Enter, the slash query is suppressed while composing),
> and synthetic tests cover them. What remains unverified: real commit/send
> ordering and menu behavior against Chinese, Japanese, and Korean input
> (scenarios A–G and I), and external replacement during an active
> composition — a confirmed send or a session switch can rebuild the editor
> state mid-composition; fixing that needs a deferral policy, not a one-line
> guard. Run this checklist before claiming IME support.

Release gate for IME support. Synthetic tests cannot drive an input method;
this checklist is the only way to confirm commit/send ordering, menu behavior,
and input rules against real Chinese, Japanese, and Korean input. Run it once
on the release candidate and record the result.

## Environment

- Packaged release candidate, not only `pnpm dev`. Record date, app
  commit/build, macOS version, Electron/Chromium version, input-source versions.
- Use a throwaway project/session. Do not record API keys, tokens, or personal
  data. One verification owner: run the scenarios in order and paste the console
  log into the report; if a scenario sends unexpectedly, note the input source
  and exact key sequence and continue.
- Add three input sources (System Settings → Keyboard → Text Input → Input
  Sources → Edit…): **Pinyin – Simplified**, **Japanese – Hiragana** (Kotoeri;
  covers Katakana/Kanji), **2-Set Korean**. Switch with Globe/Fn (or
  Control+Space) and confirm the menu-bar indicator before each scenario.
- Open DevTools in the renderer (View → Toggle Developer Tools), paste the
  logger below, then clear the draft with Cmd+A and Backspace and log a marker
  (`console.log("--- scenario B ---")`) before each scenario.

```js
const editor = document.querySelector('[aria-label="Prompt"]');
const stamp = () => performance.now().toFixed(1);
const types = ["keydown", "keyup", "compositionstart", "compositionupdate"];
types.push("compositionend", "beforeinput");
for (const type of types) {
  editor.addEventListener(
    type,
    (e) => {
      const key = ` key=${e.key ?? ""} keyCode=${e.keyCode ?? ""} isComposing=${e.isComposing ?? ""}`;
      const data = e.data === undefined ? "" : ` data=${JSON.stringify(e.data)}`;
      console.log(
        `${stamp()} ${type}${key}${data}${e.defaultPrevented ? " defaultPrevented" : ""}`,
      );
    },
    true,
  );
}
console.log("IME logger installed");
```

**Send** = the draft clears and a user message appears in the transcript.
**Commit** = the IME converts the underlined composition into the final
characters while the draft stays in the composer.

## Scenarios

Run the scenarios in order. For every Enter, record the order of the `keydown`
and `compositionend` lines, the `isComposing`/`keyCode` values, and whether the
composer sent.

**A. Baseline and Chinese Pinyin — commit then send.** ABC: type `hello` and
press Enter; it must send with no composition events (harness check). Pinyin:
type `nihao` (composition underline), press Enter once, press Enter again.
Expected: the first Enter commits only; nothing sends during or immediately
after the commit. It may commit raw Latin instead of 你好 — record which; the
invariant is no accidental submission. **Failure:** the first Enter sends a
partial draft or the raw pinyin.

**B. Chinese Pinyin — Space commit and fast Enter.** Type `nihao`, press Space
to commit 你好, then press Enter within 500 ms. Expected: sends 你好 exactly
once. **Failure:** no send (dropped key) or a double send.

**C. Japanese — double conversion then send.** Type `konnichiwa`, press Space
to convert to 今日は, press Enter to confirm, press Enter to send. Expected:
step 2 commits, step 3 sends 今日は; note which Enter produced `compositionend`
relative to `keydown`. **Failure:** the confirm Enter sends.

**D. Korean — live assembly (highest-risk accidental send).** With 2-Set
Korean press the physical keys `dkssud` (the keys for 안녕); syllables assemble
without an explicit commit, and `compositionend` may fire between syllables
(`annyeong` does not transliterate). Press Enter: if the composition had ended,
it sends 안녕 exactly once; if not, it commits and does not send — record which.
With a fresh draft, press `dkssud` and Cmd+Enter; the chord must queue exactly
once, never mid-composition.

**E. Slash menu while an IME is active.** Pinyin: type `/` (menu opens), start
typing pinyin and keep composing (the menu must close); press Enter (commits,
no item selected, no send); start a new composition and press Escape (cancels,
no send); clear, type `/`, press Enter with no composition (inserts the first
suggestion, e.g. `/build `, no send). **Failure:** Enter during composition
selects or sends; Escape sends.

**F. Shift+Enter, multiline, and Tab.** Japanese: type `konnichiwa`
(composition active), press Shift+Enter twice — the first is consumed by the
IME, never a line break while composing; after the composition ends,
Shift+Enter adds a line and Enter sends. Pinyin: commit 你好 with Enter, press
Shift+Enter, commit 世界 with Enter, press Enter — sends `你好\n世界` exactly
once. Also confirm Tab/Shift+Tab during a composition neither indent a list nor
select a menu item.

**G. Input rules around IME text.** ABC: type `**`. Pinyin: type `nihao`,
commit 你好 with Space (not Enter), type `**`, press Enter. Expected: no
transformation during the composition; after the final `**` the draft may
render `**你好**` as bold, and Enter sends it. **Failure:** delimiters are
consumed, a mark applies mid-composition, or Enter submits too early.

**H. Dead keys (US/ABC layout).** ABC (U.S.): press Option+E then `e` (é
appears), press Enter. Expected: `é` is inserted once and Enter sends `é`; dead
keys require no composition events.

**I. Queue and steer while composing.** Start a long-running session. With
Pinyin type `nihao`, press Enter (commit) then Cmd+Enter, or press Cmd+Enter
while composing; also type while the session runs and press Enter. Expected: no
queue or steer during an active composition; committing first and then the
chord queues/steers once. **Failure:** partial text queued or steered.

## What to record

- Input source and exact key sequence, including Globe switches.
- Console excerpt from the marker to the final event, untrimmed around the
  Enter lines. For every Enter: does `compositionend` come before or after
  `keydown`, and what are `isComposing`/`keyCode`?
- Draft text before and after, and whether the transcript received a message.
- Pass/fail against the expected outcome, plus a screenshot for visual failures
  (menu state, candidate window) and anything synthetic tests cannot express:
  candidate-window behavior, composition position, undo history, cursor jumps.
