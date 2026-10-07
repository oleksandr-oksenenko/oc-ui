import { TextInput } from "@opencode/ui/text-input";
import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const meta = {
  title: "Design System/Inputs",
  component: TextInput,
  parameters: { layout: "centered" },
  args: { "aria-label": "Repository path", value: "/srv/opencode/projects/oc-ui" },
  render: (args) => {
    const [value, setValue] = createSignal(args.value ?? "");
    return (
      <TextInput
        {...args}
        value={value()}
        onInput={(event) => setValue(event.currentTarget.value)}
        onClearClick={() => setValue("")}
      />
    );
  },
} satisfies Meta<typeof TextInput>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Clearable: Story = {
  args: { showClearButton: true, clearLabel: "Clear repository path" },
};
export const Invalid: Story = { args: { invalid: true } };
export const Disabled: Story = { args: { disabled: true } };
export const LongValue: Story = {
  args: { value: "/srv/opencode/projects/very-long-organization/very-long-repository-name" },
};
