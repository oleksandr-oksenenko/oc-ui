import { describe, expect, it } from "vite-plus/test";

import { contextUsage, formatTokens, type ContextUsageMessage } from "./context-usage.ts";

const tokens = (input: number, output = 0, reasoning = 0, read = 0, write = 0) => ({
  input,
  output,
  reasoning,
  cache: { read, write },
});

describe("context usage", () => {
  it("reads the latest assistant step and ignores other messages", () => {
    const messages: ContextUsageMessage[] = [
      { type: "user" },
      { type: "assistant", tokens: tokens(1_000) },
      { type: "shell" },
      { type: "assistant" },
      { type: "assistant", tokens: tokens(2_000, 500, 0, 100, 50) },
      { type: "user" },
    ];
    expect(contextUsage(messages, 10_000)?.used).toBe(2_650);
  });

  it("treats a session with no reported usage as an empty context window", () => {
    expect(contextUsage([], 1_000)).toEqual({ used: 0, limit: 1_000 });
    expect(contextUsage([{ type: "user" }, { type: "assistant" }], 1_000)?.used).toBe(0);
  });

  it("requires a positive, finite limit and hides otherwise", () => {
    const messages: ContextUsageMessage[] = [{ type: "assistant", tokens: tokens(10) }];
    expect(contextUsage(messages, undefined)).toBeUndefined();
    expect(contextUsage(messages, 0)).toBeUndefined();
    expect(contextUsage(messages, -1)).toBeUndefined();
    expect(contextUsage(messages, Number.POSITIVE_INFINITY)).toBeUndefined();
  });

  it("reports usage beyond the limit without clamping the measurement", () => {
    expect(contextUsage([{ type: "assistant", tokens: tokens(150_000) }], 100_000)).toEqual({
      used: 150_000,
      limit: 100_000,
    });
  });

  it("formats token counts compactly", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1_250)).toBe("1.3k");
    expect(formatTokens(64_000)).toBe("64k");
    expect(formatTokens(1_200_000)).toBe("1.2M");
    expect(formatTokens(999_499)).toBe("999k");
    expect(formatTokens(999_999)).toBe("1.0M");
  });
});
