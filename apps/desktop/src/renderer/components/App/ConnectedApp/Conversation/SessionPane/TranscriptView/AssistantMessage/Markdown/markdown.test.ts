import { describe, expect, it, vi } from "vite-plus/test";

import { createMarkdownCache } from "./markdown.ts";

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
