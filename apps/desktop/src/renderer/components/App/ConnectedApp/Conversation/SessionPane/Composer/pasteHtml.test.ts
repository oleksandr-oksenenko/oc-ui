import { describe, expect, it } from "vite-plus/test";

import { MAX_HTML_INSPECTION_UNITS, MAX_HTML_NESTING, sanitizePastedHtml } from "./pasteHtml.ts";

describe("sanitizePastedHtml", () => {
  it("keeps allowed links and images with web URLs", () => {
    const html =
      '<p>See <a href="https://example.com/spec">the spec</a>.</p><img src="https://example.com/a.png" alt="A">';
    const sanitized = sanitizePastedHtml(html);
    expect(sanitized).toContain('href="https://example.com/spec"');
    expect(sanitized).toContain('src="https://example.com/a.png"');
    expect(sanitized).toContain('alt="A"');
  });

  it("drops unsafe link schemes while keeping the link text", () => {
    for (const href of ["javascript:alert(1)", "data:text/html,<script>", "file:///etc/passwd"]) {
      const sanitized = sanitizePastedHtml(`<p><a href="${href}">click</a></p>`);
      expect(sanitized).not.toContain("href");
      expect(sanitized).toContain("click");
    }
    expect(sanitizePastedHtml('<a href="mailto:team@example.com">mail</a>')).toContain(
      'href="mailto:team@example.com"',
    );
  });

  it("removes images whose source the editor cannot load", () => {
    for (const src of [
      "file:///tmp/a.png",
      "blob:https://example.com/x",
      "data:image/png;base64,AAAA",
    ]) {
      const sanitized = sanitizePastedHtml(`<img src="${src}" alt="stale">`);
      expect(sanitized).not.toContain("src");
    }
  });

  it("keeps schema-relevant structure and slice context", () => {
    const html =
      '<article data-pm-slice="1 1 []"><h1>Title</h1><ul><li>one</li><li>two</li></ul><pre><code>const x = 1;</code></pre></article>';
    const sanitized = sanitizePastedHtml(html);
    expect(sanitized).toContain("data-pm-slice");
    expect(sanitized).toContain("<h1>Title</h1>");
    expect(sanitized).toContain("<li>one</li>");
    expect(sanitized).toContain("<pre><code>const x = 1;</code></pre>");
  });

  it("keeps text from unsupported blocks and drops script content", () => {
    const sanitized = sanitizePastedHtml(
      "<table><tr><td>cell</td></tr></table><script>alert(1)</script><style>p{}</style>",
    );
    expect(sanitized).toContain("cell");
    expect(sanitized).not.toContain("alert");
    expect(sanitized).not.toContain("color");
  });
});

describe("sanitizePastedHtml nesting bounds", () => {
  it("counts a non-void self-closing tag as an open element", () => {
    // HTML reads `<div/>` as an open element; only void tags self-close.
    expect(sanitizePastedHtml(`${"<div/>".repeat(MAX_HTML_NESTING + 1)}deep`)).toBe("");
    expect(sanitizePastedHtml(`${'<div class="x"/>'.repeat(MAX_HTML_NESTING + 1)}deep`)).toBe("");
    expect(sanitizePastedHtml(`${"<div/>".repeat(MAX_HTML_NESTING)}deep`)).toContain("deep");
    // Void elements never nest, whatever their spelling.
    expect(sanitizePastedHtml(`${"<br/>".repeat(600)}deep`)).toContain("deep");
    expect(sanitizePastedHtml(`${"<img>".repeat(600)}deep`)).toContain("deep");
  });

  it("ignores a closer that does not match the innermost open element", () => {
    // HTML ignores `</bogus>` instead of closing the div, so repeated
    // `<div></bogus>` still nests one element per div.
    expect(sanitizePastedHtml(`${"<div></bogus>".repeat(MAX_HTML_NESTING + 1)}deep`)).toBe("");
    expect(
      sanitizePastedHtml(`${"<div><span></bogus></bogus>".repeat(MAX_HTML_NESTING + 1)}deep`),
    ).toBe("");
    // A closer that matches the innermost element still closes it.
    expect(sanitizePastedHtml(`${"<div></div>".repeat(MAX_HTML_NESTING)}deep`)).toContain("deep");
    // An outer closer cannot reach past the innermost element.
    expect(sanitizePastedHtml(`${"<div><span></div>".repeat(MAX_HTML_NESTING)}deep`)).toBe("");
  });
});

describe("sanitizePastedHtml adversarial input", () => {
  it("refuses self-closing and unmatched-closer nesting before parsing", () => {
    const payloads = [
      `${"<div/>".repeat(MAX_HTML_NESTING + 1)}deep`,
      `${"<div></bogus>".repeat(MAX_HTML_NESTING + 1)}deep`,
    ];
    for (const html of payloads) {
      const started = performance.now();
      expect(sanitizePastedHtml(html)).toBe("");
      expect(performance.now() - started).toBeLessThan(1_000);
    }
  });

  it("refuses a payload past the inspection size without sanitizing it", () => {
    const plain = "a".repeat(MAX_HTML_INSPECTION_UNITS + 1);
    expect(sanitizePastedHtml(plain)).toBe("");
    // One unit shorter is sanitized: the size bound, not the text, refuses it.
    expect(sanitizePastedHtml(plain.slice(0, MAX_HTML_INSPECTION_UNITS))).toContain("a");
  });

  it("refuses markup nested past the bound before parsing it", () => {
    const html = `${"<div>".repeat(50_000)}deep${"</div>".repeat(50_000)}`;
    const started = performance.now();
    const sanitized = sanitizePastedHtml(html);
    const elapsed = performance.now() - started;
    expect(sanitized).toBe("");
    // Without the depth guard this parse costs seconds and can overflow the
    // serializer's call stack.
    expect(elapsed).toBeLessThan(1_000);
  });

  it("still parses markup exactly at the nesting bound", () => {
    const html = `${"<div>".repeat(MAX_HTML_NESTING)}deep${"</div>".repeat(MAX_HTML_NESTING)}`;
    const started = performance.now();
    const sanitized = sanitizePastedHtml(html);
    expect(sanitized).toContain("deep");
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("sanitizes very many elements and attributes within a bounded time", () => {
    const html = Array.from(
      { length: 10_000 },
      (_, index) =>
        `<p><a href="https://x.dev/${index}" title="link ${index}" rel="nofollow">anchor ${index}</a></p>`,
    ).join("");
    const started = performance.now();
    const sanitized = sanitizePastedHtml(html);
    const elapsed = performance.now() - started;
    expect(sanitized).toContain("anchor 9999");
    // Disallowed attributes are dropped instead of copied through.
    expect(sanitized).not.toContain("rel=");
    expect(elapsed).toBeLessThan(3_000);
  });

  it("survives malformed markup without throwing", () => {
    const html =
      `${"<p>".repeat(400)}unclosed <b>bold <a href="https://x.dev/a(b)">link</a>` +
      `${"</div>".repeat(200)}<<!-- --><>&#x110000;&notanentity;<script>alert(1)</script>`;
    const started = performance.now();
    const sanitized = sanitizePastedHtml(html);
    const elapsed = performance.now() - started;
    expect(sanitized).toContain("unclosed");
    expect(sanitized).not.toContain("alert");
    expect(elapsed).toBeLessThan(2_000);
  });
});
