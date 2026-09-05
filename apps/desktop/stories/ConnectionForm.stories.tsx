import { fn } from "storybook/test";

import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { ConnectionForm } from "../src/renderer/components/App/ConnectionForm";

const meta = {
  title: "App/ConnectionForm",
  component: ConnectionForm,
  parameters: {
    layout: "fullscreen",
  },
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
