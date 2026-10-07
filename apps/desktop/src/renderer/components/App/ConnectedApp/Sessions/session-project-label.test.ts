import type { Project } from "@opencode/client";
import { describe, expect, it } from "vite-plus/test";
import { sessionProjectLabel } from "./session-project-label.ts";

const project = (id: string, canonical: string, name?: string): Project => ({
  id,
  canonical,
  name,
  time: { created: 1, updated: 1 },
  sandboxes: [],
});

describe("sessionProjectLabel", () => {
  it("shows only the SDK project name", () => {
    expect(sessionProjectLabel("repo", [project("repo", "/srv/repo", " Product ")])).toBe(
      "Product",
    );
  });

  it("keeps duplicate project names free of path suffixes", () => {
    const projects = [
      project("a", "/srv/team-a/app", "App"),
      project("b", "D:\\team-b\\app", "App"),
    ];
    expect(sessionProjectLabel("a", projects)).toBe("App");
    expect(sessionProjectLabel("b", projects)).toBe("App");
  });

  it.each([
    ["/srv/repo/", "repo"],
    ["D:\\work\\repo\\", "repo"],
    ["D:/work/repo/", "repo"],
    ["\\\\host\\share\\repo\\", "repo"],
    ["//host/share/repo/", "repo"],
    ["\\\\host\\share\\", "share"],
    ["/", "/"],
    ["D:\\", "D:\\"],
    ["/srv/a\\b", "a\\b"],
  ])("labels remote directory %s without host path rules", (directory, name) => {
    expect(sessionProjectLabel("repo", [project("repo", directory)])).toBe(name);
  });

  it("does not present the global catch-all as a known project", () => {
    expect(sessionProjectLabel("global", [project("global", "/", "Global")])).toBe(
      "Unknown project",
    );
    expect(sessionProjectLabel("missing", [])).toBe("Unknown project");
    expect(sessionProjectLabel(undefined, [])).toBe("No project selected");
  });
});
