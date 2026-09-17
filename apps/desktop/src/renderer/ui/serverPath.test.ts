import { describe, expect, it } from "vite-plus/test";

import { serverFilePathFromFileUrl, serverPathChild, serverPathParent } from "./serverPath.ts";

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

  it.each([
    ["file:///srv/projects/tool-states.png", "/srv/projects/tool-states.png"],
    ["file:///srv/projects/a%20b.png", "/srv/projects/a b.png"],
    ["file://localhost/srv/projects/a.png", "/srv/projects/a.png"],
    ["file:///C:/Users/alex/a.png", "C:/Users/alex/a.png"],
    ["file://C:/Users/alex/a.png", "C:/Users/alex/a.png"],
    ["file:///C:", "C:/"],
    ["file://server/share/a.png", "//server/share/a.png"],
    // WHATWG parses `file:x` as the absolute `/x`, not a relative form.
    ["file:x", "/x"],
  ])("converts %s to a server path", (value, expected) => {
    expect(serverFilePathFromFileUrl(value)).toBe(expected);
  });

  it("keeps one-letter hosts as UNC shares instead of Windows drives", () => {
    expect(serverFilePathFromFileUrl("file://a/share/shot.png")).toBe("//a/share/shot.png");
  });

  it.each([
    "https://example.test/a.png",
    "data:image/png;base64,AAAA",
    "file:///srv/a%ZZb.png",
    "file:///srv/a%00b.png",
    "file://user:password@localhost/srv/a.png",
    "not a url",
    "",
  ])("rejects %s", (value) => {
    expect(serverFilePathFromFileUrl(value)).toBeUndefined();
  });
});
