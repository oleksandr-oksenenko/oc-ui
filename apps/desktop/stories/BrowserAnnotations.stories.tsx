/* oxlint-disable effecttsgo/async-function -- Storybook owns the async interaction test lifecycle. */
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { Browser } from "@opencode/plugin-browser/rpc";
import { BrowserAnnotations } from "../src/renderer/components/App/ConnectedApp/Browser/BrowserAnnotations.tsx";
import { controller, draft, fullBatch, tab } from "./browser-annotation-fixtures.ts";

const meta = {
  title: "Context/BrowserAnnotations",
  component: BrowserAnnotations,
  decorators: [
    (Story) => (
      <div
        style={{
          width: "min(520px, 100vw)",
          height: "650px",
          display: "flex",
          "flex-direction": "column",
          padding: "8px",
          background: "var(--oc-surface-canvas)",
        }}
      >
        <Story />
      </div>
    ),
  ],
  args: {
    controller,
    state: {
      status: "connected",
      bindingID: "fixture",
      browser: { tabs: [tab], focusedTabID: tab.id },
    },
  },
} satisfies Meta<typeof BrowserAnnotations>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Captured: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const comment = canvasElement.querySelector<HTMLTextAreaElement>(
      '[aria-label="Annotation 1 comment"]',
    );
    if (!comment) throw new Error("Annotation comment editor missing");
    await expect(comment.value).toBe("Make this button wider");
    await userEvent.type(comment, " and taller");
    await expect(controller.annotationBody).toHaveBeenCalled();
    await userEvent.click(canvas.getByRole("button", { name: "Add to composer" }));
    await expect(controller.addAnnotations).toHaveBeenCalledOnce();
    const preview = canvas.getByRole("button", { name: "Enlarge Browser annotation 1" });
    await userEvent.click(preview);
    await expect(
      await screen.findByRole("dialog", { name: "Preview of Browser annotation 1" }),
    ).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Close image preview" }));
    await waitFor(() => expect(preview).toHaveFocus());
    await userEvent.keyboard("{Enter}");
    await expect(
      await screen.findByRole("dialog", { name: "Preview of Browser annotation 1" }),
    ).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(preview).toHaveFocus());
    await expect(comment.value).toBe("Make this button wider and taller");
  },
};

export const CapturedDark: Story = { ...Captured, globals: { theme: "dark" } };

export const AnotherTab: Story = {
  args: {
    state: {
      status: "connected",
      browser: {
        tabs: [tab, { ...tab, id: Browser.TabID.make("tab_00000000-0000-4000-8000-000000000002") }],
        focusedTabID: Browser.TabID.make("tab_00000000-0000-4000-8000-000000000002"),
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Captured in another tab.")).toBeVisible();
    await expect(canvas.queryByText("Captured before the latest navigation.")).toBeNull();
    await expect(canvas.getByText(`${tab.title} · ${tab.url}`)).toBeVisible();
  },
};

export const Navigated: Story = {
  args: {
    state: {
      status: "connected",
      browser: {
        tabs: [{ ...tab, generation: 2, url: "http://localhost:3000/about" }],
        focusedTabID: tab.id,
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Captured before the latest navigation.")).toBeVisible();
    await expect(canvas.queryByText("Captured in another tab.")).toBeNull();
    await expect(canvas.getByText(`${tab.title} · ${tab.url}`)).toBeVisible();
  },
};

export const FullBatch: Story = {
  args: {
    controller: {
      ...controller,
      annotations: () => ({
        status: "idle",
        items: fullBatch,
      }),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const list = canvas.getByRole("list");
    const add = canvas.getByRole("button", { name: "Add to composer" });
    const capture = canvas.getByRole("button", { name: "Annotate" });
    const clear = canvas.getByRole("button", { name: "Clear" });
    const positions = [capture, add, clear].map((button) => button.getBoundingClientRect().top);
    await expect(capture).toBeDisabled();
    await expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
    list.scrollTop = list.scrollHeight;
    await waitFor(() => expect(list.scrollTop).toBeGreaterThan(0));
    await expect([capture, add, clear].map((button) => button.getBoundingClientRect().top)).toEqual(
      positions,
    );
    await expect(canvas.getByRole("textbox", { name: "Annotation 8 comment" })).toBeVisible();
    await userEvent.click(clear);
    await expect(controller.clearAnnotations).toHaveBeenCalled();
  },
};

export const MissingComment: Story = {
  args: {
    controller: {
      ...controller,
      annotations: () => ({ status: "idle", items: [{ ...draft, body: "" }] }),
    },
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("button", { name: "Add to composer" }),
    ).toBeDisabled();
  },
};

export const Empty: Story = {
  args: { controller: { ...controller, annotations: () => ({ status: "idle", items: [] }) } },
};

export const CaptureError: Story = {
  args: {
    controller: {
      ...controller,
      annotations: () => ({ status: "idle", items: [draft], error: "Capture failed. Try again." }),
    },
  },
};

export const Picking: Story = {
  args: {
    controller: {
      ...controller,
      annotations: () => ({ status: "picking", items: [], request: "request-2" }),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Cancel selection" }));
    await expect(controller.cancelAnnotation).toHaveBeenCalled();
  },
};
