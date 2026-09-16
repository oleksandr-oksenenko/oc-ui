import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { FileDiff as PierreFileDiff } from "@pierre/diffs";

import { mount } from "../../../../../../../test/mount.ts";

import { DiffFile } from "../DiffFile.tsx";

const file = {
  file: "src/example.ts",
  additions: 1,
  deletions: 1,
  status: "modified" as const,
  patch: `diff --git a/src/example.ts b/src/example.ts
--- a/src/example.ts
+++ b/src/example.ts
@@ -1 +1 @@
-old
+new
`,
};

let disposeView: (() => void) | undefined;

afterEach(() => {
  disposeView?.();
  disposeView = undefined;
  vi.restoreAllMocks();
});

describe("PierreDiffBody", () => {
  it("tokenizes the single active theme and forwards normalized metadata", async () => {
    const renderSpy = vi.spyOn(PierreFileDiff.prototype, "render").mockImplementation((props) => {
      props.containerWrapper?.append(document.createElement("diffs-container"));
      return true;
    });
    const setOptionsSpy = vi.spyOn(PierreFileDiff.prototype, "setOptions");

    const mounted = mount(() => <DiffFile file={file} />);
    disposeView = mounted.dispose;

    await vi.waitFor(() => expect(renderSpy).toHaveBeenCalledTimes(1));
    // One active theme, not a { light, dark } pair: the pool tokenizes once per entry.
    expect(setOptionsSpy.mock.calls[0]?.[0]).toMatchObject({
      theme: "github-light-high-contrast",
      themeType: "light",
    });
    expect(renderSpy.mock.calls[0]?.[0].fileDiff).toMatchObject({ isPartial: false });
  });
});
