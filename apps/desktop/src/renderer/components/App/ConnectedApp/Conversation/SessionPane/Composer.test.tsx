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
  it("replaces Send with Stop while running", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const [action, setAction] = createSignal<ComposerProps["action"]>("running");
    const stop = vi.fn<() => void>(() => setAction("send"));
    const submit = vi.fn<() => void>();
    const dispose = render(
      () => (
        <Composer
          value="Keep this draft after stopping"
          disabled={false}
          action={action()}
          modelSelection={unavailableSelection}
          agentSelection={unavailableAgentSelection}
          onInput={() => undefined}
          onSubmit={submit}
          onStop={stop}
        />
      ),
      host,
    );

    expect(host.textContent).not.toContain("Draft saved while this run finishes.");
    expect(host.querySelector("output")).toBeNull();
    expect(host.querySelector('[aria-label="Send"]')).toBeNull();
    const stopButton = host.querySelector<HTMLButtonElement>('[aria-label="Stop"]');
    expect(stopButton).not.toBeNull();
    expect(stopButton?.disabled).toBe(false);
    expect(stopButton?.querySelector('[data-slot="icon-svg"]')).not.toBeNull();
    stopButton?.click();
    expect(stop).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
    dispose();
    host.remove();
  });

  it("keeps Send disabled while the prompt is being sent", () => {
    const host = document.createElement("div");
    const submit = vi.fn<() => void>();
    document.body.append(host);
    const dispose = render(
      () => (
        <Composer
          value="Send this"
          action="sending"
          disabled={false}
          modelSelection={unavailableSelection}
          agentSelection={unavailableAgentSelection}
          onInput={() => undefined}
          onSubmit={submit}
        />
      ),
      host,
    );

    const sendButton = host.querySelector<HTMLButtonElement>('[aria-label="Send"]');
    expect(sendButton?.disabled).toBe(true);
    expect(sendButton?.querySelector('[data-component="loader-v2"]')).not.toBeNull();
    sendButton?.click();
    expect(submit).not.toHaveBeenCalled();
    dispose();
    host.remove();
  });

  it("shows independent loading states", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const dispose = render(
      () => (
        <Composer
          value=""
          disabled={false}
          action="send"
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
            action="send"
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
          action="send"
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
    expect(modelTrigger?.getAttribute("aria-label")).toBe("Model: Model One");

    const controls = host.querySelectorAll<HTMLElement>('[data-component="select-v2"]');
    expect(controls).toHaveLength(2);
    expect(controls[0]?.textContent).toContain("Build");
    expect(controls[1]?.textContent).toContain("deep");
    expect(controls[0]?.getAttribute("aria-label")).toBe("Agent: Build");
    expect(controls[1]?.getAttribute("aria-label")).toBe("Variant: deep");

    modelTrigger?.click();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    const search = document.body.querySelector<HTMLInputElement>(
      '.composer-model-popover [data-component="list"] input',
    );
    expect(search?.placeholder).toBe("Search models");
    expect(document.body.querySelector(".composer-model-popover")?.getAttribute("aria-label")).toBe(
      "Models",
    );

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

  it("gives unselected picker triggers coherent accessible names", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const dispose = render(
      () => (
        <Composer
          value=""
          disabled={false}
          action="send"
          modelSelection={{
            ...unavailableSelection,
            state: "ready",
            models: [{ id: "model", label: "Model" }],
            variants: [{ id: "variant", label: "Variant" }],
          }}
          agentSelection={{
            ...unavailableAgentSelection,
            state: "ready",
            agents: [{ id: "agent", label: "Agent" }],
          }}
          onInput={() => undefined}
          onSubmit={() => undefined}
        />
      ),
      host,
    );

    expect(
      host.querySelector<HTMLButtonElement>(".composer-model-trigger")?.getAttribute("aria-label"),
    ).toBe("Model: Select model");
    const controls = host.querySelectorAll<HTMLElement>('[data-component="select-v2"]');
    expect(controls[0]?.getAttribute("aria-label")).toBe("Agent: Default agent");
    expect(controls[1]?.getAttribute("aria-label")).toBe("Variant: Select variant");

    dispose();
    host.remove();
  });

  it("closes the model picker when it becomes disabled", async () => {
    const host = document.createElement("div");
    const [disabled, setDisabled] = createSignal(false);
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: () => undefined,
    });
    document.body.append(host);
    const dispose = render(
      () => (
        <Composer
          value=""
          disabled={false}
          action="send"
          modelSelection={{
            ...unavailableSelection,
            state: "ready",
            disabled: disabled(),
            models: [
              { id: "one", label: "Model One" },
              { id: "two", label: "Model Two" },
            ],
          }}
          agentSelection={unavailableAgentSelection}
          onInput={() => undefined}
          onSubmit={() => undefined}
        />
      ),
      host,
    );

    const trigger = host.querySelector<HTMLButtonElement>(".composer-model-trigger");
    if (!trigger) throw new Error("Composer did not render a model picker");
    trigger.click();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const contentID = trigger.getAttribute("aria-controls");
    expect(contentID).not.toBeNull();

    setDisabled(true);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(contentID ? document.getElementById(contentID) : null).toBeNull();

    dispose();
    host.remove();
    Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  });

  it("does not reopen the model picker when models disappear and return", async () => {
    const host = document.createElement("div");
    const availableModels = [
      { id: "one", label: "Model One" },
      { id: "two", label: "Model Two" },
    ];
    const [models, setModels] = createSignal(availableModels);
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: () => undefined,
    });
    document.body.append(host);
    const dispose = render(
      () => (
        <Composer
          value=""
          disabled={false}
          action="send"
          modelSelection={{
            ...unavailableSelection,
            state: "ready",
            models: models(),
          }}
          agentSelection={unavailableAgentSelection}
          onInput={() => undefined}
          onSubmit={() => undefined}
        />
      ),
      host,
    );

    const trigger = host.querySelector<HTMLButtonElement>(".composer-model-trigger");
    if (!trigger) throw new Error("Composer did not render a model picker");
    trigger.click();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    setModels([]);
    await vi.waitFor(() => expect(host.querySelector(".composer-model-trigger")).toBeNull());
    setModels(availableModels);

    await vi.waitFor(() => {
      expect(
        host
          .querySelector<HTMLButtonElement>(".composer-model-trigger")
          ?.getAttribute("aria-expanded"),
      ).toBe("false");
      expect(document.body.querySelector(".composer-model-popover")).toBeNull();
    });

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
          action="send"
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
          action="send"
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
          action="send"
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

  it("renders a quiet review attachment and sends it without composer text", () => {
    const host = document.createElement("div");
    const submit = vi.fn<() => void>();
    const discard = vi.fn<() => void>();
    document.body.append(host);
    const dispose = render(
      () => (
        <Composer
          value=""
          disabled={false}
          action="send"
          review={{ count: 3, onDiscard: discard }}
          modelSelection={unavailableSelection}
          agentSelection={unavailableAgentSelection}
          onInput={() => undefined}
          onSubmit={submit}
        />
      ),
      host,
    );

    const row = host.querySelector<HTMLElement>(".composer-v2-review-row");
    expect(row?.textContent).toContain("Code review · 3 comments");
    row?.querySelector<HTMLElement>(".composer-v2-review-label")?.click();
    expect(discard).not.toHaveBeenCalled();

    const send = host.querySelector<HTMLButtonElement>('[aria-label="Send"]');
    expect(send?.disabled).toBe(false);
    send?.click();
    expect(submit).toHaveBeenCalledOnce();

    const discardButton = host.querySelector<HTMLButtonElement>(
      '[aria-label="Discard 3 code review comments"]',
    );
    expect(discardButton).not.toBeNull();
    discardButton?.click();
    expect(discard).toHaveBeenCalledWith(discardButton);

    dispose();
    host.remove();
  });

  it("sends annotation-only prompts with Enter while keeping the count action separate", () => {
    const host = document.createElement("div");
    const submit = vi.fn<() => void>();
    const open = vi.fn<(opener: HTMLButtonElement) => void>();
    const discard = vi.fn<(opener: HTMLButtonElement) => void>();
    document.body.append(host);
    const dispose = render(
      () => (
        <Composer
          value=""
          disabled={false}
          action="send"
          annotations={{ count: 2, onOpen: open, onDiscard: discard }}
          modelSelection={unavailableSelection}
          agentSelection={unavailableAgentSelection}
          onInput={() => undefined}
          onSubmit={submit}
        />
      ),
      host,
    );

    const countButton = host.querySelector<HTMLButtonElement>(".composer-v2-annotation-count");
    expect(countButton?.textContent).toContain("Annotations · 2 comments");
    countButton?.click();
    expect(open).toHaveBeenCalledWith(countButton);
    expect(submit).not.toHaveBeenCalled();

    const send = host.querySelector<HTMLButtonElement>('[aria-label="Send"]');
    expect(send?.disabled).toBe(false);
    const textarea = host.querySelector<HTMLTextAreaElement>("textarea");
    if (!textarea) throw new Error("Composer did not render a textarea");
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(submit).toHaveBeenCalledOnce();

    const discardButton = host.querySelector<HTMLButtonElement>(
      '[aria-label="Discard 2 annotations"]',
    );
    if (!discardButton) throw new Error("Composer did not render annotation discard");
    discardButton.click();
    expect(discard).toHaveBeenCalledWith(discardButton);

    dispose();
    host.remove();
  });

  it("removes annotation controls when the controlled attachment clears after submit", () => {
    const host = document.createElement("div");
    const [count, setCount] = createSignal(2);
    document.body.append(host);
    const dispose = render(
      () => (
        <Composer
          value=""
          disabled={false}
          action="send"
          annotations={
            count() > 0
              ? { count: count(), onOpen: () => undefined, onDiscard: () => undefined }
              : undefined
          }
          modelSelection={unavailableSelection}
          agentSelection={unavailableAgentSelection}
          onInput={() => undefined}
          onSubmit={() => setCount(0)}
        />
      ),
      host,
    );

    const send = host.querySelector<HTMLButtonElement>('[aria-label="Send"]');
    if (!send) throw new Error("Composer did not render its send button");
    expect(send.disabled).toBe(false);
    send.click();
    expect(host.querySelector(".composer-v2-annotation-row")).toBeNull();
    expect(send.disabled).toBe(true);

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
          action="send"
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

  it("keeps native submit behavior while switching its pinned artwork", () => {
    const host = document.createElement("div");
    const [action, setAction] = createSignal<ComposerProps["action"]>("send");
    document.body.append(host);
    const dispose = render(
      () => (
        <Composer
          value="send this"
          disabled={false}
          action={action()}
          modelSelection={unavailableSelection}
          agentSelection={unavailableAgentSelection}
          onInput={() => undefined}
          onSubmit={() => undefined}
        />
      ),
      host,
    );
    const button = host.querySelector<HTMLButtonElement>('[aria-label="Send"]');
    if (!button) throw new Error("Composer did not render its send button");

    expect(button.type).toBe("submit");
    expect(button.querySelector('[data-slot="icon-svg"]')).not.toBeNull();
    expect(button.querySelector('[data-component="loader-v2"]')).toBeNull();

    setAction("sending");
    expect(button.disabled).toBe(true);
    expect(button.querySelector('[data-slot="icon-svg"]')).toBeNull();
    expect(button.querySelector('[data-component="loader-v2"]')).not.toBeNull();

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
          action="send"
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
          action="send"
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
