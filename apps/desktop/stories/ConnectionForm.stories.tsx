/* oxlint-disable effecttsgo/async-function -- Storybook owns interaction tests. */
import { expect, fn, userEvent, within } from "storybook/test";

import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { ConnectionForm } from "../src/renderer/components/App/ConnectionForm";

const meta = {
  title: "App/ConnectionForm",
  component: ConnectionForm,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      // Match the bounded, non-scrolling production root; the page owns scrolling.
      <div style={{ height: "100dvh", overflow: "hidden" }}>
        <Story />
      </div>
    ),
  ],
  args: {
    mode: "local",
    serverUrl: "",
    password: "",
    busy: false,
    error: undefined,
    savedTarget: undefined,
    onModeChange: fn(),
    onServerUrlInput: fn(),
    onPasswordInput: fn(),
    onConnect: fn(),
    onUseBuiltInServer: fn(),
    onForget: fn(),
  },
} satisfies Meta<typeof ConnectionForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Blank: Story = {};

export const Browser: Story = {
  args: { builtInAvailable: false, mode: "remote" },
};

export const BrowserConnecting: Story = {
  args: {
    builtInAvailable: false,
    mode: "remote",
    serverUrl: "https://opencode.example.com",
    busy: true,
  },
};

export const BrowserError: Story = {
  args: {
    builtInAvailable: false,
    mode: "remote",
    serverUrl: "https://opencode.example.com",
    error: "The server rejected the password.",
  },
};

export const Connecting: Story = {
  args: {
    busy: true,
  },
};

export const SavedBuiltIn: Story = {
  args: {
    savedTarget: { kind: "local" },
  },
};

export const SavedRemote: Story = {
  args: {
    mode: "remote",
    serverUrl: "http://homie:4096",
    savedTarget: { kind: "remote", serverUrl: "http://homie:4096" },
  },
};

export const NonLoopbackHttpWarning: Story = {
  args: {
    mode: "remote",
    serverUrl: "http://homie.lan:4096",
    password: "",
  },
};

export const Unauthorized: Story = {
  args: {
    mode: "remote",
    serverUrl: "http://127.0.0.1:4096",
    password: "wrong-password",
    error: "The server rejected the password.",
  },
};

export const Unreachable: Story = {
  args: {
    mode: "remote",
    serverUrl: "http://homie:4096",
    password: "server-password",
    error: "The server could not be reached.",
  },
};

export const IncompatibleVersion: Story = {
  args: {
    mode: "remote",
    serverUrl: "http://homie:4096",
    password: "server-password",
    error: "This app and server use different OpenCode versions.",
  },
};

export const ShortRemoteError: Story = {
  parameters: {
    viewport: {
      options: {
        short360x480: { name: "Short 360x480", styles: { width: "360px", height: "480px" } },
      },
    },
  },
  globals: { viewport: { value: "short360x480", isRotated: false } },
  args: {
    ...SavedRemote.args,
    password: "server-password",
    error: "The server could not be reached.",
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const page = canvas.getByRole("main");
    const bounds = page.getBoundingClientRect();
    await expect(bounds.width).toBe(360);
    await expect(bounds.height).toBe(480);
    await expect(page.scrollHeight).toBeGreaterThan(page.clientHeight);
    page.scrollTop = 0;

    const heading = canvas.getByRole("heading", { name: "Connect to OpenCode" });
    const headingBounds = heading.getBoundingClientRect();
    await expect(headingBounds.top).toBeGreaterThanOrEqual(bounds.top);
    await expect(headingBounds.bottom).toBeLessThanOrEqual(bounds.bottom);
    await expect(
      heading.contains(
        page.ownerDocument.elementFromPoint(
          headingBounds.left + headingBounds.width / 2,
          headingBounds.top + headingBounds.height / 2,
        ),
      ),
    ).toBe(true);
    await expect(canvas.getByRole("status")).toHaveTextContent("Saved choice");
    await expect(canvas.getByLabelText("Server URL")).toHaveValue(args.serverUrl);
    await expect(canvas.getByLabelText("Password")).toHaveValue(args.password);
    await expect(canvas.getByRole("note")).toHaveTextContent("not encrypted in transit");
    await expect(canvas.getByRole("alert")).toHaveTextContent(args.error!);

    page.scrollTop = page.scrollHeight;
    await expect(page.scrollTop).toBeGreaterThan(0);
    const retry = canvas.getByRole("button", { name: "Retry" });
    const forget = canvas.getByRole("button", { name: "Forget saved choice" });
    for (const action of [retry, forget]) {
      const rect = action.getBoundingClientRect();
      await expect(rect.top).toBeGreaterThanOrEqual(bounds.top);
      await expect(rect.bottom).toBeLessThanOrEqual(bounds.bottom);
      await expect(
        action.contains(
          page.ownerDocument.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          ),
        ),
      ).toBe(true);
    }
    await userEvent.click(retry);
    await expect(args.onConnect).toHaveBeenCalledOnce();
    await userEvent.click(forget);
    await expect(args.onForget).toHaveBeenCalledOnce();
  },
};

export const ShortBrowserRemoteError: Story = {
  ...ShortRemoteError,
  args: { ...ShortRemoteError.args, builtInAvailable: false },
};

export const OrdinaryHeightRemoteError: Story = {
  args: ShortRemoteError.args,
  globals: { viewport: { value: "desktop", isRotated: false } },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement).getByRole("main");
    const column = canvasElement.querySelector<HTMLElement>(".connection-form-column")!;
    const pageBounds = page.getBoundingClientRect();
    const columnBounds = column.getBoundingClientRect();
    await expect(pageBounds.height).toBe(900);
    await expect(page.scrollHeight).toBe(page.clientHeight);
    await expect(
      Math.abs(pageBounds.top + pageBounds.bottom - columnBounds.top - columnBounds.bottom),
    ).toBeLessThanOrEqual(1);
  },
};
