import { Browser } from "@opencode/plugin-browser/rpc";
import { createSignal } from "solid-js";
import { BrowserPane } from "../../src/renderer/components/App/ConnectedApp/Browser/BrowserPane.tsx";

export function WorkspaceBrowser() {
  const first = {
    id: Browser.TabID.make("tab_00000000-0000-4000-8000-000000000001"),
    url: "http://localhost:3000",
    title: "Development preview",
    loading: false,
    canGoBack: false,
    canGoForward: false,
    generation: 1,
  };
  const [tabs, setTabs] = createSignal([first]);
  const [focused, setFocused] = createSignal<Browser.TabID | null>(first.id);
  let nextTab = 1;
  const command = (action: Browser.Action) => {
    if (action.type === "tabs.open") {
      const item = {
        ...first,
        id: Browser.TabID.make(
          `tab_00000000-0000-4000-8000-${String(++nextTab).padStart(12, "0")}`,
        ),
        url: action.url ?? "about:blank",
        title: "New tab",
      };
      setTabs((items) => [...items, item]);
      setFocused(item.id);
    } else if (action.type === "tabs.close") {
      setTabs((items) => items.filter((item) => item.id !== action.tabID));
      if (focused() === action.tabID) setFocused(tabs()[0]?.id ?? null);
    } else if (action.type === "tabs.focus") setFocused(action.tabID);
    else if (action.type === "navigate")
      setTabs((items) =>
        items.map((item) => (item.id === action.tabID ? { ...item, url: action.url } : item)),
      );
  };
  return (
    <BrowserPane
      sessionSelected
      state={{
        status: "connected",
        bindingID: "storybook",
        browser: { tabs: tabs(), focusedTabID: focused() },
      }}
      onCommand={command}
      onReconnect={() => undefined}
      viewport={
        <div class="browser-viewport" style={{ padding: "20px", color: "var(--oc-text-base)" }}>
          <h2>Development preview</h2>
          <p>
            This Storybook preview uses local fixture data. Web pages render in the native browser
            in Electron.
          </p>
        </div>
      }
    />
  );
}
