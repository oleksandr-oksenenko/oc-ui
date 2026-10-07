# Offline terminal fonts

These are unmodified upstream font binaries for the explicit Restty font chain.
Import them with Vite's `?url` suffix, load their bytes with the workspace-owned
font loader, and pass buffer inputs to Restty, primary face first. The bundled
assets do not need Local Font Access or a CDN.
Use the names below: Restty 0.3.0 classifies fonts and cell widths by their labels.

| Asset                                   | Restty name                | Coverage                                                              |      Bytes |
| --------------------------------------- | -------------------------- | --------------------------------------------------------------------- | ---------: |
| `JetBrainsMonoNerdFontMono-Regular.ttf` | `JetBrains Mono Nerd Font` | Primary monospace font with Nerd Font symbols                         |  2,470,116 |
| `NotoEmoji-Variable.ttf`                | `Noto Emoji`               | Monochrome emoji, skin tones, supported ZWJ ligatures                 |  1,982,596 |
| `NotoSansCJKsc-Regular.otf`             | `Noto Sans CJK SC`         | Han ideographs, hiragana, katakana, Hangul, Latin and combining marks | 16,437,364 |
| `NotoSansSymbols2-Regular.ttf`          | `Noto Sans Symbols 2`      | Additional technical symbols, braille, cards and dominoes             |    656,828 |

The font binaries total 21,546,904 bytes (20.55 MiB). These full upstream fonts
preserve broad coverage rather than encoding an application-specific subset.
The pinned CJK release supplies OTF, not WOFF2; retaining that original format
also avoids introducing a local font conversion/build pipeline. The SC face
uses Simplified Chinese forms for shared Han characters and also covers kana
and Hangul. This chain does not cover every Unicode script or emoji sequence.

Suggested order after the primary monospace face: Noto Emoji, Noto Sans Symbols 2,
Noto Sans CJK SC. Keep `Noto Emoji` as its name, without the word `Color`:
Restty's color-font label detection selects a different rendering path.

## Provenance and SHA-256

Downloaded on 2026-10-02 with `curl --fail --location` from these immutable URLs.
Only the local filename of the emoji variable font was simplified; its bytes
are unchanged.

### JetBrains Mono Nerd Font Mono Regular

- Embedded version: **2.304; Nerd Fonts 3.4.0**; TrueType outlines with programming ligatures.
- Repository: `ryanoasis/nerd-fonts`, release `v3.4.0`.
- Revision: `fa7b859994228a9c8759f99c55a8d31ee92a1b5e`.
- [Font](https://raw.githubusercontent.com/ryanoasis/nerd-fonts/fa7b859994228a9c8759f99c55a8d31ee92a1b5e/patched-fonts/JetBrainsMono/Ligatures/Regular/JetBrainsMonoNerdFontMono-Regular.ttf).
- [Upstream license](https://raw.githubusercontent.com/ryanoasis/nerd-fonts/fa7b859994228a9c8759f99c55a8d31ee92a1b5e/src/unpatched-fonts/JetBrainsMono/OFL.txt), reproduced in `../../public/licenses/OFL-JetBrainsMono.txt` and shipped with both builds.
- Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono).
- SHA-256: `f01031f40e48dc29e1112e6b0b0450a2c6cd097f3f35cfff05c55cb311f8034c`.

### Noto Emoji

- Embedded version: **3.002**; variable `wght` font, monochrome TrueType outlines.
- Repository: `google/fonts`.
- Revision: `8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5`.
- [Font](https://raw.githubusercontent.com/google/fonts/8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5/ofl/notoemoji/NotoEmoji%5Bwght%5D.ttf).
- [Upstream license](https://raw.githubusercontent.com/google/fonts/8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5/ofl/notoemoji/OFL.txt), reproduced in `../../public/licenses/OFL-NotoEmoji.txt` and shipped with both builds.
- Copyright 2013 Google LLC.
- SHA-256: `de6c18832938afc99caf132b39d6a30a19bac7f2e812e28db2535b4608d27551`.

### Noto Sans CJK SC Regular

- Embedded version: **2.004**; CFF OpenType outlines.
- Repository: `notofonts/noto-cjk`, release `Sans2.004`.
- Revision: `523d033d6cb47f4a80c58a35753646f5c3608a78`.
- [Font](https://raw.githubusercontent.com/notofonts/noto-cjk/523d033d6cb47f4a80c58a35753646f5c3608a78/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf).
- [Upstream license](https://raw.githubusercontent.com/notofonts/noto-cjk/523d033d6cb47f4a80c58a35753646f5c3608a78/LICENSE). Its complete OFL text is also in `../../public/licenses/OFL-NotoSans.txt` following that file's Noto Project copyright notice.
- Embedded copyright: © 2014-2021 Adobe (http://www.adobe.com/).
- SHA-256: `2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b`.

### Noto Sans Symbols 2 Regular

- Embedded version: **2.003**; TrueType outlines.
- Repository: `notofonts/noto-fonts`.
- Revision: `ffebf8c1ee449e544955a7e813c54f9b73848eac`.
- [Font](https://raw.githubusercontent.com/notofonts/noto-fonts/ffebf8c1ee449e544955a7e813c54f9b73848eac/unhinted/ttf/NotoSansSymbols2/NotoSansSymbols2-Regular.ttf).
- [Upstream license](https://raw.githubusercontent.com/notofonts/noto-fonts/ffebf8c1ee449e544955a7e813c54f9b73848eac/LICENSE), reproduced in `../../public/licenses/OFL-NotoSans.txt` and shipped with both builds.
- Embedded copyright: Copyright 2017 Google Inc. All Rights Reserved.
- SHA-256: `882d142b9a1ef3fd7fa4225dbe95c10fab6664206eb4964c8ff705a4f6d02988`.

All four fonts are licensed under **SIL Open Font License 1.1**. Retain these
license files and copyright notices when redistributing the fonts. The font
metadata also retains the original copyright and licensing records.

## Installed-engine verification

Verified using **Restty 0.3.0**'s nested **text-shaper 0.1.28** in Node, with
`Font.load`, `shape`, `UnicodeBuffer`, and `rasterizeGlyph` at size 24 for the
Unicode fallbacks, and size 13 for the primary font investigation below. All fonts
parsed; all listed shaped glyph IDs were nonzero and produced nonempty grayscale
bitmap pixels (`pixelMode: 1`).

| Font                | Parsed glyph count | Sample                | Shaped glyph IDs                          |
| ------------------- | -----------------: | --------------------- | ----------------------------------------- |
| Noto Emoji          |              1,891 | `👩🏽‍💻`                  | `1455` (one ZWJ ligature, raster 29 × 25) |
| Noto Emoji          |              1,891 | `😀` / `❤️`           | `895` / `170`                             |
| Noto Sans CJK SC    |             65,535 | `é` (e + U+0301)      | `70, 253`                                 |
| Noto Sans CJK SC    |             65,535 | `中文`                | `9544, 20036`                             |
| Noto Sans CJK SC    |             65,535 | `かなカナ`            | `1470, 1501, 1564, 1595`                  |
| Noto Sans CJK SC    |             65,535 | `한글`                | `58199, 48123`                            |
| Noto Sans Symbols 2 |              2,674 | `⏻` / `⠿` / `🂡` / `🀱` | `1799` / `624` / `2147` / `2047`          |

The requested emoji is one ligature rather than separately drawn woman,
skin-tone modifier, and laptop glyphs. Noto Emoji uses outlines that the installed
shaper rasterizes directly, so it does not depend on an OS emoji font.

Noto Color Emoji was investigated because it is in Restty's default chain. Its
CBDT bitmap font parsed and shaped this sample, but `rasterizeGlyph` returned
`null`; Restty's color atlas instead calls canvas `fillText` with font-family
names. Restty 0.3.0 does not register downloaded font data as a browser `FontFace`.
Monochrome Noto Emoji therefore supplies both offline outlines and shaping while
saving approximately 8.29 MiB compared with the investigated color TTF.

Parser/raster checks establish asset compatibility; terminal layout and visual
rendering are checked by the integrating terminal's acceptance flow.

### Primary WOFF2 decoder and hinting investigation

The `@opencode/ui` 2.0.3 WOFF2 and this TTF contain the same embedded font version,
glyph count (12,138), and glyph IDs. With text-shaper 0.1.28, their decoded ASCII
outlines disagree for U+0060 (grave accent), U+0069 (`i`), and U+006A (`j`). The
WOFF2 decoder produces diagonal/corrupted `i` and `j` strokes; the TTF produces
the expected upright letters. The problem reproduces with direct
`Font.loadAsync` and `rasterizeGlyph`, without the terminal renderer or ligature
shaping.

Use this TTF as the primary face, with `fontHinting: false` (Restty's default).
Turning hinting on does not fix the WOFF2 corruption, and it makes the `W` raster
at size 13 extend to 20 pixels high instead of 10 in both formats. No ligature
change is required: individual `i` and `f` retain glyph IDs 77 and 74, while
programming operator ligatures shape identically in the two formats.

### Monochrome emoji sizing

`Noto Emoji` correctly selects the monochrome outline font for `👩🏽‍💻`. Its
`emoji` label gives it a two-cell span without selecting Restty's canvas/color
path. All non-ignorable characters in that sequence pass the fallback's visible
raster coverage probe; the primary JetBrains font has no woman, modifier, or
laptop glyphs.

Executing the installed runtime picker and fallback-layout functions with these
font instances confirms: `👩🏽‍💻` selects font index 1 and glyph 1455, `é`
selects primary font index 0 and glyphs 73/371, and `中文` selects font index 3
and glyphs 9544/20036. The emoji shown at small size is the actual outline
ligature, not the missing-glyph fallback.

Restty's fallback-layout metric adjustment shrinks this face to approximately
0.787 of its em size: primary cap height 730/1000 divided by emoji cap height
1900/2048. This produces a faint miniature at the terminal's size-13 setting,
despite the correctly shaped ligature. A targeted override compensates:

```ts
fontHinting: false,
fontScaleOverrides: [{ match: /^Noto Emoji$/, scale: 1.25 }],
```

The resulting glyph remains constrained to two terminal cells. At size 13,
direct raster comparisons at the metric-adjusted size (10.23) and compensated
size (12.79) show the expected woman/laptop outline becoming larger and clearer.
Keep the label `Noto Emoji`; adding `Color` would route it to the system-font
canvas path instead of using its bundled outlines.
