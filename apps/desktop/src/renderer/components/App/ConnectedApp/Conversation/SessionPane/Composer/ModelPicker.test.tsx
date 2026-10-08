import { createSignal } from "solid-js";
import { expect, it, vi } from "vite-plus/test";

import { mount } from "../../../../../../test/mount.ts";
import { ModelPicker } from "./ModelPicker.tsx";

it("returns focus to the model trigger after a pending switch reenables it", async () => {
  vi.useFakeTimers();
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: () => undefined,
  });
  const [disabled, setDisabled] = createSignal(false);
  const [selectedID, setSelectedID] = createSignal("one");
  const { host, dispose } = mount(() => (
    <ModelPicker
      options={[
        { id: "one", label: "Model One" },
        { id: "two", label: "Model Two" },
      ]}
      selectedID={selectedID()}
      disabled={disabled()}
      onSelect={(id) => {
        setDisabled(true);
        setSelectedID(id);
      }}
    />
  ));
  try {
    const trigger = host.querySelector<HTMLButtonElement>(".composer-model-trigger")!;
    trigger.focus();
    trigger.click();
    await vi.runOnlyPendingTimersAsync();
    const search = document.querySelector<HTMLInputElement>(".composer-model-popover input")!;
    search.focus();
    expect(document.activeElement).toBe(search);
    const model = [...document.querySelectorAll<HTMLButtonElement>('[data-slot="list-item"]')].find(
      (item) => item.textContent?.includes("Model Two"),
    )!;
    model.click();
    expect(trigger.disabled).toBe(true);
    await vi.runOnlyPendingTimersAsync();
    expect(document.querySelector(".composer-model-popover")).toBeNull();
    expect(document.activeElement).not.toBe(trigger);

    setDisabled(false);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(trigger.getAttribute("aria-label")).toBe("Model: Model Two");
    expect(document.activeElement).toBe(trigger);
  } finally {
    dispose();
    vi.useRealTimers();
    Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  }
});
