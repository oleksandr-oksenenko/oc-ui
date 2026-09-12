import { Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { BrowserCommand, BrowserLayout, BrowserEvent } from "./browser-api.ts";

const parse = Schema.decodeUnknownSync(BrowserCommand);

describe("browser IPC contract", () => {
  it("allows navigation while keeping evaluation and file access outside renderer commands", () => {
    expect(
      parse({ bindingID: "binding", action: { type: "tabs.open", url: "https://example.com" } })
        .action.type,
    ).toBe("tabs.open");
    expect(() =>
      parse({
        bindingID: "binding",
        action: {
          type: "evaluate",
          tabID: "tab_00000000-0000-4000-8000-000000000001",
          script: "document.title",
        },
      }),
    ).toThrow(Schema.SchemaError);
    expect(() =>
      parse({
        bindingID: "binding",
        action: {
          type: "files.upload",
          tabID: "tab_00000000-0000-4000-8000-000000000001",
          ref: "@e1",
          paths: ["/secret"],
        },
      }),
    ).toThrow(Schema.SchemaError);
    expect(() => parse({ bindingID: "binding", action: { type: "tabs.close" } })).toThrow(
      Schema.SchemaError,
    );
  });

  it("decodes successful main-process events with no error", () => {
    const event = {
      bindingID: "binding",
      type: "state",
      status: "connected",
      state: { tabs: [], focusedTabID: null },
      error: undefined,
    };
    expect(Schema.decodeUnknownSync(BrowserEvent)(event)).toEqual(event);
  });

  it("rejects invalid viewport bounds and unrecognized lifecycle states", () => {
    const layout = {
      bindingID: "binding",
      tabID: null,
      visible: false,
      bounds: { x: 0, y: 0, width: 500, height: 300 },
    };
    const decode = Schema.decodeUnknownSync(BrowserLayout);
    expect(decode(layout)).toEqual(layout);
    expect(() => decode({ ...layout, bounds: { ...layout.bounds, width: -1 } })).toThrow(
      Schema.SchemaError,
    );
    expect(() => decode({ ...layout, bounds: { ...layout.bounds, height: Number.NaN } })).toThrow(
      Schema.SchemaError,
    );
    expect(() =>
      Schema.decodeUnknownSync(BrowserEvent)({
        bindingID: "binding",
        type: "state",
        status: "ready",
        state: { tabs: [], focusedTabID: null },
      }),
    ).toThrow(Schema.SchemaError);
  });
});
