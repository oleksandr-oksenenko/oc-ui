import { createEffect, For, untrack } from "solid-js";
import { locationKey } from "@opencode/client/solid";
import type { LocationRef } from "@opencode/client";

import type { TerminalSessions } from "../../../../opencode/terminal-sessions.ts";
import type { WorkspaceOwner } from "../../../../workspace-owner.ts";
import type { createTerminalFonts } from "./createTerminalFonts.ts";
import { TerminalPanel } from "./TerminalPanel.tsx";
import { TerminalSurface } from "./TerminalRegion/TerminalSurface.tsx";

export type TerminalRegionProps = {
  readonly controller: TerminalSessions;
  readonly fonts: ReturnType<typeof createTerminalFonts>;
  readonly effects: WorkspaceOwner;
  readonly serverUrl: string;
  readonly location?: LocationRef;
  readonly open: boolean;
  readonly connected: boolean;
  readonly onHide: () => void;
};

export function TerminalRegion(props: TerminalRegionProps) {
  createEffect(() => {
    const location = props.location;
    if (props.open && props.connected && location) untrack(() => props.controller.sync(location));
  });
  const tabs = () =>
    props.location
      ? props.controller
          .entries()
          .filter((entry) => locationKey(entry.location) === locationKey(props.location!))
      : [];
  const activeID = () => (props.location ? props.controller.activeID(props.location) : undefined);

  return (
    <TerminalPanel
      open={props.open}
      tabs={tabs()}
      activeID={activeID()}
      creating={props.controller.creating()}
      error={props.controller.error()}
      canCreate={props.connected && props.location !== undefined}
      onCreate={() => {
        if (props.location) props.controller.create(props.location);
      }}
      onSelect={props.controller.select}
      onClose={props.controller.close}
      onReconnect={props.controller.reconnect}
      onHide={props.onHide}
    >
      <For each={props.controller.entries().map((entry) => entry.id)}>
        {(id) => (
          <TerminalSurface
            id={id}
            controller={props.controller}
            fonts={props.fonts}
            effects={props.effects}
            serverUrl={props.serverUrl}
            visible={props.open && activeID() === id}
          />
        )}
      </For>
    </TerminalPanel>
  );
}
