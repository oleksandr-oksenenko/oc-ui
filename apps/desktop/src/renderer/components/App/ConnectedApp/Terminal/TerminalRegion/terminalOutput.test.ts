import { describe, expect, it, vi } from "vite-plus/test";
import { createInputHandler } from "restty/internal";
import { createTerminalOutputFilter } from "./terminalOutput.ts";

describe("terminal output clipboard policy", () => {
  it("blocks reads and writes across every frame split and both OSC introducers", () => {
    for (const start of ["\x1b]", "\x9d"]) {
      for (const end of ["\x07", "\x1b\\", "\x9c"]) {
        for (const payload of ["?", "cHJpdmF0ZQ=="]) {
          const text = `before${start}52;c;${payload}${end}after`;
          for (let split = 0; split <= text.length; split += 1) {
            const filter = createTerminalOutputFilter();
            expect(filter(text.slice(0, split)) + filter(text.slice(split))).toBe(
              "before\x18after",
            );
          }
        }
      }
    }
  });

  it("preserves unrelated OSC, terminal modes, text and nested literal escape strings", () => {
    const text =
      "😀\x1b[?1049h\x1b]0;title\x1b]52;c;?\x07\x1b[31mred\x1b[0m\x1b]8;;https://example.test\x1b\\link\x1b]8;;\x1b\\";
    for (let split = 0; split <= text.length; split += 1) {
      const filter = createTerminalOutputFilter();
      expect(filter(text.slice(0, split)) + filter(text.slice(split))).toBe(text);
    }
  });

  it("drops arbitrarily long clipboard payloads without retaining them or losing the following output", () => {
    const filter = createTerminalOutputFilter();
    expect(filter("start\x1b]52;c;")).toBe("start\x18");
    for (let chunk = 0; chunk < 8; chunk += 1) expect(filter("x".repeat(100_000))).toBe("");
    expect(filter("\x1b")).toBe("");
    expect(filter("\\end\x1b\x1b]52;c;?\x07done")).toBe("end\x1b\x18done");
  });

  it("prevents escape synthesis and C1 shielding through the installed Restty parser at every split", async () => {
    for (const payload of ["?", "cHJpdmF0ZQ=="]) {
      for (const text of [
        `\x1b\x1b]52;c;${payload}\x07]52;c;${payload}\x07`,
        `\x9d0;title\x1b]52;c;${payload}\x07`,
        `\x9d5\x1b]52;c;${payload}\x1b\\`,
        `\x1b\x9d52;c;${payload}\x9c]52;c;${payload}\x07`,
      ]) {
        for (let split = 0; split <= text.length; split += 1) {
          const read = vi.fn<() => string>(() => "private host clipboard");
          const write = vi.fn<(text: string) => void>();
          const reply = vi.fn<(text: string) => void>();
          const downstream = createInputHandler({
            onClipboardRead: read,
            onClipboardWrite: write,
            sendReply: reply,
          });
          const filter = createTerminalOutputFilter();
          downstream.filterOutput(filter(text.slice(0, split)));
          downstream.filterOutput(filter(text.slice(split)));
          await Promise.resolve();
          expect(read).not.toHaveBeenCalled();
          expect(write).not.toHaveBeenCalled();
          expect(reply).not.toHaveBeenCalled();
        }
      }
    }
  });
});
