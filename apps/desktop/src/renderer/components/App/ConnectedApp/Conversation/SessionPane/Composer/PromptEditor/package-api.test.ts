import { describe, expect, it } from "vite-plus/test";

import { fromDraft, promptPlugins, schema, toDraft } from "@oc-ui/prompt-editor";
import { decodeNumericEntities } from "@oc-ui/prompt-editor/markdown-text";

/**
 * Consumer contract for the extracted package: importing through the public
 * entry must be enough to use the codec, and the decoder subpath must resolve
 * for the transcript.
 */
describe("@oc-ui/prompt-editor consumer contract", () => {
  it("exposes the codec through the package entry", () => {
    const doc = fromDraft("- one\n- two");
    doc.check();
    expect(toDraft(doc).text).toBe("- one\n- two");
    expect(schema.nodes.bullet_list).toBeDefined();
    expect(promptPlugins().length).toBeGreaterThan(0);
  });

  it("exposes the numeric entity decoder on its subpath", () => {
    expect(decodeNumericEntities("&#xE000;")).toBe("\uE000");
  });
});
