import type { SessionMessageSynthetic } from "@opencode/client";
import { describe, expect, it } from "vite-plus/test";

import { backgroundProcessUpdate } from "./backgroundProcessUpdate.ts";

const command = 'export PATH="/node/bin:$PATH"\nnode --version';
const message: SessionMessageSynthetic = {
  id: "notice",
  type: "synthetic",
  time: { created: 1 },
  description: command,
  metadata: { source: "shell", shellID: "shell-1", jobID: "job-1", state: "completed", exit: 0 },
  text: `<shell id="job-1" state="completed" command="${command}">\nv24.20.0\n\nCommand exited with code 0.\n</shell>`,
};

describe("backgroundProcessUpdate", () => {
  it("reads the pinned shell envelope with quotes and newlines without interpreting output as markup", () => {
    const output = '<shell id="nested">\nliteral output</shell>\n<script>literal</script>';
    const update = backgroundProcessUpdate({
      ...message,
      text: message.text.replace("v24.20.0", output),
    });
    expect(update?.command).toBe(command);
    expect(update?.output).toBe(`${output}\n\nCommand exited with code 0.`);
    expect(update?.label).toBe("Completed");
  });

  it.each([
    [{ state: "completed", exit: 1 }, "Failed", "error"],
    [{ state: "completed", timeout: true }, "Timed out", "error"],
    [{ state: "error" }, "Failed", "error"],
    [{ state: "cancelled" }, "Cancelled", "cancelled"],
    [{ state: "completed" }, "Completed", "success"],
  ])("uses job state and shell outcome for %j", (outcome, label, status) => {
    const update = backgroundProcessUpdate({
      ...message,
      metadata: { source: "shell", jobID: "job-1", ...outcome },
    });
    expect(update).toMatchObject({ label, status });
  });

  it("keeps unfamiliar or mismatched payloads intact instead of dropping text", () => {
    const text = message.text.replace('id="job-1"', 'id="other"');
    expect(backgroundProcessUpdate({ ...message, text })).toMatchObject({ command, output: text });
  });

  it("does not classify ordinary context, user shell notices, or unknown states as background updates", () => {
    expect(backgroundProcessUpdate({ ...message, metadata: undefined })).toBeUndefined();
    expect(
      backgroundProcessUpdate({ ...message, metadata: { ...message.metadata, jobID: 42 } }),
    ).toBeUndefined();
    expect(
      backgroundProcessUpdate({ ...message, metadata: { source: "shell", state: "completed" } }),
    ).toBeUndefined();
    expect(
      backgroundProcessUpdate({ ...message, metadata: { ...message.metadata, source: "other" } }),
    ).toBeUndefined();
    expect(
      backgroundProcessUpdate({ ...message, metadata: { ...message.metadata, state: "unknown" } }),
    ).toBeUndefined();
  });
});
