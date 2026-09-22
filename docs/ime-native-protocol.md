# Native IME protocol — Composer (ProseMirror)

Manual protocol for a human running the Electron app on macOS with real input
methods. Synthetic tests cannot drive an IME; this protocol is the only way to
confirm the Enter/commit ordering, menu interactions, and input-rule behavior
of Chinese, Japanese, and Korean input. It is a release gate before shipping
IME support: run it once on the release candidate and record the results.

- App: the release candidate build (record the commit and build), not only
  `pnpm dev`.
- Record: app commit/build, macOS version, Electron/Chromium version, input
  source versions, and the date.
- Use a throwaway project/session so submitted messages are harmless.
- Do not record API keys, tokens, or personal data.
- One verification owner: run each scenario once, in order, and paste the
  console log into the report. If a scenario sends unexpectedly, note the
  input source and exact key sequence and continue with the next scenario.

## Setup

1. Add the three input sources: System Settings → Keyboard → Text Input →
   Input Sources → Edit… → add
   - **Pinyin – Simplified** (Chinese, Simplified),
   - **Japanese – Hiragana** (Kotoeri; the same source covers Katakana/Kanji),
   - **2-Set Korean**.
2. Switch input sources with the Globe/Fn key (or Control+Space). Confirm the
   menu bar indicator changes before each scenario.
3. Open DevTools in the renderer window (View → Toggle Developer Tools) and
   paste this logger in the Console. It records every relevant event on the
   prompt editor with a timestamp.

```js
const editor = document.querySelector('[aria-label="Prompt"]');
const stamp = () => performance.now().toFixed(1);
const on = (type, phase) =>
  editor.addEventListener(
    type,
    (event) => {
      const data =
        type.startsWith("composition") || type === "beforeinput"
          ? ` data=${JSON.stringify(event.data)}`
          : "";
      const key =
        type.startsWith("key") || type === "beforeinput" || type.startsWith("composition")
          ? ` key=${event.key ?? ""} keyCode=${event.keyCode ?? ""} isComposing=${event.isComposing ?? ""}`
          : "";
      const prevented = event.defaultPrevented ? " defaultPrevented" : "";
      console.log(`${stamp()} ${phase} ${type}${key}${data}${prevented}`);
    },
    true,
  );
const watch = (type) => {
  on(type, "DOM");
  window.addEventListener(type, (e) => {
    if (e.target === editor)
      console.log(
        `${stamp()} WINDOW ${type} key=${e.key ?? ""} keyCode=${e.keyCode ?? ""} isComposing=${e.isComposing ?? ""}`,
      );
  });
};
watch("keydown");
watch("keyup");
watch("compositionstart");
watch("compositionupdate");
watch("compositionend");
watch("beforeinput");
console.log("IME logger installed");
```

4. Before each scenario, clear the draft with Select All (Cmd+A) and Backspace,
   and log a marker in the console: `console.log("--- scenario B ---")`.
5. "Send" means the draft clears and a user message appears in the transcript.
   "Commit" means the IME converts the underlined composition into the final
   characters while the draft stays in the composer.

## D1 — the committing Enter

The open question this protocol exists to settle: when an IME commits with
Enter, does the platform deliver that physical press as a `keydown` **after**
`compositionend` with `isComposing: false` and `keyCode: 13`? If it does, the
composer sees a genuine Enter and sends the draft. Synthetic tests cannot
distinguish that Enter from a second press, so no suppression flag or timing
heuristic is implemented until this run says which browser/IME pairs do it.
For every Enter in scenarios B–E record the order of the `keydown` and
`compositionend` lines and the `isComposing`/`keyCode` values.

## Scenarios and expected outcomes

Record for every Enter: the order of `keydown` / `compositionend` lines, the
`isComposing` and `keyCode` values, and whether the composer sent.

### A. Control (ABC input source)

1. Type `hello`.
2. Press Enter.

Expected: sends `hello`. No composition events. This confirms the harness and
the baseline contract (Enter sends, Shift+Enter breaks a line).

### B. Chinese Pinyin — commit then send

1. With Pinyin, type `nihao` (composition underline appears).
2. Press Enter once to select/commit 你好.
3. Press Enter again.

Expected: the first Enter commits only; nothing sends during or immediately
after the commit. Depending on the input method, that Enter may commit the raw
Latin text instead of the selected candidate — record which happened. The
invariant is no accidental submission, not the committed text; the second Enter
sends whatever the first committed. **Failure shape:** the first Enter sends a
partial draft or the raw pinyin.

### C. Chinese Pinyin — Space commit and fast Enter

1. Type `nihao`.
2. Press Space to commit 你好.
3. Immediately (within 500 ms) press Enter.

Expected: sends 你好 once. There is no composition at the time of the second
keypress. **Failure shape:** no send (dropped key) or a double send.

### D. Japanese — double conversion then send

1. With Japanese, type `konnichiwa`; press Space to convert to 今日は.
2. Press Enter to confirm the conversion.
3. Press Enter to send.

Expected: step 2 commits, step 3 sends 今日は. Note which Enter produced
`compositionend` relative to `keydown`. **Failure shape:** step 2 sends.

### E. Korean — live assembly

1. With 2-Set Korean, press the physical keys `dkssud` (the keys for 안녕); the
   syllables assemble without an explicit commit (compositionend may fire
   between syllables). `annyeong` does not transliterate in 2-Set.
2. Press Enter and record whether it arrived while a composition was active.
3. With a fresh draft, press `dkssud` and press Cmd+Enter.

Expected: if the composition had ended before Enter, step 2 sends 안녕 exactly
once; if Enter arrived during composition, it commits and does not send. Record
which sequence occurred — do not assume the send. Step 3 queues exactly once.
Korean often ends the composition before the Enter keydown, so this is the
highest-risk case for accidental send.

### F. Slash menu while an IME is active

1. Switch to Pinyin. Type `/` (menu opens with Commands/Skills).
2. Start typing pinyin immediately, e.g. `b`, `u`, `i`…; if the menu is still
   open, note it; keep composing until candidates appear.
3. Press Enter to commit the composition (do not select a menu item).
4. Start a new composition and press Escape to cancel it (keep this separate
   from the commit in step 3).
5. Clear, type `/`, and press Enter with no composition.

Expected:

- Step 2: starting a composition closes the menu (no suggestion menu over the
  composing text).
- Step 3: Enter commits the IME; the item is not selected and nothing sends.
- Step 4: Escape cancels the new composition; it must not send.
- Step 5: with the menu open and no composition, Enter inserts the first
  suggestion (e.g. `/build `) and does not send.

**Failure shape:** Enter during composition selects a suggestion; Enter while
composing sends the draft; Escape sends.

### G. Shift+Enter during composition

1. With Japanese, type `konnichiwa` (composition active).
2. Press Shift+Enter.
3. Press Shift+Enter again.

Expected: the first Shift+Enter is consumed by the IME (conversion or commit),
never by the editor as a line break while the composition is active. After the
composition has ended, Shift+Enter inserts a line break; Enter still sends.

### H. Tab during composition

1. With Pinyin, start a composition.
2. Press Tab, then Shift+Tab.

Expected: no list indentation and no suggestion-menu selection while composing.
If the IME uses Tab for candidate selection, the candidate list changes instead.
After committing, Tab in a list item indents (control).

### I. Input rules around IME text

1. Switch to ABC. Type `**` (two asterisks).
2. Switch to Pinyin and type `nihao`, commit 你好 with Space (not Enter).
3. Type `**`.
4. Press Enter.

Expected: step 2–3 must not transform text while the composition is active.
After the final `**` is typed, the committed `**你好**` may become bold; the
draft text stays `**你好**`. Step 4 sends the current draft. **Failure shape:**
the delimiters are consumed or a mark is applied mid-composition, or Enter
submits before the rule settles.

### J. Dead keys (US/ABC layout)

1. Switch to ABC (U.S.), type Option+E then `e` (é appears).
2. Press Enter.

Expected: `é` is inserted once; Enter sends `é`. No composition events are
required for dead keys.

### K. Multiline with IME

1. Pinyin: type `nihao`, press Enter to commit 你好.
2. Press Shift+Enter.
3. Type `shijie`, commit 世界 with Enter.
4. Press Enter.

Expected: the first Enter commits, Shift+Enter adds a line, the next Enter
commits, the last Enter sends `你好\n世界`. **Failure shape:** an early send or
two line breaks.

### L. Queue and steer while composing

1. Start a long-running session (prompt that takes a while to answer).
2. With Pinyin, type `nihao`; press Enter (commit) then Cmd+Enter, or press
   Cmd+Enter while the composition is active.
3. Also try typing while the session runs and pressing Enter.

Expected: no queue or steer during an active composition; committing first and
then the modifier chord queues/steers once. **Failure shape:** partial text
queued/steered.

## What to record per scenario

- Input source and exact key sequence (including Globe switches).
- Console excerpt from the marker line to the final event, untrimmed for the
  Enter lines. The key question for every Enter: does `compositionend` come
  before or after `keydown`, and what are `isComposing`/`keyCode`?
- Draft text before and after, and whether the transcript received a message.
- Pass/fail against the expected outcome, plus a screenshot when the failure is
  visual (menu state, candidate window).
- Anything the synthetic tests cannot express: candidate window behavior,
  composition position, undo history, cursor jumps.
