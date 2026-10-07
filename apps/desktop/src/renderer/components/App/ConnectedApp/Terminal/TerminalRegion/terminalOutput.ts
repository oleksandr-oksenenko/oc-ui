/** Block terminal-initiated clipboard access before Restty's OSC side effects.
 * Keep raw replay/cursor accounting in the controller; this is a per-view policy.
 * Only a possible OSC 52 header is buffered, never an unbounded payload.
 */
export function createTerminalOutputFilter(): (text: string) => string {
  let mode: "text" | "escape" | "header" | "osc" | "clipboard" = "text";
  let header = "";
  let escaped = false;
  const prefixes = ["\x1b]52;", "\x9d52;"];
  return (text) => {
    let output = "";
    for (const char of text) {
      if (mode === "osc" || mode === "clipboard") {
        if (mode === "osc") output += char;
        if (char === "\x07" || char === "\x9c" || (escaped && char === "\\")) mode = "text";
        escaped = char === "\x1b";
        continue;
      }
      if (mode === "escape") {
        if (char === "]") {
          mode = "header";
          header = "\x1b]";
          continue;
        }
        output += "\x1b";
        mode = "text";
      }
      if (mode === "header") {
        header += char;
        if (prefixes.includes(header)) {
          // Empty deletion could join a preceding ESC to following ]52 bytes.
          // CAN cancels that escape in the terminal core and breaks it in Restty.
          output += "\x18";
          header = "";
          escaped = false;
          mode = "clipboard";
          continue;
        }
        if (prefixes.some((prefix) => prefix.startsWith(header))) continue;
        if (header.startsWith("\x9d")) {
          // Restty treats nonclipboard C1 OSC as text, not a container. Recheck
          // this character so an embedded ESC-based query cannot be shielded.
          output += header.slice(0, -char.length);
          header = "";
          mode = "text";
        } else {
          output += header;
          header = "";
          mode = char === "\x07" || char === "\x9c" ? "text" : "osc";
          escaped = char === "\x1b";
          continue;
        }
      }
      if (char === "\x1b") mode = "escape";
      else if (char === "\x9d") {
        mode = "header";
        header = char;
      } else output += char;
    }
    return output;
  };
}
