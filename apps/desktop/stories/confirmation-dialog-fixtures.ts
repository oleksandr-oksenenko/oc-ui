/* oxlint-disable effecttsgo/async-function -- Storybook's interaction API is Promise-based. */
import { expect, userEvent, waitFor, within } from "storybook/test";

export const shortConfirmationViewport = {
  parameters: {
    viewport: {
      options: {
        short640x480: {
          name: "Native minimum height",
          styles: { width: "640px", height: "480px" },
        },
      },
    },
  },
  globals: { viewport: { value: "short640x480", isRotated: false } },
};

export async function expectConfirmationLayout(
  document: Document,
  containerClass: string,
  overflowing: boolean,
) {
  const content = await within(document.body).findByRole("dialog");
  const container = content.closest<HTMLElement>(containerClass)!;
  const form = within(content).getByText("This cannot be undone.").closest("form")!;
  const body = form.querySelector<HTMLElement>('[data-slot="dialog-body"]')!;
  const title = form.querySelector<HTMLElement>('[data-slot="dialog-title"]')!;
  // The Storybook Vitest viewport helper changes the actual browser viewport.
  await expect(document.documentElement.clientHeight).toBe(480);
  await waitFor(async () => {
    const rect = container.getBoundingClientRect();
    await expect(rect.top).toBeGreaterThanOrEqual(16);
    await expect(rect.bottom).toBeLessThanOrEqual(464);
    await expect(rect.left).toBeGreaterThanOrEqual(16);
    await expect(rect.right).toBeLessThanOrEqual(document.documentElement.clientWidth - 16);
    await expect(content.scrollWidth).toBeLessThanOrEqual(content.clientWidth);
    await expect(body.scrollHeight).toBeLessThanOrEqual(body.clientHeight + 1);
    if (overflowing) {
      await expect(content.scrollHeight).toBeGreaterThan(content.clientHeight);
    } else {
      await expect(rect.height).toBeLessThan(448);
      await expect(content.scrollHeight).toBe(content.clientHeight);
      await expect(form.getBoundingClientRect().height).toBeCloseTo(content.clientHeight, 0);
    }
  });
  content.scrollTop = 0;
  await waitFor(async () => {
    const rect = content.getBoundingClientRect();
    const first = title.getBoundingClientRect();
    await expect(first.top).toBeGreaterThanOrEqual(rect.top);
    await expect(first.bottom).toBeLessThanOrEqual(rect.bottom);
    await expect(first.left).toBeGreaterThanOrEqual(rect.left);
    await expect(first.right).toBeLessThanOrEqual(rect.right);
    await expect(content.scrollTop).toBe(0);
  });
  return content;
}

export async function scrollToConfirmationAction(content: HTMLElement, label: string) {
  const action = within(content).getByRole("button", { name: label });
  await expect(action.getBoundingClientRect().top).toBeGreaterThan(
    content.getBoundingClientRect().bottom,
  );
  content.scrollTop = content.scrollHeight;
  await waitFor(async () => {
    const rect = content.getBoundingClientRect();
    const button = action.getBoundingClientRect();
    await expect(content.scrollTop).toBeGreaterThan(0);
    await expect(button.top).toBeGreaterThanOrEqual(rect.top);
    await expect(button.bottom).toBeLessThanOrEqual(rect.bottom);
    await expect(action).toBeEnabled();
    const target = content.ownerDocument.elementFromPoint(
      button.left + button.width / 2,
      button.top + button.height / 2,
    );
    await expect(target === action || action.contains(target)).toBe(true);
  });
  await userEvent.click(action);
}
