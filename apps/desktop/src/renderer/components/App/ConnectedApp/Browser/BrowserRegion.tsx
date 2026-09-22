import { Show } from "solid-js";
import { BrowserAnnotations } from "./BrowserAnnotations.tsx";
import { BrowserPane } from "./BrowserPane.tsx";
import { BrowserViewport } from "./BrowserViewport.tsx";
import type { SessionBrowser } from "./createSessionBrowser.ts";

export type BrowserRegionProps = {
  readonly controller: SessionBrowser;
  readonly sessionSelected: boolean;
};

export function BrowserRegion(props: BrowserRegionProps) {
  return (
    <BrowserPane
      state={props.controller.current()}
      sessionSelected={props.sessionSelected}
      onReconnect={props.controller.reconnect}
      onCommand={props.controller.command}
      annotation={
        <BrowserAnnotations controller={props.controller} state={props.controller.current()} />
      }
      viewport={
        <Show
          when={
            props.controller.current().bindingID
              ? props.controller.current().browser.focusedTabID
              : undefined
          }
          keyed
        >
          {(tabID) => (
            <BrowserViewport
              bindingID={props.controller.current().bindingID!}
              tabID={tabID}
              onLayout={props.controller.layout}
            />
          )}
        </Show>
      }
    />
  );
}
