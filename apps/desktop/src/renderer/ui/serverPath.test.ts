import { describe, expect, it } from "vite-plus/test";

import { serverPathChild, serverPathParent } from "./serverPath.ts";

describe("serverPath", () => {
  it.each([
    ["/srv/projects", "oc-ui/", "/srv/projects/oc-ui"],
    ["/", "srv/", "/srv"],
    ["C:\\Users\\alex", "code\\", "C:\\Users\\alex\\code"],
    ["C:\\", "Users\\", "C:\\Users"],
    ["C:\\", "Users\\alex", "C:\\Users\\alex"],
    ["C:/Users/alex/", "code/", "C:/Users/alex/code"],
    ["\\\\server\\share", "projects\\", "\\\\server\\share\\projects"],
  ])("resolves child %s + %s", (directory, child, expected) => {
    expect(serverPathChild(directory, child)).toBe(expected);
  });

  it.each([
    ["/srv/projects/oc-ui", "/srv/projects"],
    ["/srv", "/"],
    ["/", "/"],
    ["C:\\Users\\alex", "C:\\Users"],
    ["C:\\", "C:\\"],
    ["\\\\server\\share\\projects", "\\\\server\\share"],
    ["\\\\server\\share", "\\\\server\\share"],
    ["\\\\server\\share\\", "\\\\server\\share\\"],
  ])("resolves the parent of %s", (directory, expected) => {
    expect(serverPathParent(directory)).toBe(expected);
  });
});
