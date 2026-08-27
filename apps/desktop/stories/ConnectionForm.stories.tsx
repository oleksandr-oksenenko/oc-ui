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
    serverUrl: "",
    password: "",
    busy: false,
    error: undefined,
    hasSavedConnection: false,
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

export const Connecting: Story = {
  args: {
    serverUrl: "http://127.0.0.1:4096",
    password: "server-password",
    busy: true,
  },
};

export const SavedUrl: Story = {
  args: {
    serverUrl: "http://homie:4096",
    password: "saved-password",
    hasSavedConnection: true,
  },
};

export const NonLoopbackHttpWarning: Story = {
  args: {
    serverUrl: "http://homie.lan:4096",
    password: "",
  },
};

export const Unauthorized: Story = {
  args: {
    serverUrl: "http://127.0.0.1:4096",
    password: "wrong-password",
    error: "The server rejected the password.",
  },
};

export const Unreachable: Story = {
  args: {
    serverUrl: "http://homie:4096",
    password: "server-password",
    error: "The server could not be reached.",
  },
};

export const IncompatibleVersion: Story = {
  args: {
    serverUrl: "http://homie:4096",
    password: "server-password",
    error: "This app and server use different OpenCode versions.",
  },
};
