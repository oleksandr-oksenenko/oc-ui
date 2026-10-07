import { Icon } from "@opencode/ui/icon";
import { IconButton } from "@opencode/ui/icon-button";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const meta = {
  title: "Design System/Icon Actions",
  component: IconButton,
  parameters: { layout: "centered" },
  args: { icon: <Icon name="close" />, "aria-label": "Close panel" },
} satisfies Meta<typeof IconButton>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Panel: Story = {};
export const Row: Story = {
  args: { size: "small", icon: <Icon name="trash" />, "aria-label": "Delete session" },
};
export const Primary: Story = {
  args: { variant: "contrast", icon: <Icon name="plus" />, "aria-label": "New session" },
};
export const Disabled: Story = { args: { disabled: true } };
