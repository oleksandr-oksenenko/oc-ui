import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vite-plus/test";

import { Composer } from "./Composer.tsx";
import type { ComposerProps } from "./Composer.tsx";

const unavailableSelection = {
  state: "failed" as const,
  switching: false,
  disabled: false,
  models: [],
  variants: [],
  onSelectModel: () => undefined,
  onSelectVariant: () => undefined,
};

const unavailableAgentSelection = {
  state: "failed" as const,
  switching: false,
  disabled: false,
  agents: [],
  onSelectAgent: () => undefined,
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
          modelSelection={unavailableSelection}
          agentSelection={unavailableAgentSelection}
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

  it("shows independent loading states", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const dispose = render(
      () => (
        <Composer
          value=""
          disabled={false}
          submitting={false}
          running={false}
          modelSelection={{
            ...unavailableSelection,
            state: "ready",
            models: [{ id: "model", label: "Model" }],
            variants: [{ id: "variant", label: "Variant" }],
          }}
          agentSelection={{ ...unavailableAgentSelection, state: "loading" }}
          onInput={() => undefined}
          onSubmit={() => undefined}
        />
      ),
      host,
    );

    const placeholders = host.querySelectorAll('.composer-picker[aria-disabled="true"]');
    expect(placeholders).toHaveLength(1);
    expect(placeholders[0]?.textContent).toContain("Loading agents");
    expect(host.querySelectorAll('[data-component="select-v2"]')).toHaveLength(1);
    expect(host.querySelector(".composer-model-trigger")).not.toBeNull();

    dispose();
    host.remove();
  });

  it("keeps agent empty, missing, and failed states honest", () => {
    const renderComposer = (agentSelection: ComposerProps["agentSelection"]) => {
      const host = document.createElement("div");
      document.body.append(host);
      const dispose = render(
        () => (
          <Composer
            value=""
            disabled={false}
            submitting={false}
            running={false}
            modelSelection={unavailableSelection}
            agentSelection={agentSelection}
            onInput={() => undefined}
            onSubmit={() => undefined}
          />
        ),
        host,
      );
      return { host, dispose };
    };

    const empty = renderComposer({ ...unavailableAgentSelection, state: "ready" });
    expect(empty.host.textContent).toContain("No agents");
    empty.dispose();
    empty.host.remove();

    const missing = renderComposer({
      ...unavailableAgentSelection,
      state: "ready",
      agents: [{ id: "build", label: "Build" }],
      selectedAgentID: "missing",
    });
    expect(missing.host.textContent).toContain("Agent unavailable");
    missing.dispose();
    missing.host.remove();

    const failed = renderComposer(unavailableAgentSelection);
    expect(failed.host.textContent).toContain("Agents unavailable");
    failed.dispose();
    failed.host.remove();
  });

  it("renders a searchable model picker and a simple variant picker", async () => {
    const host = document.createElement("div");
    const selectModel = vi.fn<(id: string) => void>();
    const selectAgent = vi.fn<(id: string) => void>();
    const scrollTo = vi.fn<HTMLElement["scrollTo"]>();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: scrollTo,
    });
    document.body.append(host);
    const dispose = render(
      () => (
        <Composer
          value=""
          disabled={false}
          submitting={false}
          running={false}
          modelSelection={{
            state: "ready",
            switching: false,
            disabled: false,
            models: [
              { id: "one", label: "Model One", group: "provider-a" },
              { id: "two", label: "Model Two", group: "provider-b" },
            ],
            selectedModelID: "one",
            variants: [
              { id: "fast", label: "fast" },
              { id: "deep", label: "deep" },
            ],
            selectedVariantID: "deep",
            onSelectModel: selectModel,
            onSelectVariant: () => undefined,
          }}
          agentSelection={{
            ...unavailableAgentSelection,
            state: "ready",
            agents: [
              { id: "build", label: "Build" },
              { id: "plan", label: "Plan" },
            ],
            selectedAgentID: "build",
            onSelectAgent: selectAgent,
          }}
          onInput={() => undefined}
          onSubmit={() => undefined}
        />
      ),
      host,
    );

    const modelTrigger = host.querySelector<HTMLButtonElement>(".composer-model-trigger");
    expect(modelTrigger?.textContent).toContain("Model One");

    const controls = host.querySelectorAll<HTMLElement>('[data-component="select-v2"]');
    expect(controls).toHaveLength(2);
    expect(controls[0]?.textContent).toContain("Build");
    expect(controls[1]?.textContent).toContain("deep");

    modelTrigger?.click();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    const search = document.body.querySelector<HTMLInputElement>(
      '.composer-model-popover [data-component="list"] input',
    );
    expect(search?.placeholder).toBe("Search models");

    const modelTwo = [
      ...document.body.querySelectorAll<HTMLButtonElement>('[data-slot="list-item"]'),
    ].find((item) => item.textContent?.includes("Model Two"));
    modelTwo?.click();
    expect(selectModel).toHaveBeenCalledWith("two");

    const agentControl = controls[0];
    if (!agentControl) throw new Error("Composer did not render an agent picker");
    agentControl.focus();
    agentControl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    const plan = [
      ...document.body.querySelectorAll<HTMLDivElement>('[data-component="menu-v2-item"]'),
    ].find((item) => item.textContent?.includes("Plan"));
    plan?.click();
    expect(selectAgent).toHaveBeenCalledWith("plan");

    dispose();
    host.remove();
    Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  });

  it("disables every picker and send while either selection switches", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const dispose = render(
      () => (
        <Composer
          value="send this"
          disabled={false}
          submitting={false}
          running={false}
          modelSelection={{
            state: "ready",
            switching: false,
            disabled: false,
            models: [{ id: "model", label: "Model" }],
            variants: [{ id: "variant", label: "Variant" }],
            onSelectModel: () => undefined,
            onSelectVariant: () => undefined,
          }}
          agentSelection={{
            state: "ready",
            switching: true,
            disabled: false,
            agents: [{ id: "build", label: "Build" }],
            selectedAgentID: "build",
            onSelectAgent: () => undefined,
          }}
          onInput={() => undefined}
          onSubmit={() => undefined}
        />
      ),
      host,
    );

    expect(host.querySelector<HTMLButtonElement>(".composer-model-trigger")?.disabled).toBe(true);
    expect(host.querySelectorAll('[data-component="select-v2"][data-disabled]')).toHaveLength(2);
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Send"]')?.disabled).toBe(true);
    expect(host.textContent).toContain("Switching agent…");

    dispose();
    host.remove();
  });

  it("closes the agent picker with Escape and restores trigger focus", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const dispose = render(
      () => (
        <Composer
          value=""
          disabled={false}
          submitting={false}
          running={false}
          modelSelection={unavailableSelection}
          agentSelection={{
            ...unavailableAgentSelection,
            state: "ready",
            agents: [
              { id: "build", label: "Build" },
              { id: "plan", label: "Plan" },
            ],
            selectedAgentID: "build",
          }}
          onInput={() => undefined}
          onSubmit={() => undefined}
        />
      ),
      host,
    );
    const trigger = host.querySelector<HTMLElement>('[data-component="select-v2"]');
    if (!trigger) throw new Error("Composer did not render an agent picker");

    trigger.focus();
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);

    dispose();
    host.remove();
  });

  it("restores agent trigger focus after a selection finishes switching", async () => {
    const host = document.createElement("div");
    const [switching, setSwitching] = createSignal(false);
    document.body.append(host);
    const dispose = render(
      () => (
        <Composer
          value=""
          disabled={false}
          submitting={false}
          running={false}
          modelSelection={unavailableSelection}
          agentSelection={{
            ...unavailableAgentSelection,
            state: "ready",
            switching: switching(),
            agents: [
              { id: "build", label: "Build" },
              { id: "plan", label: "Plan" },
            ],
            selectedAgentID: "build",
            onSelectAgent: () => setSwitching(true),
          }}
          onInput={() => undefined}
          onSubmit={() => undefined}
        />
      ),
      host,
    );
    const trigger = host.querySelector<HTMLElement>('[data-component="select-v2"]');
    if (!trigger) throw new Error("Composer did not render an agent picker");

    trigger.focus();
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    const plan = [
      ...document.body.querySelectorAll<HTMLElement>('[data-component="menu-v2-item"]'),
    ].find((option) => option.textContent?.includes("Plan"));
    if (!plan) throw new Error("Agent picker did not render the Plan option");
    plan.click();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    const disabledTrigger = host.querySelector<HTMLElement>('[data-component="select-v2"]');
    expect(disabledTrigger?.getAttribute("data-disabled")).not.toBeNull();
    expect(document.activeElement).not.toBe(disabledTrigger);

    setSwitching(false);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    const enabledTrigger = host.querySelector<HTMLElement>('[data-component="select-v2"]');
    expect(document.activeElement).toBe(enabledTrigger);

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
          modelSelection={unavailableSelection}
          agentSelection={unavailableAgentSelection}
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
          modelSelection={unavailableSelection}
          agentSelection={unavailableAgentSelection}
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
          modelSelection={unavailableSelection}
          agentSelection={unavailableAgentSelection}
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
