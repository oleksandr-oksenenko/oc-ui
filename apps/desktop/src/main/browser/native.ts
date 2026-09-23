import { Browser } from "@opencode/plugin-browser/rpc";
import type { BrowserWindow } from "electron";
import type { BrowserLayout } from "../../shared/browser-api.ts";
import type { BrowserNetwork } from "./network.ts";
import type { AnnotationMode, AnnotationResult } from "./upstream/annotation.ts";
import { createBrowserPage, type BrowserPage } from "./upstream/page.ts";

export type NativeBrowser = ReturnType<typeof createNativeBrowser>;

/** A bounded recovery record: page URLs in tab order and the focused index. */
export type BrowserCheckpoint = {
  readonly urls: readonly string[];
  readonly focusedIndex: number | null;
};

/** What restoration rebuilt, plus destinations it never attempted. */
export type RestoreOutcome = {
  readonly urls: readonly string[];
  readonly pending: readonly string[];
};

/** Resolves on abort so a stalled page cannot hold restoration. */
const abortedOutcome = (signal: AbortSignal) =>
  // oxlint-disable-next-line effecttsgo/new-promise -- AbortSignal has no promise API; this adapter is not Effect code.
  new Promise<"aborted">((resolve) => {
    if (signal.aborted) {
      resolve("aborted");
      return;
    }
    signal.addEventListener("abort", () => resolve("aborted"), { once: true });
  });

export function createNativeBrowser(
  win: BrowserWindow,
  partition: string,
  network: BrowserNetwork,
  publish: (state: Browser.State, error?: string) => void,
  onFocus: (tabID: Browser.TabID) => void,
) {
  const pages = new Map<Browser.TabID, BrowserPage>();
  /** The last destination requested for a tab, kept for retries after a failed load. */
  const requested = new Map<Browser.TabID, string>();
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
  const applyFocus = (id: Browser.TabID, notify: boolean) => {
    focusedTabID = id;
    pages.forEach((page, key) => {
      if (key === id) return;
      // Hiding a tab cancels its pick, exactly like layout and hide.
      page.annotation.cancel();
      page.view.setVisible(false);
    });
    report();
    if (notify) onFocus(id);
  };
  const focus = (id: Browser.TabID) => applyFocus(id, true);
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
    requested.delete(id);
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
    checkpoint(): BrowserCheckpoint {
      const entries = Array.from(pages.entries());
      const focused = entries.findIndex(([id]) => id === focusedTabID);
      return {
        // The protocol's tab state truncates URLs; recovery keeps the loaded value.
        // A tab whose first navigation failed keeps its intended destination.
        urls: entries.map(([id, page]) => {
          const current = page.contents.getURL();
          if (current && current !== "about:blank") return current;
          return requested.get(id) ?? current;
        }),
        focusedIndex: focused < 0 ? null : focused,
      };
    },
    async restore(checkpoint: BrowserCheckpoint, signal: AbortSignal): Promise<RestoreOutcome> {
      if (closed) throw new Error("Browser attachment is closed.");
      const urls: string[] = [];
      const aborted = abortedOutcome(signal);
      for (let index = 0; index < checkpoint.urls.length; index += 1) {
        const destination = checkpoint.urls[index]!;
        if (signal.aborted) return { urls, pending: checkpoint.urls.slice(index) };
        const page = create();
        const id = page.state().id;
        requested.set(id, destination);
        const execution = page.execute(
          { action: { type: "navigate", tabID: id, url: destination }, files: [] },
          signal,
        );
        // Native disposal owns settlement; observe rejection to keep it handled.
        const settled = execution.then(
          () => "done" as const,
          () => "failed" as const,
        );
        const winner = await Promise.race([settled, aborted]);
        if (winner === "aborted" || signal.aborted) {
          // Fence a stalled page so it cannot hold the attachment; its disposal
          // remains tracked and awaited by native disposal.
          void closePage(id).catch(() => undefined);
          return { urls, pending: checkpoint.urls.slice(index) };
        }
        if (winner === "failed") {
          // A failed destination keeps its tab and stays recoverable.
          report("Browser tab could not be reopened.");
          urls.push(destination);
        } else {
          urls.push(page.contents.getURL() || destination);
        }
      }
      if (checkpoint.focusedIndex !== null) {
        const target = Array.from(pages.keys())[checkpoint.focusedIndex];
        if (target) applyFocus(target, false);
      }
      report();
      return { urls, pending: [] };
    },
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
        const destination = action.url ?? "about:blank";
        requested.set(page.state().id, destination);
        if (action.focus !== false) focus(page.state().id);
        const result = await page.execute(
          {
            action: { type: "navigate", tabID: page.state().id, url: destination },
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
      if (action.type === "navigate") requested.set(action.tabID, action.url);
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
