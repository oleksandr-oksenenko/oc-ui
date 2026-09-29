import { Show } from "solid-js";

import { DeleteSessionFlow } from "./SessionSidebar/DeleteSessionFlow.tsx";
import type { SessionFlows } from "./createSessionFlows.ts";

export type SessionFlowsRegionProps = { readonly flows: SessionFlows };

/** Reconnect each view to the workspace's open modal operations. */
export function SessionFlowsRegion(props: SessionFlowsRegionProps) {
  return (
    <>
      <Show when={props.flows.deletion()}>
        {(current) => <DeleteSessionFlow flow={current().flow} />}
      </Show>
    </>
  );
}
