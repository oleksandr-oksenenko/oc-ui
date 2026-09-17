import type { ParentProps } from "solid-js";
import { createContext, useContext } from "solid-js";
import type { ConnectedRuntime } from "./runtime";

const ServerRuntimeContext = createContext<ConnectedRuntime>();

export function ServerProvider(
  props: ParentProps<{ readonly runtime: ConnectedRuntime }>,
): ReturnType<typeof ServerRuntimeContext.Provider> {
  return (
    <ServerRuntimeContext.Provider value={props.runtime}>
      {props.children}
    </ServerRuntimeContext.Provider>
  );
}

export function useServerRuntime(): ConnectedRuntime {
  const runtime = useContext(ServerRuntimeContext);
  if (!runtime) throw new Error("useServerRuntime must be used inside ServerProvider");
  return runtime;
}

/**
 * The connected runtime when one is present. Views that can render outside a
 * workspace, such as the transcript in Storybook, use this to keep their
 * server-backed enhancements optional instead of requiring a workspace.
 */
export function useServerRuntimeOptional(): ConnectedRuntime | undefined {
  return useContext(ServerRuntimeContext);
}
