import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vite-plus/test";

import { Composer } from "./Composer.tsx";

const unavailableSelection = {
  state: "failed" as const,
  switching: false,
  disabled: false,
  models: [],
  variants: [],
  onSelectModel: () => undefined,
  onSelectVariant: () => undefined,
};

describe("Composer", () => {
  it("does not explain the running state with extra prose", () => {
    const host = document.createElement("div");
    const dispose = render(
      () => (
        <Composer
          value=""
          disabled
          submitting={false}
          running
          selection={unavailableSelection}
          onInput={() => undefined}
          onSubmit={() => undefined}
        />
      ),
      host,
    );

    expect(host.textContent).not.toContain("Draft saved while this run finishes.");
    expect(host.querySelector("output")).toBeNull();
    dispose();
  });

  it("shows honest loading states", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const dispose = render(
      () => (
        <Composer
          value=""
          disabled={false}
          submitting={false}
          running={false}
          selection={{ ...unavailableSelection, state: "loading" }}
          onInput={() => undefined}
          onSubmit={() => undefined}
        />
      ),
      host,
    );

    const placeholders = host.querySelectorAll('.composer-picker[aria-disabled="true"]');
    expect(placeholders).toHaveLength(2);
    expect(placeholders[0]?.textContent).toContain("Loading models");
    expect(placeholders[1]?.textContent).toContain("Loading variants");
    expect(host.querySelector('[data-component="select-v2"]')).toBeNull();

    dispose();
    host.remove();
  });

  it("renders controlled model and variant choices", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const dispose = render(
      () => (
        <Composer
          value=""
          disabled={false}
          submitting={false}
          running={false}
          selection={{
            state: "ready",
            switching: false,
            disabled: false,
            models: [
              { id: "one", label: "Model One" },
              { id: "two", label: "Model Two" },
            ],
            selectedModelID: "one",
            variants: [
              { id: "fast", label: "fast" },
              { id: "deep", label: "deep" },
            ],
            selectedVariantID: "deep",
            onSelectModel: () => undefined,
            onSelectVariant: () => undefined,
          }}
          onInput={() => undefined}
          onSubmit={() => undefined}
        />
      ),
      host,
    );

    const controls = host.querySelectorAll('[data-component="select-v2"]');
    expect(controls).toHaveLength(2);
    expect(controls[0]?.textContent).toContain("Model One");
    expect(controls[1]?.textContent).toContain("deep");

    dispose();
    host.remove();
  });

  it("rejects whitespace and respects application busy state", () => {
    const host = document.createElement("div");
    const [value, setValue] = createSignal("   \n");
    const [disabled, setDisabled] = createSignal(false);
    const submit = vi.fn<() => void>();
    document.body.append(host);
    const dispose = render(
      () => (
        <Composer
          value={value()}
          disabled={disabled()}
          submitting={false}
          running={false}
          selection={unavailableSelection}
          onInput={setValue}
          onSubmit={submit}
        />
      ),
      host,
    );
    const button = host.querySelector("button");
    if (!button) throw new Error("Composer did not render a button");

    expect(button.disabled).toBe(true);
    button.click();
    expect(submit).not.toHaveBeenCalled();

    setValue("send this");
    expect(button.disabled).toBe(false);
    button.click();
    expect(submit).toHaveBeenCalledOnce();
    setDisabled(true);
    expect(button.disabled).toBe(true);
    button.click();
    expect(submit).toHaveBeenCalledOnce();
    dispose();
    host.remove();
  });

  it("submits with Enter but keeps Shift+Enter for newlines", () => {
    const host = document.createElement("div");
    const submit = vi.fn<() => void>();
    document.body.append(host);
    const dispose = render(
      () => (
        <Composer
          value="two\nlines"
          disabled={false}
          submitting={false}
          running={false}
          selection={unavailableSelection}
          onInput={() => undefined}
          onSubmit={submit}
        />
      ),
      host,
    );
    const textarea = host.querySelector("textarea");
    if (!textarea) throw new Error("Composer did not render a textarea");

    textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }),
    );
    expect(submit).not.toHaveBeenCalled();
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(submit).toHaveBeenCalledOnce();
    dispose();
    host.remove();
  });

  it("grows with multiline input, caps its height, and shrinks with controlled value", () => {
    const host = document.createElement("div");
    const [value, setValue] = createSignal("One line");
    document.body.append(host);
    const dispose = render(
      () => (
        <Composer
          value={value()}
          disabled={false}
          submitting={false}
          running={false}
          selection={unavailableSelection}
          onInput={setValue}
          onSubmit={() => undefined}
        />
      ),
      host,
    );
    const textarea = host.querySelector("textarea");
    if (!textarea) throw new Error("Composer did not render a textarea");
    let scrollHeight = 76;
    Object.defineProperty(textarea, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });

    textarea.value = "One\nTwo\nThree";
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(textarea.style.height).toBe("76px");
    expect(textarea.style.overflowY).toBe("hidden");

    scrollHeight = 240;
    textarea.value = Array.from({ length: 20 }, (_, index) => `Line ${index}`).join("\n");
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(textarea.style.height).toBe("168px");
    expect(textarea.style.overflowY).toBe("auto");

    scrollHeight = 24;
    setValue("Short again");
    expect(textarea.style.height).toBe("40px");
    expect(textarea.style.overflowY).toBe("hidden");

    dispose();
    host.remove();
  });
});
