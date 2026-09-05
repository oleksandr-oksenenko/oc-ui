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
