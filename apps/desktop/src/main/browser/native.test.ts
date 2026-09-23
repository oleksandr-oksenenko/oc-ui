// @vitest-environment node
import type { App, BrowserWindow, Rectangle, WebContents } from "electron";
import { Browser } from "@opencode/plugin-browser/rpc";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { BrowserNetwork } from "./network.ts";
import { createNativeBrowser } from "./native.ts";

type MockPage = {
  id: Browser.TabID;
  url: string;
  view: { setBounds: (bounds: Rectangle) => void; setVisible: (visible: boolean) => void };
  contents: { getURL: () => string };
  annotation: { cancel: () => void; stop: () => Promise<void> };
  state: () => Browser.Tab;
  ready: Promise<void>;
  execute: (command: Browser.Command, signal: AbortSignal) => Promise<Browser.Result>;
  dispose: () => Promise<void>;
};

const pages = vi.hoisted((): MockPage[] => []);
const failures = vi.hoisted(() => new Set<string>());
const stalls = vi.hoisted(() => new Set<string>());
vi.mock("./upstream/page.ts", () => ({
  createBrowserPage: (_window: BrowserWindow, options: { id: Browser.TabID }) => {
    const page: MockPage = {
      id: options.id,
      url: "about:blank",
      view: {
        setBounds: vi.fn<(bounds: Rectangle) => void>(),
        setVisible: vi.fn<(visible: boolean) => void>(),
      },
      contents: { getURL: () => page.url },
      annotation: { cancel: vi.fn<() => void>(), stop: () => Promise.resolve() },
      state: () => ({
        id: options.id,
        url: page.url,
        title: "",
        loading: false,
        canGoBack: false,
        canGoForward: false,
        generation: 0,
      }),
      ready: Promise.resolve(),
      execute: async (command) => {
        if (command.action.type === "navigate") {
          if (stalls.has(command.action.url)) return new Promise<never>(() => undefined);
          if (failures.has(command.action.url)) throw new Error("net::ERR_NAME_NOT_RESOLVED");
          page.url = command.action.url;
        }
        return { value: { tabs: [], focusedTabID: null }, files: [] };
      },
      dispose: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    };
    pages.push(page);
    return page;
  },
}));

const network = {
  attach: vi.fn<(contents: WebContents) => () => App>(),
} satisfies BrowserNetwork;
// SAFETY: Recovery tests never touch the window; page creation is mocked.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Minimal fixture for recovery tests.
const window = {} as BrowserWindow;
const signal = () => new AbortController().signal;
const open = (url: string): Browser.Command => ({
  action: { type: "tabs.open", url },
  files: [],
});

describe("native browser recovery", () => {
  let publish: (state: Browser.State, error?: string) => void;
  let onFocus: (tabID: Browser.TabID) => void;
  let browser: ReturnType<typeof createNativeBrowser>;

  beforeEach(() => {
    pages.length = 0;
    failures.clear();
    publish = vi.fn<(state: Browser.State, error?: string) => void>();
    onFocus = vi.fn<(tabID: Browser.TabID) => void>();
    browser = createNativeBrowser(window, "partition", network, publish, onFocus);
  });

  it("captures tab URLs in order and the focused index", async () => {
    await browser.execute(open("https://one.test/"), signal());
    await browser.execute(open("https://two.test/"), signal());
    await browser.execute(
      { action: { type: "tabs.focus", tabID: pages[0]!.id }, files: [] },
      signal(),
    );
    expect(browser.checkpoint()).toEqual({
      urls: ["https://one.test/", "https://two.test/"],
      focusedIndex: 0,
    });
  });

  it("restores order and focus without announcing a user focus", async () => {
    await browser.restore(
      { urls: ["https://one.test/", "https://two.test/"], focusedIndex: 1 },
      signal(),
    );
    expect(pages.map((page) => page.url)).toEqual(["https://one.test/", "https://two.test/"]);
    expect(browser.state().focusedTabID).toBe(pages[1]!.id);
    expect(pages[0]!.view.setVisible).toHaveBeenCalledWith(false);
    expect(onFocus).not.toHaveBeenCalled();
    expect(browser.checkpoint()).toEqual({
      urls: ["https://one.test/", "https://two.test/"],
      focusedIndex: 1,
    });
  });

  it("keeps a failed destination as a recoverable tab and reports it", async () => {
    failures.add("https://bad.test/");
    const outcome = await browser.restore(
      { urls: ["https://bad.test/", "https://ok.test/"], focusedIndex: 0 },
      signal(),
    );
    expect(outcome).toEqual({
      urls: ["https://bad.test/", "https://ok.test/"],
      pending: [],
    });
    expect(pages).toHaveLength(2);
    expect(pages[0]!.url).toBe("about:blank");
    expect(pages[1]!.url).toBe("https://ok.test/");
    expect(publish).toHaveBeenCalledWith(expect.any(Object), "Browser tab could not be reopened.");
  });

  it("keeps unattempted destinations when the attachment signal aborts", async () => {
    const controller = new AbortController();
    failures.add("https://slow.test/");
    const restoring = browser.restore(
      { urls: ["https://slow.test/", "https://later.test/"], focusedIndex: 0 },
      controller.signal,
    );
    controller.abort();
    await expect(restoring).resolves.toEqual({
      urls: [],
      pending: ["https://slow.test/", "https://later.test/"],
    });
    expect(browser.state().tabs).toHaveLength(0);
  });

  it("fences a stalled page on abort without waiting for readiness", async () => {
    const controller = new AbortController();
    stalls.add("https://stall.test/");
    const restoring = browser.restore(
      { urls: ["https://stall.test/"], focusedIndex: 0 },
      controller.signal,
    );
    const page = pages.at(-1)!;
    controller.abort();
    await expect(restoring).resolves.toEqual({
      urls: [],
      pending: ["https://stall.test/"],
    });
    expect(page.dispose).toHaveBeenCalled();
    expect(browser.state().tabs).toHaveLength(0);
  });
});
