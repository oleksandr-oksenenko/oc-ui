import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vite-plus/test";

import { Composer } from "./Composer.tsx";

describe("Composer", () => {
  it("rejects whitespace and respects application busy state", () => {
    const host = document.createElement("div");
    const [value, setValue] = createSignal("   \n");
    const [disabled, setDisabled] = createSignal(false);
    const submit = vi.fn();
    document.body.append(host);
    const dispose = render(
      () => (
        <Composer
          value={value()}
          disabled={disabled()}
          submitting={false}
          running={false}
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
    setDisabled(true);
    expect(button.disabled).toBe(true);
    dispose();
    host.remove();
  });

  it("submits with Ctrl+Enter but keeps ordinary Enter for newlines", () => {
    const host = document.createElement("div");
    const submit = vi.fn();
    document.body.append(host);
    const dispose = render(
      () => (
        <Composer
          value="two\nlines"
          disabled={false}
          submitting={false}
          running={false}
          onInput={() => undefined}
          onSubmit={submit}
        />
      ),
      host,
    );
    const textarea = host.querySelector("textarea");
    if (!textarea) throw new Error("Composer did not render a textarea");

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(submit).not.toHaveBeenCalled();
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }),
    );
    expect(submit).toHaveBeenCalledOnce();
    dispose();
    host.remove();
  });
});
