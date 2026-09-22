import { describe, expect, it, vi } from "vite-plus/test";

import { createMarkdownCache, renderMarkdown } from "./markdown.ts";

describe("renderMarkdown", () => {
  it("keeps file image sources inert for server resolution and preserves alt text", () => {
    const html = renderMarkdown("![Tool states](file:///Users/alex/project/tool-states.png)");

    expect(html).toContain('data-file-src="file:///Users/alex/project/tool-states.png"');
    expect(html).toContain('alt="Tool states"');
    expect(html).not.toMatch(/\ssrc="file:/);
  });

  it("moves raw HTML file image sources with the same policy", () => {
    const html = renderMarkdown('<img src="file:///tmp/shot.png" alt="shot" onerror="alert(1)">');

    expect(html).toContain('data-file-src="file:///tmp/shot.png"');
    expect(html).not.toContain("onerror");
    expect(html).not.toMatch(/\ssrc="file:/);
  });

  it("discards an author-supplied carrier attribute", () => {
    const html = renderMarkdown(
      '<img src="https://example.test/a.png" data-file-src="file:///srv/project/b.png" alt="forged">',
    );

    expect(html).toContain('src="https://example.test/a.png"');
    expect(html).not.toContain("data-file-src");
  });

  it("leaves web and data image sources unchanged", () => {
    const web = renderMarkdown("![a](https://example.test/a.png)");
    expect(web).toContain('src="https://example.test/a.png"');
    expect(web).not.toContain("data-file-src");

    const inline = renderMarkdown("![a](data:image/png;base64,AAAA)");
    expect(inline).toContain('src="data:image/png;base64,AAAA"');
    expect(inline).not.toContain("data-file-src");
  });

  it("drops other unsafe image sources and markup", () => {
    const html = renderMarkdown("![a](javascript:alert(1))\n\n<script>alert(1)</script>");

    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<script");
  });

  it("renders the composer's escaped tilde text literally, not as strikethrough", () => {
    // The composer writes every literal tilde escaped: `~~b~~` becomes
    // `\~\~b\~\~` and `~text~` becomes `\~text\~`; both must stay text.
    const pair = renderMarkdown("\\~\\~b\\~\\~");
    expect(pair).toContain("~~b~~");
    expect(pair).not.toContain("<del>");

    const single = renderMarkdown("\\~text~");
    expect(single).toContain("~text~");
    expect(single).not.toContain("<del>");
  });

  it("documents the transcript dialect: GFM strikethrough accepts one tilde", () => {
    // `marked` runs with its default GFM dialect (tables, task lists,
    // autolinks, strikethrough) plus `breaks: true`, and its `del` tokenizer
    // accepts one or two tildes. An unescaped `~text~` therefore renders as
    // `<del>`. The composer escapes every literal tilde, so drafts cannot
    // produce this form; this pins the dialect, not a desired outcome.
    expect(renderMarkdown("~text~")).toContain("<del>text</del>");
    expect(renderMarkdown("a ~text~ c")).toContain("<del>text</del>");
  });
});

describe("createMarkdownCache", () => {
  it("reuses rendered output for identical text and renders changed text", () => {
    const render = vi.fn<(source: string) => string>((source) => `<p>${source}</p>`);
    const cached = createMarkdownCache(render);

    expect(cached("a")).toBe("<p>a</p>");
    expect(cached("a")).toBe("<p>a</p>");
    expect(render).toHaveBeenCalledTimes(1);

    expect(cached("ab")).toBe("<p>ab</p>");
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("evicts least-recently-used entries beyond the entry limit", () => {
    const render = vi.fn<(source: string) => string>((source) => source.toUpperCase());
    const cached = createMarkdownCache(render, { maxEntries: 2 });

    cached("a");
    cached("b");
    cached("a");
    cached("c");
    expect(render).toHaveBeenCalledTimes(3);
    cached("a");
    cached("c");
    expect(render).toHaveBeenCalledTimes(3);
    cached("b");
    expect(render).toHaveBeenCalledTimes(4);
  });

  it("renders oversized sources without retaining them", () => {
    const render = vi.fn<(source: string) => string>((source) => String(source.length));
    const cached = createMarkdownCache(render, { maxSourceLength: 4 });

    expect(cached("12345")).toBe("5");
    expect(cached("12345")).toBe("5");
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("does not retain an output that exceeds the entry budget or flush other entries", () => {
    const render = vi.fn<(source: string) => string>((source) =>
      source === "big" ? "x".repeat(1000) : source.toUpperCase(),
    );
    const cached = createMarkdownCache(render, {
      maxSourceLength: 16,
      maxEntryLength: 64,
      maxRetainedLength: 128,
    });

    expect(cached("ok")).toBe("OK");
    expect(cached("big")).toBe("x".repeat(1000));
    expect(cached("ok")).toBe("OK");
    expect(render).toHaveBeenCalledTimes(2);
    expect(cached("big")).toBe("x".repeat(1000));
    expect(render).toHaveBeenCalledTimes(3);
  });

  it("bounds the retained source and HTML length", () => {
    const render = vi.fn<(source: string) => string>((source) => source);
    const cached = createMarkdownCache(render, { maxEntryLength: 8, maxRetainedLength: 8 });

    cached("aa");
    cached("bb");
    cached("cc");
    expect(render).toHaveBeenCalledTimes(3);
    cached("aa");
    expect(render).toHaveBeenCalledTimes(4);
    cached("cc");
    cached("cc");
    expect(render).toHaveBeenCalledTimes(4);
  });
});
