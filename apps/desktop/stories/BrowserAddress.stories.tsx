/* oxlint-disable effecttsgo/async-function -- Storybook owns the async interaction test lifecycle. */
import { Browser } from "@opencode/plugin-browser/rpc";
import { Show, createSignal, type Setter } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { BrowserPane } from "../src/renderer/components/App/ConnectedApp/Browser/BrowserPane.tsx";
import type { SessionBrowserState } from "../src/renderer/components/App/ConnectedApp/Browser/createSessionBrowser.ts";

const first = {
  id: Browser.TabID.make("tab_00000000-0000-4000-8000-000000000001"),
  url: "http://localhost:3000/project?view=preview#heading",
  title: "Preview",
  loading: false,
  canGoBack: true,
  canGoForward: false,
  generation: 1,
} satisfies Browser.Tab;
const second = {
  ...first,
  id: Browser.TabID.make("tab_00000000-0000-4000-8000-000000000002"),
  title: "Other preview",
} satisfies Browser.Tab;
const connected: SessionBrowserState = {
  status: "connected",
  bindingID: "address-fixture",
  browser: { tabs: [first, second], focusedTabID: first.id },
};
const updates = new WeakMap<
  Element,
  { publish: Setter<SessionBrowserState>; setMounted: Setter<boolean> }
>();
const meta = {
  title: "Context/BrowserAddress",
  component: BrowserPane,
  args: {
    sessionSelected: true,
    state: connected,
    onReconnect: fn(),
    onCommand: fn(),
  },
  render: (args) => {
    const [state, setState] = createSignal(args.state);
    const [mounted, setMounted] = createSignal(true);
    return (
      <div
        data-address-fixture
        ref={(element) => updates.set(element, { publish: setState, setMounted })}
      >
        <Show when={mounted()}>
          <BrowserPane {...args} state={state()} />
        </Show>
      </div>
    );
  },
} satisfies Meta<typeof BrowserPane>;
export default meta;
type Story = StoryObj<typeof meta>;

function fixture(canvasElement: HTMLElement) {
  const root = canvasElement.querySelector("[data-address-fixture]");
  const controls = root && updates.get(root);
  if (!controls) throw new Error("Address fixture did not render");
  const canvas = within(canvasElement);
  const address = canvas.getByRole<HTMLInputElement>("textbox", { name: "Browser address" });
  return { canvas, address, ...controls };
}

export const UnchangedUrlUpdates: Story = {
  play: async ({ canvasElement, args, step }) => {
    const { canvas, address, publish } = fixture(canvasElement);
    const draft = "http://localhost:4000/new?query=keep#draft";
    await userEvent.clear(address);
    await userEvent.type(address, draft);
    address.setSelectionRange(7, 16, "backward");

    await step(
      "Title, loading, generation, history and snapshot updates preserve editing",
      async () => {
        for (const patch of [
          { title: "Preview updated" },
          { loading: true },
          { generation: 2 },
          { canGoBack: false, canGoForward: true },
          {},
        ]) {
          publish({
            ...connected,
            browser: { tabs: [{ ...first, ...patch }, { ...second }], focusedTabID: first.id },
          });
          await expect(address).toHaveValue(draft);
          await expect(address).toHaveFocus();
          await expect([
            address.selectionStart,
            address.selectionEnd,
            address.selectionDirection,
          ]).toEqual([7, 16, "backward"]);
        }
        publish({
          ...connected,
          error: "An unrelated browser action failed.",
          browser: {
            tabs: [{ ...first }, { ...second, url: "https://example.test/background" }],
            focusedTabID: first.id,
          },
        });
        await expect(address).toHaveValue(draft);
        await expect(address).toHaveFocus();
        await expect(canvas.getByRole("alert")).toHaveTextContent(
          "unrelated browser action failed",
        );
      },
    );

    await step("Native selection replacement and Enter submit the preserved draft", async () => {
      await userEvent.keyboard("s");
      const submitted = `${draft.slice(0, 7)}s${draft.slice(16)}`;
      await expect(address).toHaveValue(submitted);
      await userEvent.keyboard("{Enter}");
      await expect(args.onCommand).toHaveBeenLastCalledWith({
        type: "navigate",
        tabID: first.id,
        url: submitted,
      });
      await expect(args.onCommand).toHaveBeenCalledTimes(1);
    });
  },
};

export const TabSwitchAndNavigation: Story = {
  play: async ({ canvasElement, args, step }) => {
    const { canvas, address, publish } = fixture(canvasElement);
    const navigatedUrl = "http://localhost:3000/redirected?next=%2Fproject#result";
    await expect(address).toHaveValue(first.url);
    await userEvent.clear(address);
    await userEvent.type(address, "https://example.test/unsent");

    await step(
      "Switching tabs resets the draft even when both tabs have the same URL",
      async () => {
        await userEvent.click(canvas.getByRole("button", { name: second.title }));
        await expect(args.onCommand).toHaveBeenLastCalledWith({
          type: "tabs.focus",
          tabID: second.id,
        });
        publish({ ...connected, browser: { tabs: [first, second], focusedTabID: second.id } });
        await expect(address).toHaveValue(second.url);
        await userEvent.click(canvas.getByRole("button", { name: first.title }));
        publish({ ...connected });
        await expect(address).toHaveValue(first.url);
      },
    );

    await step(
      "A committed external navigation replaces an in-progress draft without stealing focus",
      async () => {
        await userEvent.clear(address);
        await userEvent.type(address, "https://example.test/another-unsent");
        const url = navigatedUrl;
        publish({
          ...connected,
          browser: { tabs: [{ ...first, url }, second], focusedTabID: first.id },
        });
        await expect(address).toHaveValue(url);
        await expect(address).toHaveFocus();
        await userEvent.keyboard("{Enter}");
        await expect(args.onCommand).toHaveBeenLastCalledWith({
          type: "navigate",
          tabID: first.id,
          url,
        });
      },
    );

    await step(
      "Go sends the exact draft; pending/error snapshots keep it until navigation commits",
      async () => {
        const draft = "http://localhost:4000/path?full=context#fragment";
        await userEvent.clear(address);
        await userEvent.type(address, draft);
        await userEvent.click(canvas.getByRole("button", { name: /^Go$/ }));
        await expect(args.onCommand).toHaveBeenLastCalledWith({
          type: "navigate",
          tabID: first.id,
          url: draft,
        });
        publish({
          ...connected,
          browser: {
            tabs: [{ ...first, url: navigatedUrl, loading: true }, second],
            focusedTabID: first.id,
          },
        });
        await expect(address).toHaveValue(draft);
        publish({
          ...connected,
          error: "Navigation failed; inspect before repeating.",
          browser: {
            tabs: [{ ...first, url: navigatedUrl, loading: true }, second],
            focusedTabID: first.id,
          },
        });
        await expect(address).toHaveValue(draft);
        await userEvent.click(canvas.getByRole("button", { name: "Stop loading browser page" }));
        await expect(args.onCommand).toHaveBeenLastCalledWith({ type: "stop", tabID: first.id });
        publish({
          ...connected,
          browser: { tabs: [{ ...first, url: draft }, second], focusedTabID: first.id },
        });
        await expect(address).toHaveValue(draft);
        await userEvent.click(canvas.getByRole("button", { name: "Reload browser page" }));
        await expect(args.onCommand).toHaveBeenLastCalledWith({ type: "reload", tabID: first.id });
        await userEvent.click(canvas.getByRole("button", { name: "Browser back" }));
        await expect(args.onCommand).toHaveBeenLastCalledWith({ type: "back", tabID: first.id });
        await expect(canvas.getByRole("button", { name: "Browser forward" })).toBeDisabled();
      },
    );
  },
};

export const EmptyAndDisconnected: Story = {
  play: async ({ canvasElement, args }) => {
    const { canvas, address, publish } = fixture(canvasElement);
    await userEvent.clear(address);
    await userEvent.type(address, "https://example.test/discard-on-close");
    publish({ ...connected, browser: { tabs: [], focusedTabID: null } });
    await expect(address).toHaveValue("");
    await expect(canvas.getByRole("button", { name: "Reload browser page" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Browser back" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Browser forward" })).toBeDisabled();
    const url = "http://localhost:4000/new?project=remote#start";
    await userEvent.type(address, url);
    await userEvent.click(canvas.getByRole("button", { name: /^Go$/ }));
    await expect(args.onCommand).toHaveBeenLastCalledWith({ type: "tabs.open", url });
    publish({ status: "failed", browser: { tabs: [], focusedTabID: null }, error: "Disconnected" });
    await expect(
      canvas.queryByRole("textbox", { name: "Browser address" }),
    ).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Reconnect browser" }));
    await expect(args.onReconnect).toHaveBeenCalledOnce();
    publish({ ...connected });
    await expect(canvas.getByRole("textbox", { name: "Browser address" })).toHaveValue(first.url);
  },
};

export const PaneRemount: Story = {
  play: async ({ canvasElement, args }) => {
    const { canvas, address, publish, setMounted } = fixture(canvasElement);
    const draft = "https://example.test/pane-local-draft";
    await userEvent.clear(address);
    await userEvent.type(address, draft);
    await expect(address).toHaveValue(draft);

    setMounted(false);
    await expect(address).not.toBeInTheDocument();
    await expect(canvas.queryByRole("region", { name: "Session browser" })).not.toBeInTheDocument();
    setMounted(true);
    const reopened = canvas.getByRole<HTMLInputElement>("textbox", { name: "Browser address" });
    await expect(reopened).not.toBe(address);
    await expect(reopened).toHaveValue(first.url);

    // The browser owner can commit navigation while its pane is absent.
    setMounted(false);
    const url = "http://localhost:3000/navigated-while-hidden?view=preview#heading";
    publish({
      ...connected,
      browser: { tabs: [{ ...first, url }, second], focusedTabID: first.id },
    });
    setMounted(true);
    await expect(canvas.getByRole("textbox", { name: "Browser address" })).toHaveValue(url);
    await expect(args.onCommand).not.toHaveBeenCalled();
    await expect(args.onReconnect).not.toHaveBeenCalled();
  },
};
