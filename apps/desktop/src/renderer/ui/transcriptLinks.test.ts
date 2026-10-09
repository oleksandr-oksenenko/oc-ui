import { describe, expect, it } from "vite-plus/test";
import { transcriptFilePath, transcriptLinkKind } from "./transcriptLinks.ts";

describe("transcript file references", () => {
  it.each([
    ["/srv/project", "/private/tmp/image.png", "/private/tmp/image.png"],
    ["/srv/project", "./output/../report.pdf", "/srv/project/report.pdf"],
    ["/srv/project", "../report.pdf#L12", "/srv/report.pdf"],
    ["/srv/project", "notes.md", "/srv/project/notes.md"],
    ["/srv/project", "../../../a", "/a"],
    ["/srv/project", "file:///tmp/a%0A", "/tmp/a\n"],
    ["/srv/project", "a%20%23%25%3F.txt", "/srv/project/a #%?.txt"],
    ["/srv/project", "file://localhost/tmp/a%20b.png", "/tmp/a b.png"],
    ["/srv/project", "file:x", "/x"],
    ["C:\\project", ".\\output\\..\\report.pdf", "C:/project/report.pdf"],
    ["C:\\project", "D:\\output\\report.pdf", "D:/output/report.pdf"],
    ["C:/project", "file:///D:/report.pdf", "D:/report.pdf"],
    ["C:/project", "D:%5Coutput%5Creport.pdf", "D:/output/report.pdf"],
    ["\\\\server\\share\\project", "../report.pdf", "//server/share/report.pdf"],
    ["/srv/project", "\\\\server\\share\\report.pdf", "//server/share/report.pdf"],
    ["/srv/project", "file://server/share/report.pdf", "//server/share/report.pdf"],
    ["/srv/project", "dir\\name/file\\name.txt", "/srv/project/dir\\name/file\\name.txt"],
  ])("resolves %s + %s on the server", (directory, href, expected) => {
    expect(transcriptFilePath(href, directory)).toBe(expected);
  });

  it.each([
    "",
    "#intro",
    "https://example.test/a",
    "//server/share/a",
    "C:relative.txt",
    "javascript:alert(1)",
    "mailto:a@example.test",
    "oc://renderer/private/tmp/a",
    "data:text/html,hello",
    "file://user:secret@host/share/a",
    "file:///tmp/a%00",
    "a%ZZ",
    "a%00",
    "a.txt?download=1",
    "file:///tmp/a?x=1",
  ])("rejects unsupported or malformed file target %s", (href) => {
    expect(transcriptFilePath(href, "/srv/project")).toBeUndefined();
  });

  it("keeps protocol-relative web links distinct from explicit UNC references", () => {
    expect(transcriptLinkKind("//server/share/a")).toBe("web");
    expect(transcriptLinkKind("\\\\server\\share\\a")).toBe("file");
    expect(transcriptLinkKind("file://server/share/a")).toBe("file");
    expect(transcriptLinkKind("#intro")).toBe("fragment");
  });
});
