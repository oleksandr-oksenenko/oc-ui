/**
 * Decides which development profiling attach points a launch exposes. Automatic
 * defaults apply only to real development launches (`electron-vite dev` sets
 * `ELECTRON_RENDERER_URL`) and never to packaged builds. An explicitly provided
 * port opts in for other unpackaged runs, and an empty string disables a port.
 * The decision is pure so the environment matrix is unit-testable.
 */
export type DevProfilingPorts = {
  readonly remoteDebuggingPort?: string;
  readonly openCodeInspectorPort?: string;
};

export function resolveDevProfiling(input: {
  readonly isPackaged: boolean;
  readonly developmentUrl: string | undefined;
  readonly remoteDebuggingPort: string | undefined;
  readonly openCodeInspectorPort: string | undefined;
  /** True when Electron already received --remote-debugging-port. */
  readonly hasRemoteDebuggingSwitch: boolean;
}): DevProfilingPorts {
  const remoteDebuggingPort = input.remoteDebuggingPort ?? "9222";
  const openCodeInspectorPort = input.openCodeInspectorPort ?? "9230";
  const developmentLaunch = !input.isPackaged && input.developmentUrl !== undefined;
  const enabled = (configured: string | undefined, port: string): boolean =>
    !input.isPackaged && port.length > 0 && (developmentLaunch || configured !== undefined);
  return {
    remoteDebuggingPort:
      enabled(input.remoteDebuggingPort, remoteDebuggingPort) && !input.hasRemoteDebuggingSwitch
        ? remoteDebuggingPort
        : undefined,
    openCodeInspectorPort: enabled(input.openCodeInspectorPort, openCodeInspectorPort)
      ? openCodeInspectorPort
      : undefined,
  };
}
