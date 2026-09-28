import { Browser } from "@opencode/plugin-browser/rpc";
import { createSignal } from "solid-js";
import { BrowserPane } from "../../src/renderer/components/App/ConnectedApp/Browser/BrowserPane.tsx";
import {
  BrowserAnnotations,
  type BrowserAnnotationsController,
} from "../../src/renderer/components/App/ConnectedApp/Browser/BrowserAnnotations.tsx";
import { type BrowserAnnotationDraft } from "../../src/renderer/components/App/ConnectedApp/Browser/browser-annotations.ts";
import { previewImageBase64 } from "../image-fixtures.ts";

export function WorkspaceBrowser(props: {
  readonly onAddAnnotations: (annotations: readonly BrowserAnnotationDraft[]) => void;
}) {
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
  const [drafts, setDrafts] = createSignal<readonly BrowserAnnotationDraft[]>([]);
  let nextAnnotation = 0;
  const annotations: BrowserAnnotationsController = {
    annotations: () => ({ status: "idle", items: drafts() }),
    annotate: (mode) => {
      const tab = tabs().find((item) => item.id === focused());
      if (!tab) return;
      const number = ++nextAnnotation;
      setDrafts((items) => [
        ...items,
        {
          id: `workspace-capture-${number}`,
          number,
          mode,
          tab,
          capturedAt: "2026-09-24T12:00:00.000Z",
          selection: {
            frameUrl: tab.url,
            selector: "main > h2",
            tag: "h2",
            text: "Development preview",
            role: "heading",
            label: "Development preview",
            bounds: { x: 20, y: 20, width: 240, height: 32 },
            topFrame: true,
          },
          image: {
            name: `annotation-${number}.png`,
            mime: "image/png",
            data: Uint8Array.from(atob(previewImageBase64), (value) => value.charCodeAt(0)),
          },
          body: "",
        },
      ]);
    },
    cancelAnnotation: () => undefined,
    annotationBody: (id, body) =>
      setDrafts((items) => items.map((item) => (item.id === id ? { ...item, body } : item))),
    discardAnnotation: (id) => setDrafts((items) => items.filter((item) => item.id !== id)),
    clearAnnotations: () => setDrafts([]),
    addAnnotations: () => {
      props.onAddAnnotations(drafts());
      setDrafts([]);
    },
  };
  const state = () => ({
    status: "connected" as const,
    bindingID: "storybook",
    browser: { tabs: tabs(), focusedTabID: focused() },
  });
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
        items.map((item) =>
          item.id === action.tabID
            ? { ...item, url: action.url, generation: item.generation + 1 }
            : item,
        ),
      );
    else if (action.type === "reload")
      setTabs((items) =>
        items.map((item) =>
          item.id === action.tabID ? { ...item, generation: item.generation + 1 } : item,
        ),
      );
  };
  return (
    <BrowserPane
      sessionSelected
      state={state()}
      annotation={<BrowserAnnotations controller={annotations} state={state()} />}
      onCommand={command}
      onReconnect={() => undefined}
      viewport={
        <div class="browser-viewport" style={{ padding: "20px", color: "var(--oc-text-base)" }}>
          <h2>Development preview</h2>
          <p>
            This Storybook preview uses local fixture data. Annotate and Select area create sample
            captures so you can review the controls. Live pages and capture selection run in
            Electron.
          </p>
        </div>
      }
    />
  );
}
