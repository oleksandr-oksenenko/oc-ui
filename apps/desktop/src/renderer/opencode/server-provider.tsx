import type { ParentProps } from "solid-js";
import { createContext, useContext } from "solid-js";
import type { VerifiedServer } from "./connection";
import { createConnectedRuntime } from "./runtime";
import type { ConnectedRuntime } from "./runtime";

const ServerRuntimeContext = createContext<ConnectedRuntime>();

export function ServerProvider(
  props: ParentProps<{ readonly server: VerifiedServer }>,
): ReturnType<typeof ServerRuntimeContext.Provider> {
  const runtime = createConnectedRuntime({
    api: props.server.api,
    defaultLocation: {
      directory: props.server.location.directory,
      workspaceID: props.server.location.workspaceID,
    },
  });

  return (
    <ServerRuntimeContext.Provider value={runtime}>{props.children}</ServerRuntimeContext.Provider>
  );
}

export function useServerRuntime(): ConnectedRuntime {
  const runtime = useContext(ServerRuntimeContext);
  if (!runtime) throw new Error("useServerRuntime must be used inside ServerProvider");
  return runtime;
}
