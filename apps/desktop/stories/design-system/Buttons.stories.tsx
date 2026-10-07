import { Button } from "@opencode/ui/button";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const meta = {
  title: "Design System/Buttons",
  component: Button,
  parameters: { layout: "centered" },
  args: { children: "Create session", size: "normal", variant: "contrast" },
} satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};
export const Recovery: Story = { args: { children: "Retry", variant: "outline" } };
export const Destructive: Story = { args: { children: "Delete session", variant: "danger" } };
export const Loading: Story = {
  args: { children: "Connecting…", variant: "loading", disabled: true },
};
export const Disabled: Story = { args: { disabled: true } };
