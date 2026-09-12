/* oxlint-disable effecttsgo/async-function -- Storybook owns the async interaction test lifecycle. */
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { Browser } from "@opencode/plugin-browser/rpc";
import { BrowserPane } from "../src/renderer/components/App/ConnectedApp/Browser/BrowserPane.tsx";

const tab = {
  id: Browser.TabID.make("tab_00000000-0000-4000-8000-000000000001"),
  url: "http://localhost:3000",
  title: "Development preview",
  loading: false,
  canGoBack: true,
  canGoForward: false,
  generation: 1,
};
const meta = {
  title: "Context/BrowserPane",
  component: BrowserPane,
  decorators: [
    (Story) => (
      <div style={{ width: "min(520px, 100vw)", height: "650px" }}>
        <Story />
      </div>
    ),
  ],
  args: {
    sessionSelected: true,
    onReconnect: fn(),
    onCommand: fn(),
    state: { status: "idle", browser: { tabs: [], focusedTabID: null } },
  },
} satisfies Meta<typeof BrowserPane>;
export default meta;
type Story = StoryObj<typeof meta>;

export const NoSession: Story = { args: { sessionSelected: false } };
export const Connecting: Story = {
  args: { state: { status: "connecting", browser: { tabs: [], focusedTabID: null } } },
};
export const Replaced: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Reconnect browser" }));
    await expect(args.onReconnect).toHaveBeenCalledOnce();
  },
  args: {
    state: {
      status: "replaced",
      browser: { tabs: [], focusedTabID: null },
      error: "Another desktop connected to this session's browser.",
    },
  },
};
export const Unsupported: Story = {
  args: { state: { status: "unsupported", browser: { tabs: [], focusedTabID: null } } },
};
export const Connected: Story = {
  args: {
    state: {
      status: "connected",
      bindingID: "fixture",
      browser: { tabs: [tab], focusedTabID: tab.id },
    },
    viewport: (
      <div class="browser-viewport" style={{ color: "var(--oc-text-base)", padding: "20px" }}>
        <h2>Development preview</h2>
        <p>The native page appears here in Electron.</p>
      </div>
    ),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const address = canvas.getByRole("textbox", { name: "Browser address" });
    await userEvent.clear(address);
    await userEvent.type(address, "http://localhost:4000{Enter}");
    await expect(args.onCommand).toHaveBeenCalledWith({
      type: "navigate",
      tabID: tab.id,
      url: "http://localhost:4000",
    });
    await userEvent.click(canvas.getByRole("button", { name: "New browser tab" }));
    await expect(args.onCommand).toHaveBeenCalledWith({ type: "tabs.open" });
    await userEvent.click(canvas.getByRole("button", { name: "Close Development preview" }));
    await expect(args.onCommand).toHaveBeenCalledWith({ type: "tabs.close", tabID: tab.id });
  },
};
export const Narrow: Story = {
  ...Connected,
  decorators: [
    (Story) => (
      <div style={{ width: "300px", height: "650px" }}>
        <Story />
      </div>
    ),
  ],
  play: undefined,
};
