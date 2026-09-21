import { describe, expect, it } from "vite-plus/test";

import { decodeNumericEntities } from "./markdown-text.ts";

describe("decodeNumericEntities", () => {
  it("decodes decimal and hexadecimal references", () => {
    expect(decodeNumericEntities("&#65;?")).toBe("A?");
    expect(decodeNumericEntities("x &#x41; y")).toBe("x A y");
    expect(decodeNumericEntities("&#X41;")).toBe("A");
    expect(decodeNumericEntities("&#xE000;")).toBe("\uE000");
  });

  it("keeps unrepresentable references as written", () => {
    for (const source of ["&#9999999;", "&#x110000;", "&#xFFFFFFF;", "&#;", "&#x;", "&#zz;"]) {
      expect(decodeNumericEntities(source)).toBe(source);
    }
  });

  it("replaces surrogates the way HTML parsing does", () => {
    expect(decodeNumericEntities("&#xD800;")).toBe("\uFFFD");
    expect(decodeNumericEntities("&#55296;")).toBe("\uFFFD");
  });
});
