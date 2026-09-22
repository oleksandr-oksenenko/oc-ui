import { Browser } from "@opencode/plugin-browser/rpc";
import type { BrowserWindow } from "electron";
import type { BrowserLayout } from "../../shared/browser-api.ts";
import type { BrowserNetwork } from "./network.ts";
import type { AnnotationMode, AnnotationResult } from "./upstream/annotation.ts";
import { createBrowserPage, type BrowserPage } from "./upstream/page.ts";

export type NativeBrowser = ReturnType<typeof createNativeBrowser>;

export function createNativeBrowser(
  win: BrowserWindow,
  partition: string,
  network: BrowserNetwork,
  publish: (state: Browser.State, error?: string) => void,
  onFocus: (tabID: Browser.TabID) => void,
) {
  const pages = new Map<Browser.TabID, BrowserPage>();
  const retiring = new Set<Promise<void>>();
  let focusedTabID: Browser.TabID | null = null;
  let closed = false;
  const state = (): Browser.State => ({
    tabs: Array.from(pages.values(), (page) => page.state()),
    focusedTabID,
  });
  const report = (error?: string) => {
    if (!closed) publish(state(), error);
  };
  const focus = (id: Browser.TabID) => {
    focusedTabID = id;
    pages.forEach((page, key) => {
      if (key === id) return;
      // Hiding a tab cancels its pick, exactly like layout and hide.
      page.annotation.cancel();
      page.view.setVisible(false);
    });
    report();
    onFocus(id);
  };
  const retire = (page: BrowserPage) => {
    const pending = page.dispose();
    retiring.add(pending);
    void pending.then(
      () => retiring.delete(pending),
      () => retiring.delete(pending),
    );
    return pending;
  };
  const closePage = async (id: Browser.TabID, reason?: string) => {
    const page = pages.get(id);
    if (!page) return;
    pages.delete(id);
    if (focusedTabID === id) focusedTabID = pages.keys().next().value ?? null;
    await retire(page);
    report(reason);
  };
  const create = (popupOptions?: Electron.BrowserWindowConstructorOptions): BrowserPage => {
    if (closed) throw new Error("Browser attachment is closed.");
    // oxlint-disable-next-line effecttsgo/crypto-random-uuid -- The pinned Effect RC has no UUID API; use platform correlation IDs.
    const id = Browser.TabID.make(`tab_${crypto.randomUUID()}`);
    const page = createBrowserPage(win, {
      id,
      partition,
      network,
      popupOptions,
      fail: (reason) => {
        void closePage(id, reason).catch(() => report("Browser tab closed unexpectedly."));
      },
      publish: (error) => {
        if (pages.has(id)) report(error);
      },
      popup: (options) => {
        const popup = create(options);
        focus(popup.state().id);
        return popup.contents;
      },
    });
    pages.set(id, page);
    void page.ready.then(
      () => report(),
      () => {
        void closePage(id).catch(() => report("Browser tab could not start."));
      },
    );
    return page;
  };
  return {
    state,
    async annotate(
      input: {
        readonly tabID: Browser.TabID;
        readonly number: number;
        readonly mode: AnnotationMode;
      },
      signal: AbortSignal,
    ): Promise<AnnotationResult | undefined> {
      if (closed) throw new Error("Browser attachment is closed.");
      const page = pages.get(input.tabID);
      if (!page) throw new Error("Browser tab is closed.");
      if (focusedTabID !== input.tabID || !page.view.getVisible())
        throw new Error("Open the browser tab before annotating.");
      // Readiness belongs to the pick so a hung load drains with its operation.
      return page.annotation.start({ number: input.number, mode: input.mode }, signal);
    },
    async cancelAnnotation(tabID: Browser.TabID) {
      await pages.get(tabID)?.annotation.stop();
    },
    layout(layout: BrowserLayout) {
      const [width = 0, height = 0] = win.getContentSize();
      const x = Math.max(0, layout.bounds.x);
      const y = Math.max(0, layout.bounds.y);
      const bounds = {
        x,
        y,
        width: Math.max(0, Math.min(layout.bounds.width, width - x)),
        height: Math.max(0, Math.min(layout.bounds.height, height - y)),
      };
      pages.forEach((page, id) => {
        const visible =
          layout.visible &&
          id === layout.tabID &&
          id === focusedTabID &&
          bounds.width > 0 &&
          bounds.height > 0;
        if (visible) page.view.setBounds(bounds);
        else page.annotation.cancel();
        page.view.setVisible(visible);
      });
    },
    hide() {
      pages.forEach((page) => {
        page.annotation.cancel();
        page.view.setVisible(false);
      });
    },
    async execute(command: Browser.Command, signal: AbortSignal): Promise<Browser.Result> {
      signal.throwIfAborted();
      if (closed) throw new Error("Browser attachment is closed.");
      // The pinned tools never send approval previews. Fail closed if a future
      // server asks for them; never execute an action in place of its preview.
      if (command.inspect || command.target)
        throw new Error("Browser approval previews require a compatible desktop implementation.");
      const action = command.action;
      if (action.type === "tabs.list") return { value: state(), files: [] };
      if (action.type === "tabs.open") {
        const page = create();
        if (action.focus !== false) focus(page.state().id);
        const result = await page.execute(
          {
            action: { type: "navigate", tabID: page.state().id, url: action.url ?? "about:blank" },
            files: [],
          },
          signal,
        );
        report();
        return result;
      }
      const page = pages.get(action.tabID);
      if (!page) throw new Error("Browser tab is closed. List tabs and use an existing tab ID.");
      if (action.type === "tabs.focus") {
        focus(action.tabID);
        return { value: page.state(), files: [] };
      }
      if (action.type === "tabs.close") {
        await closePage(action.tabID);
        return { value: state(), files: [] };
      }
      const result = await page.execute(command, signal);
      report();
      return result;
    },
    async dispose() {
      closed = true;
      const all = [...retiring, ...Array.from(pages.values(), (page) => retire(page))];
      pages.clear();
      focusedTabID = null;
      const settled = await Promise.allSettled(all);
      const failed = settled.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
    },
  };
}
