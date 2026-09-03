import { describe, expect, it } from "vite-plus/test";

import { annotationBlock, projectAnnotationSource } from "./annotation-source.ts";

describe("annotationBlock", () => {
  it("keeps values with separators distinct", () => {
    expect(annotationBlock("a", "b,c")).not.toBe(annotationBlock("a,b", "c"));
    expect(annotationBlock("1")).not.toBe(annotationBlock(1));
  });
});

describe("projectAnnotationSource", () => {
  it("projects formatted text and maps text and element boundaries", () => {
    const block = document.createElement("div");
    block.innerHTML = "one <strong>two</strong> three";
    const source = projectAnnotationSource(block);
    const strong = block.querySelector("strong")!;
    const textNode = strong.firstChild!;

    expect(source.text).toBe("one two three");
    expect(source.offset(textNode, 1)).toBe(5);
    expect(source.offset(block, 1)).toBe(4);
    expect(source.offset(block, 2)).toBe(7);
    expect(source.range(4, 7)?.toString()).toBe("two");
  });

  it("uses UTF-16 offsets and reconstructs repeated occurrences without searching", () => {
    const block = document.createElement("div");
    block.innerHTML = "two 😀 two";
    const source = projectAnnotationSource(block);

    expect(source.text).toBe("two 😀 two");
    expect(source.range(0, 3)?.toString()).toBe("two");
    expect(source.range(7, 10)?.toString()).toBe("two");
    expect(source.offset(block.firstChild!, 6)).toBe(6);
  });

  it("rejects excluded controls, hidden content, nested blocks, and crossing ranges", () => {
    const block = document.createElement("div");
    block.innerHTML =
      'one <button>button</button><span aria-hidden="true">hidden</span><span data-annotation-block="nested">nested</span>two';
    const source = projectAnnotationSource(block);

    expect(source.text).toBe("one two");
    expect(source.range(0, source.text.length)).toBeUndefined();
    expect(source.offset(block.querySelector("button")!.firstChild!, 2)).toBeUndefined();
    expect(source.offset(block.querySelector("button")!, 0)).toBeUndefined();
    expect(source.offset(block, 2)).toBe(4);
  });

  it("restores equivalent ranges after the source DOM is remounted", () => {
    const first = document.createElement("div");
    first.innerHTML = "a <b>selected</b> text";
    const previous = projectAnnotationSource(first);
    const start = previous.text.indexOf("selected");
    const end = start + "selected".length;

    const second = document.createElement("div");
    second.innerHTML = "a <i>sel</i><em>ected</em> text";
    const remounted = projectAnnotationSource(second);

    expect(remounted.text).toBe(previous.text);
    expect(remounted.range(start, end)?.toString()).toBe("selected");
  });

  it("rejects endpoints and ranges outside projected bounds", () => {
    const block = document.createElement("div");
    block.textContent = "hello";
    const source = projectAnnotationSource(block);
    const outside = document.createElement("span");

    expect(source.offset(block.firstChild!, 6)).toBeUndefined();
    expect(source.offset(outside, 0)).toBeUndefined();
    expect(source.range(-1, 2)).toBeUndefined();
    expect(source.range(2, 2)).toBeUndefined();
    expect(source.range(0, 6)).toBeUndefined();
  });
});
