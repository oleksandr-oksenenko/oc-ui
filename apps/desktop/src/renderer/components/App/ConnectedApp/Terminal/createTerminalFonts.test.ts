import { Effect, Exit, Scope } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { withTestWorkspace } from "../../../../test/workspace.ts";
import { createTerminalFonts } from "./createTerminalFonts.ts";

class Request extends EventTarget {
  static readonly requests: Request[] = [];
  responseType = "";
  readyState = 1;
  status = 200;
  response = new ArrayBuffer(4);
  readonly removeEventListener = vi.fn<EventTarget["removeEventListener"]>(
    (type, listener, options) => super.removeEventListener(type, listener, options),
  );
  url = "";
  open(_method: string, url: string) {
    this.url = url;
  }
  send() {
    Request.requests.push(this);
  }
  abort = vi.fn<() => void>();
  succeed(status = 200) {
    this.status = status;
    this.readyState = 4;
    this.dispatchEvent(new Event("load"));
  }
  fail() {
    this.readyState = 4;
    this.dispatchEvent(new Event("error"));
  }
}
beforeEach(() => {
  Request.requests.length = 0;
  vi.stubGlobal("XMLHttpRequest", Request);
});
afterEach(() => vi.unstubAllGlobals());

const setup = () =>
  withTestWorkspace((effects) => ({ effects, fonts: createTerminalFonts(effects) }));

describe("Terminal font assets", () => {
  it("accepts successful packaged file responses with XHR status zero", async () => {
    const base = document.createElement("base");
    base.href = "file:///packaged/out/renderer/index.html";
    document.head.append(base);
    try {
      const s = setup();
      const fonts = s.effects.runPromise(s.fonts);
      expect(Request.requests.every((request) => new URL(request.url).protocol === "file:")).toBe(
        true,
      );
      for (const request of Request.requests) request.succeed(0);
      expect(await fonts).toHaveLength(4);
    } finally {
      base.remove();
    }
  });
  it("shares loaded bytes between simultaneous and subsequent terminals", async () => {
    const s = setup();
    const first = s.effects.runPromise(s.fonts);
    const second = s.effects.runPromise(s.fonts);
    expect(Request.requests).toHaveLength(4);
    for (const request of Request.requests) request.succeed();
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    expect(a[0]).toMatchObject({ data: Request.requests[0]?.response });
    expect(a).toMatchObject([
      { name: "JetBrains Mono Nerd Font" },
      { name: "Noto Emoji" },
      { name: "Noto Sans Symbols 2" },
      { name: "Noto Sans CJK SC" },
    ]);
    await s.effects.runPromise(s.fonts);
    expect(Request.requests).toHaveLength(4);
    expect(
      Request.requests.every((request) => request.removeEventListener.mock.calls.length === 2),
    ).toBe(true);
  });

  it("retries failed assets without throwing away successful font bytes", async () => {
    const s = setup();
    const first = s.effects.runPromise(s.fonts.pipe(Effect.result));
    for (const request of Request.requests.slice(1)) request.succeed();
    Request.requests[0]!.fail();
    expect(await first).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "WorkspaceRequestError" },
    });
    const second = s.effects.runPromise(s.fonts);
    expect(Request.requests).toHaveLength(5);
    Request.requests[4]!.succeed();
    expect(await second).toHaveLength(4);
  });

  it("aborts owned font reads and releases their handlers before workspace shutdown settles", async () => {
    const s = setup();
    const loading = s.effects.runPromise(s.fonts).catch(() => undefined);
    expect(Request.requests).toHaveLength(4);
    await Effect.runPromise(Scope.close(s.effects.scope, Exit.void));
    await loading;
    for (const request of Request.requests) {
      expect(request.abort).toHaveBeenCalledOnce();
      expect(request.removeEventListener).toHaveBeenCalledTimes(2);
    }
  });
});
