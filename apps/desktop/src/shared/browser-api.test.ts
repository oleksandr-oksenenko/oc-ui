import { Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";
import {
  BrowserAnnotationStart,
  BrowserCommand,
  BrowserEvent,
  BrowserLayout,
  BrowserRequest,
} from "./browser-api.ts";

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

  it("bounds annotation requests and rejects unknown modes", () => {
    const decode = Schema.decodeUnknownSync(BrowserAnnotationStart);
    const request = {
      bindingID: "binding",
      tabID: "tab_00000000-0000-4000-8000-000000000001",
      requestID: "request-1",
      number: 1,
      mode: "element",
    };
    expect(decode(request)).toEqual(request);
    expect(() => decode({ ...request, mode: "viewport" })).toThrow(Schema.SchemaError);
    expect(() => decode({ ...request, number: 0 })).toThrow(Schema.SchemaError);
    expect(() => decode({ ...request, requestID: "" })).toThrow(Schema.SchemaError);
  });

  it("decodes annotation captures with typed bytes rather than desktop paths", () => {
    const event = {
      bindingID: "binding",
      type: "annotation",
      capture: {
        requestID: "request-1",
        number: 2,
        mode: "area",
        tab: {
          id: "tab_00000000-0000-4000-8000-000000000001",
          url: "https://example.com",
          title: "Page",
          loading: false,
          canGoBack: false,
          canGoForward: false,
          generation: 3,
        },
        capturedAt: "2026-09-19T12:00:00.000Z",
        selection: {
          frameUrl: "https://example.com",
          selector: "",
          tag: "area",
          text: "",
          role: "",
          label: "",
          bounds: { x: 1, y: 2, width: 30, height: 40 },
          topFrame: true,
        },
        body: "Uneven spacing",
        image: {
          id: "file_00000000-0000-4000-8000-000000000001",
          name: "annotation-2.png",
          mime: "image/png",
          data: new Uint8Array([137, 80, 78, 71]),
        },
      },
    };
    expect(Schema.decodeUnknownSync(BrowserEvent)(event)).toEqual(event);
    expect(() =>
      Schema.decodeUnknownSync(BrowserEvent)({
        ...event,
        capture: {
          ...event.capture,
          image: { ...event.capture.image, data: "/desktop/private/screenshot.png" },
        },
      }),
    ).toThrow(Schema.SchemaError);
    // The annotation channel is separate from the agent-facing command allowlist.
    expect(
      Schema.decodeSync(BrowserRequest)({
        _tag: "annotationStart",
        bindingID: "binding",
        tabID: "tab_00000000-0000-4000-8000-000000000001",
        requestID: "request-1",
        number: 1,
        mode: "element",
      }),
    ).toMatchObject({ _tag: "annotationStart" });
  });
});
