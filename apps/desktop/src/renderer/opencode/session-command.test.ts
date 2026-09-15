import { describe, expect, it } from "vite-plus/test";

import { leadingCommandName, parseSessionCommand } from "./session-command.ts";

const names = ["review", "nested/format", "mcp_server:prompt"];

describe("parseSessionCommand", () => {
  it("recognizes a known command with and without arguments", () => {
    expect(parseSessionCommand("/review", names)).toEqual({ name: "review", arguments: "" });
    expect(parseSessionCommand("/review   the changes\nplease ", names)).toEqual({
      name: "review",
      arguments: "the changes\nplease",
    });
  });

  it("keeps names with slashes and colons intact", () => {
    expect(parseSessionCommand("/nested/format src", names)).toEqual({
      name: "nested/format",
      arguments: "src",
    });
    expect(parseSessionCommand("/mcp_server:prompt", names)).toEqual({
      name: "mcp_server:prompt",
      arguments: "",
    });
  });

  it("rejects unknown names, paths, and non-leading invocations", () => {
    expect(parseSessionCommand("/missing", names)).toBeUndefined();
    expect(parseSessionCommand("src/review", names)).toBeUndefined();
    expect(parseSessionCommand("please /review", names)).toBeUndefined();
    expect(parseSessionCommand(" /review", names)).toBeUndefined();
    expect(parseSessionCommand("", names)).toBeUndefined();
  });

  it("reports the leading token even when no command matches", () => {
    expect(leadingCommandName("/missing arg")).toBe("missing");
    expect(leadingCommandName("/")).toBeUndefined();
    expect(leadingCommandName("no slash")).toBeUndefined();
  });
});
