import { describe, expect, it } from "vite-plus/test";

import { resolveDevProfiling } from "./dev-profiling.ts";

const development = {
  isPackaged: false,
  developmentUrl: "http://localhost:5173",
  remoteDebuggingPort: undefined,
  openCodeInspectorPort: undefined,
  hasRemoteDebuggingSwitch: false,
};

describe("resolveDevProfiling", () => {
  it("enables the renderer and worker defaults for a development launch", () => {
    expect(resolveDevProfiling(development)).toEqual({
      remoteDebuggingPort: "9222",
      openCodeInspectorPort: "9230",
    });
  });

  it("does not enable automatic defaults for an unpackaged non-development launch", () => {
    const decision = resolveDevProfiling({ ...development, developmentUrl: undefined });

    expect(decision.remoteDebuggingPort).toBeUndefined();
    expect(decision.openCodeInspectorPort).toBeUndefined();
  });

  it("never enables anything for a packaged build, even with explicit ports", () => {
    const decision = resolveDevProfiling({
      ...development,
      isPackaged: true,
      remoteDebuggingPort: "9500",
      openCodeInspectorPort: "9501",
    });

    expect(decision.remoteDebuggingPort).toBeUndefined();
    expect(decision.openCodeInspectorPort).toBeUndefined();
  });

  it("honors explicitly configured ports outside development", () => {
    expect(
      resolveDevProfiling({
        ...development,
        developmentUrl: undefined,
        remoteDebuggingPort: "9500",
        openCodeInspectorPort: "9501",
      }),
    ).toEqual({ remoteDebuggingPort: "9500", openCodeInspectorPort: "9501" });
  });

  it("treats an empty port variable as an opt-out", () => {
    const decision = resolveDevProfiling({
      ...development,
      remoteDebuggingPort: "",
      openCodeInspectorPort: "",
    });

    expect(decision.remoteDebuggingPort).toBeUndefined();
    expect(decision.openCodeInspectorPort).toBeUndefined();
  });

  it("does not duplicate a renderer port already on the command line", () => {
    expect(resolveDevProfiling({ ...development, hasRemoteDebuggingSwitch: true })).toEqual({
      openCodeInspectorPort: "9230",
    });
  });
});
