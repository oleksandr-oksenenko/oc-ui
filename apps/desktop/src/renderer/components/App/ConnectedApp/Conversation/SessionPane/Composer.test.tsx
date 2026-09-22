import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { mount } from "../../../../../test/mount.ts";
import type { FileTransferLike } from "../../../../../opencode/attachments.ts";
import { Composer } from "./Composer.tsx";
import type { ComposerProps } from "./Composer.tsx";

// The renderer sets this signal before mounting (mount-app.tsx); the tests
// choose the platform explicitly.
const setPlatform = (platform: "macos" | "other") => {
  document.documentElement.dataset.platform = platform;
};

afterEach(() => {
  delete document.documentElement.dataset.platform;
});

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

const tooltipText = () => document.body.querySelector('[data-component="tooltip-v2"]')?.textContent;

const dragEvent = (type: string, dataTransfer: FileTransferLike): Event => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  return event;
};

describe("Composer", () => {
  it("attaches pasted files and inserts ordinary text paste", () => {
    const paste = vi.fn<(files: readonly File[]) => void>();
    const remove = vi.fn<(file: File) => void>();
    const onInput = vi.fn<(value: string) => void>();
    const screenshot = new File(["image"], "screenshot.png", { type: "image/png" });
    const { host, dispose } = mount(() => (
      <Composer
        value=""
        files={[screenshot]}
        onAttachFiles={paste}
        onRemoveFile={remove}
        action="send"
        disabled={false}
        modelSelection={unavailableSelection}
        agentSelection={unavailableAgentSelection}
        onInput={onInput}
        onSubmit={() => undefined}
      />
    ));
    const input = host.querySelector<HTMLDivElement>('[aria-label="Prompt"]')!;
    expect(host.querySelector('[aria-label="Enlarge screenshot.png"]')).not.toBeNull();
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { files: [screenshot], getData: () => "" },
    });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(paste).toHaveBeenCalledWith([screenshot]);
    expect(onInput).not.toHaveBeenCalled();
    const textPaste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(textPaste, "clipboardData", {
      value: { files: [], getData: () => "hello" },
    });
    input.dispatchEvent(textPaste);
    expect(textPaste.defaultPrevented).toBe(true);
    expect(onInput).toHaveBeenLastCalledWith("hello", []);
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Send"]')?.disabled).toBe(false);
    host.querySelector<HTMLButtonElement>('[aria-label="Remove screenshot.png"]')!.click();
    expect(remove).toHaveBeenCalledWith(screenshot);
    dispose();
  });

  it("opens the picker and attaches the chosen files", () => {
    const attach = vi.fn<(files: readonly File[]) => void>();
    const notes = new File(["notes"], "notes.txt", { type: "text/plain" });
    const { host, dispose } = mount(() => (
      <Composer
        value=""
        onAttachFiles={attach}
        action="send"
        disabled={false}
        modelSelection={unavailableSelection}
        agentSelection={unavailableAgentSelection}
        onInput={() => undefined}
        onSubmit={() => undefined}
      />
    ));

    const button = host.querySelector<HTMLButtonElement>('[aria-label="Add images and files"]');
    const input = host.querySelector<HTMLInputElement>('input[type="file"]');
    if (!button || !input) throw new Error("Composer did not render its picker");
    const click = vi.spyOn(input, "click");
    button.click();
    expect(click).toHaveBeenCalledOnce();

    Object.defineProperty(input, "files", { configurable: true, value: [notes] });
    Object.defineProperty(input, "value", {
      configurable: true,
      writable: true,
      value: "C:\\fakepath\\notes.txt",
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));

    expect(attach).toHaveBeenCalledWith([notes]);
    expect(input.value).toBe("");
    dispose();
  });

  it("attaches dropped files, shows the drop state, and cancels the event", () => {
    const attach = vi.fn<(files: readonly File[]) => void>();
    const notes = new File(["notes"], "notes.txt", { type: "text/plain" });
    const { host, dispose } = mount(() => (
      <Composer
        value=""
        onAttachFiles={attach}
        action="send"
        disabled={false}
        modelSelection={unavailableSelection}
        agentSelection={unavailableAgentSelection}
        onInput={() => undefined}
        onSubmit={() => undefined}
      />
    ));

    const form = host.querySelector("form");
    if (!form) throw new Error("Composer did not render its form");

    const enter = dragEvent("dragenter", { files: [], types: ["Files"] });
    form.dispatchEvent(enter);
    expect(form.getAttribute("data-dropping")).toBe("true");
    expect(host.querySelector(".composer-drop-overlay")).not.toBeNull();

    const over = dragEvent("dragover", { files: [], types: ["Files"] });
    form.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);

    const drop = dragEvent("drop", { files: [notes], types: ["Files"] });
    form.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    expect(attach).toHaveBeenCalledWith([notes]);
    expect(form.hasAttribute("data-dropping")).toBe(false);
    expect(host.querySelector(".composer-drop-overlay")).toBeNull();
    dispose();
  });

  it("hides the drop state when the drag leaves without dropping", () => {
    const { host, dispose } = mount(() => (
      <Composer
        value=""
        onAttachFiles={() => undefined}
        action="send"
        disabled={false}
        modelSelection={unavailableSelection}
        agentSelection={unavailableAgentSelection}
        onInput={() => undefined}
        onSubmit={() => undefined}
      />
    ));
    const form = host.querySelector("form");
    if (!form) throw new Error("Composer did not render its form");

    form.dispatchEvent(dragEvent("dragenter", { files: [], types: ["Files"] }));
    form.dispatchEvent(dragEvent("dragleave", { files: [], types: ["Files"] }));
    expect(host.querySelector(".composer-drop-overlay")).toBeNull();
    dispose();
  });

  it("ignores text drags", () => {
    const attach = vi.fn<(files: readonly File[]) => void>();
    const { host, dispose } = mount(() => (
      <Composer
        value=""
        onAttachFiles={attach}
        action="send"
        disabled={false}
        modelSelection={unavailableSelection}
        agentSelection={unavailableAgentSelection}
        onInput={() => undefined}
        onSubmit={() => undefined}
      />
    ));
    const form = host.querySelector("form");
    if (!form) throw new Error("Composer did not render its form");

    const over = dragEvent("dragover", { files: [], types: ["text/plain"] });
    form.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(false);

    const drop = dragEvent("drop", { files: [], types: ["text/plain"] });
    form.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(false);
    expect(attach).not.toHaveBeenCalled();
    expect(host.querySelector(".composer-drop-overlay")).toBeNull();
    dispose();
  });

  it("attaches a paste exposed only through clipboard items", () => {
    const attach = vi.fn<(files: readonly File[]) => void>();
    const notes = new File(["notes"], "notes.txt", { type: "text/plain" });
    const { host, dispose } = mount(() => (
      <Composer
        value=""
        onAttachFiles={attach}
        action="send"
        disabled={false}
        modelSelection={unavailableSelection}
        agentSelection={unavailableAgentSelection}
        onInput={() => undefined}
        onSubmit={() => undefined}
      />
    ));
    const input = host.querySelector<HTMLDivElement>('[aria-label="Prompt"]');
    if (!input) throw new Error("Composer did not render its prompt");

    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { files: [], items: [{ kind: "file", getAsFile: () => notes }] },
    });
    input.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(attach).toHaveBeenCalledWith([notes]);
    dispose();
  });

  it("stops an empty running composer without accidentally submitting", () => {
    const [action, setAction] = createSignal<ComposerProps["action"]>("running");
    const stop = vi.fn<() => void>(() => setAction("send"));
    const submit = vi.fn<() => void>();
    const { host, dispose } = mount(() => (
      <Composer
        value=""
        disabled={false}
        action={action()}
        modelSelection={unavailableSelection}
        agentSelection={unavailableAgentSelection}
        onInput={() => undefined}
        onSubmit={submit}
        onStop={stop}
      />
    ));

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
  });

  it("keeps Send disabled while the prompt is being sent", () => {
    const submit = vi.fn<() => void>();
    const { host, dispose } = mount(() => (
      <Composer
        value="Send this"
        action="sending"
        disabled={false}
        modelSelection={unavailableSelection}
        agentSelection={unavailableAgentSelection}
        onInput={() => undefined}
        onSubmit={submit}
      />
    ));

    const sendButton = host.querySelector<HTMLButtonElement>('[aria-label="Send"]');
    expect(sendButton?.disabled).toBe(true);
    expect(sendButton?.querySelector('[data-component="loader-v2"]')).not.toBeNull();
    sendButton?.click();
    expect(submit).not.toHaveBeenCalled();
    dispose();
  });

  it("shows independent loading states", () => {
    const { host, dispose } = mount(() => (
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
    ));

    const placeholders = host.querySelectorAll('.composer-picker[aria-disabled="true"]');
    expect(placeholders).toHaveLength(1);
    expect(placeholders[0]?.textContent).toContain("Loading agents");
    expect(host.querySelectorAll('[data-component="select-v2"]')).toHaveLength(1);
    expect(host.querySelector(".composer-model-trigger")).not.toBeNull();

    dispose();
  });

  it("keeps agent empty, missing, and failed states honest", () => {
    const renderComposer = (agentSelection: ComposerProps["agentSelection"]) =>
      mount(() => (
        <Composer
          value=""
          disabled={false}
          action="send"
          modelSelection={unavailableSelection}
          agentSelection={agentSelection}
          onInput={() => undefined}
          onSubmit={() => undefined}
        />
      ));

    const empty = renderComposer({ ...unavailableAgentSelection, state: "ready" });
    expect(empty.host.textContent).toContain("No agents");
    empty.dispose();

    const missing = renderComposer({
      ...unavailableAgentSelection,
      state: "ready",
      agents: [{ id: "build", label: "Build" }],
      selectedAgentID: "missing",
    });
    expect(missing.host.textContent).toContain("Agent unavailable");
    missing.dispose();

    const failed = renderComposer(unavailableAgentSelection);
    expect(failed.host.textContent).toContain("Agents unavailable");
    failed.dispose();
  });

  it("renders a searchable model picker and a simple variant picker", async () => {
    const selectModel = vi.fn<(id: string) => void>();
    const selectAgent = vi.fn<(id: string) => void>();
    const scrollTo = vi.fn<HTMLElement["scrollTo"]>();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: scrollTo,
    });
    const { host, dispose } = mount(() => (
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
    ));

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
    Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  });

  it("gives unselected picker triggers coherent accessible names", () => {
    const { host, dispose } = mount(() => (
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
    ));

    expect(
      host.querySelector<HTMLButtonElement>(".composer-model-trigger")?.getAttribute("aria-label"),
    ).toBe("Model: Select model");
    const controls = host.querySelectorAll<HTMLElement>('[data-component="select-v2"]');
    expect(controls[0]?.getAttribute("aria-label")).toBe("Agent: Default agent");
    expect(controls[1]?.getAttribute("aria-label")).toBe("Variant: Select variant");

    dispose();
  });

  it("closes the model picker when it becomes disabled", async () => {
    const [disabled, setDisabled] = createSignal(false);
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: () => undefined,
    });
    const { host, dispose } = mount(() => (
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
    ));

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
    Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  });

  it("does not reopen the model picker when models disappear and return", async () => {
    const availableModels = [
      { id: "one", label: "Model One" },
      { id: "two", label: "Model Two" },
    ];
    const [models, setModels] = createSignal(availableModels);
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: () => undefined,
    });
    const { host, dispose } = mount(() => (
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
    ));

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
    Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  });

  it("disables every picker and send while either selection switches", () => {
    const { host, dispose } = mount(() => (
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
    ));

    expect(host.querySelector<HTMLButtonElement>(".composer-model-trigger")?.disabled).toBe(true);
    expect(host.querySelectorAll('[data-component="select-v2"][data-disabled]')).toHaveLength(2);
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Send"]')?.disabled).toBe(true);
    expect(host.textContent).toContain("Switching agent…");

    dispose();
  });

  it("closes the agent picker with Escape and restores trigger focus", async () => {
    const { host, dispose } = mount(() => (
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
    ));
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
  });

  it("restores agent trigger focus after a selection finishes switching", async () => {
    const [switching, setSwitching] = createSignal(false);
    const { host, dispose } = mount(() => (
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
    ));
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
  });

  it("renders a quiet review attachment and sends it without composer text", () => {
    const submit = vi.fn<() => void>();
    const discard = vi.fn<() => void>();
    const { host, dispose } = mount(() => (
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
    ));

    const row = host.querySelector<HTMLElement>(".composer-review-row");
    expect(row?.textContent).toContain("Code review · 3 comments");
    row?.querySelector<HTMLElement>(".composer-review-label")?.click();
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
  });

  it("sends annotation-only prompts with Enter while keeping the count action separate", () => {
    const submit = vi.fn<() => void>();
    const open = vi.fn<(opener: HTMLButtonElement) => void>();
    const discard = vi.fn<(opener: HTMLButtonElement) => void>();
    const { host, dispose } = mount(() => (
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
    ));

    const countButton = host.querySelector<HTMLButtonElement>(".composer-annotation-count");
    expect(countButton?.textContent).toContain("Annotations · 2 comments");
    countButton?.click();
    expect(open).toHaveBeenCalledWith(countButton);
    expect(submit).not.toHaveBeenCalled();

    const send = host.querySelector<HTMLButtonElement>('[aria-label="Send"]');
    expect(send?.disabled).toBe(false);
    const textarea = host.querySelector<HTMLDivElement>('[aria-label="Prompt"]');
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
  });

  it("removes annotation controls when the controlled attachment clears after submit", () => {
    const [count, setCount] = createSignal(2);
    const { host, dispose } = mount(() => (
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
    ));

    const send = host.querySelector<HTMLButtonElement>('[aria-label="Send"]');
    if (!send) throw new Error("Composer did not render its send button");
    expect(send.disabled).toBe(false);
    send.click();
    expect(host.querySelector(".composer-annotation-row")).toBeNull();
    expect(send.disabled).toBe(true);

    dispose();
  });

  it("rejects whitespace and respects application busy state", () => {
    const [value, setValue] = createSignal("   \n");
    const [disabled, setDisabled] = createSignal(false);
    const submit = vi.fn<() => void>();
    const { host, dispose } = mount(() => (
      <Composer
        value={value()}
        disabled={disabled()}
        action="send"
        modelSelection={unavailableSelection}
        agentSelection={unavailableAgentSelection}
        onInput={setValue}
        onSubmit={submit}
      />
    ));
    const button = host.querySelector<HTMLButtonElement>('[aria-label="Send"]');
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
  });

  it("keeps native submit behavior while switching its pinned artwork", () => {
    const [action, setAction] = createSignal<ComposerProps["action"]>("send");
    const { host, dispose } = mount(() => (
      <Composer
        value="send this"
        disabled={false}
        action={action()}
        modelSelection={unavailableSelection}
        agentSelection={unavailableAgentSelection}
        onInput={() => undefined}
        onSubmit={() => undefined}
      />
    ));
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
  });

  it("moves the queue shortcuts from below the composer into the send tooltip", async () => {
    setPlatform("macos");
    vi.useFakeTimers();
    const [action, setAction] = createSignal<ComposerProps["action"]>("send");
    const [onQueue, setOnQueue] = createSignal<(() => void) | undefined>(() => undefined);
    const { host, dispose } = mount(() => (
      <Composer
        value="send this"
        disabled={false}
        action={action()}
        modelSelection={unavailableSelection}
        agentSelection={unavailableAgentSelection}
        onInput={() => undefined}
        onSubmit={() => undefined}
        onQueue={onQueue()}
      />
    ));

    const button = host.querySelector<HTMLButtonElement>('[aria-label="Send"]');
    const trigger = button?.closest('[data-component="tooltip-v2-trigger"]');
    expect(host.querySelector(".composer-shortcuts")).toBeNull();
    expect(button?.hasAttribute("title")).toBe(false);
    expect(trigger).not.toBeNull();

    const event = new Event("pointerenter");
    Object.defineProperty(event, "pointerType", { value: "mouse" });
    trigger!.dispatchEvent(event);
    await vi.advanceTimersByTimeAsync(600);

    expect(tooltipText()).toBe("Enter to send · ⌘ Enter to queue · Shift Enter for a new line");

    setAction("running");
    expect(tooltipText()).toBe("Enter to steer · ⌘ Enter to queue · Shift Enter for a new line");

    setOnQueue(undefined);
    expect(tooltipText()).toBe("Send steering message (Enter)");

    setAction("send");
    expect(tooltipText()).toBe("Send");

    dispose();
    vi.useRealTimers();
  });

  it("labels the queue chord for the non-macOS platform", async () => {
    setPlatform("other");
    vi.useFakeTimers();
    const { host, dispose } = mount(() => (
      <Composer
        value="send this"
        disabled={false}
        action="send"
        modelSelection={unavailableSelection}
        agentSelection={unavailableAgentSelection}
        onInput={() => undefined}
        onSubmit={() => undefined}
        onQueue={() => undefined}
      />
    ));
    const button = host.querySelector<HTMLButtonElement>('[aria-label="Send"]');
    const trigger = button?.closest('[data-component="tooltip-v2-trigger"]');
    const event = new Event("pointerenter");
    Object.defineProperty(event, "pointerType", { value: "mouse" });
    trigger!.dispatchEvent(event);
    await vi.advanceTimersByTimeAsync(600);

    expect(tooltipText()).toBe("Enter to send · Ctrl Enter to queue · Shift Enter for a new line");

    dispose();
    vi.useRealTimers();
  });

  it("queues with the platform's chord and never sends from it", () => {
    const cases = [
      { platform: "macos" as const, chord: { metaKey: true } },
      { platform: "other" as const, chord: { ctrlKey: true } },
    ];
    for (const { platform, chord } of cases) {
      setPlatform(platform);
      const submit = vi.fn<() => void>();
      const queue = vi.fn<() => void>();
      const { host, dispose } = mount(() => (
        <Composer
          value="send this"
          disabled={false}
          action="send"
          modelSelection={unavailableSelection}
          agentSelection={unavailableAgentSelection}
          onInput={() => undefined}
          onSubmit={submit}
          onQueue={queue}
        />
      ));
      const prompt = host.querySelector<HTMLDivElement>('[aria-label="Prompt"]');
      if (!prompt) throw new Error("Composer did not render a prompt");

      prompt.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, ...chord }));

      expect(queue).toHaveBeenCalledOnce();
      expect(submit).not.toHaveBeenCalled();
      dispose();
    }
  });

  it("consumes the queue chord when queueing is unavailable", () => {
    setPlatform("macos");
    const submit = vi.fn<() => void>();
    const { host, dispose } = mount(() => (
      <Composer
        value="send this"
        disabled={false}
        action="send"
        modelSelection={unavailableSelection}
        agentSelection={unavailableAgentSelection}
        onInput={() => undefined}
        onSubmit={submit}
      />
    ));
    const prompt = host.querySelector<HTMLDivElement>('[aria-label="Prompt"]');
    if (!prompt) throw new Error("Composer did not render a prompt");

    prompt.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }),
    );
    expect(submit).not.toHaveBeenCalled();

    // Enter keeps its send contract when the chord is not held.
    prompt.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(submit).toHaveBeenCalledOnce();
    dispose();
  });

  it("consumes the queue chord when the draft is not eligible", () => {
    setPlatform("macos");
    for (const props of [
      { disabled: true, value: "send this" },
      { disabled: false, value: "" },
    ]) {
      const submit = vi.fn<() => void>();
      const queue = vi.fn<() => void>();
      const { host, dispose } = mount(() => (
        <Composer
          value={props.value}
          disabled={props.disabled}
          action="send"
          modelSelection={unavailableSelection}
          agentSelection={unavailableAgentSelection}
          onInput={() => undefined}
          onSubmit={submit}
          onQueue={queue}
        />
      ));
      const prompt = host.querySelector<HTMLDivElement>('[aria-label="Prompt"]');
      if (!prompt) throw new Error("Composer did not render a prompt");

      prompt.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }),
      );
      expect(queue).not.toHaveBeenCalled();
      expect(submit).not.toHaveBeenCalled();
      dispose();
    }
  });

  it("keeps the stop tooltip while a running composer is empty", async () => {
    vi.useFakeTimers();
    const { host, dispose } = mount(() => (
      <Composer
        value=""
        disabled={false}
        action="running"
        modelSelection={unavailableSelection}
        agentSelection={unavailableAgentSelection}
        onInput={() => undefined}
        onSubmit={() => undefined}
        onStop={() => undefined}
      />
    ));

    const button = host.querySelector<HTMLButtonElement>('[aria-label="Stop"]');
    const trigger = button?.closest('[data-component="tooltip-v2-trigger"]');
    const event = new Event("pointerenter");
    Object.defineProperty(event, "pointerType", { value: "mouse" });
    trigger!.dispatchEvent(event);
    await vi.advanceTimersByTimeAsync(600);
    expect(tooltipText()).toBe("Stop");

    dispose();
    vi.useRealTimers();
  });

  it("submits with Enter but keeps Shift+Enter for newlines", () => {
    const submit = vi.fn<() => void>();
    const { host, dispose } = mount(() => (
      <Composer
        value="two\nlines"
        disabled={false}
        action="send"
        modelSelection={unavailableSelection}
        agentSelection={unavailableAgentSelection}
        onInput={() => undefined}
        onSubmit={submit}
      />
    ));
    const textarea = host.querySelector<HTMLDivElement>('[aria-label="Prompt"]');
    if (!textarea) throw new Error("Composer did not render a textarea");

    textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }),
    );
    expect(submit).not.toHaveBeenCalled();
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(submit).toHaveBeenCalledOnce();
    dispose();
  });

  it("shows context usage as a ring that fills and hides without a limit", async () => {
    vi.useFakeTimers();
    const { host, dispose } = mount(() => (
      <Composer
        value=""
        disabled={false}
        action="send"
        contextUsage={{ used: 64_000, limit: 100_000 }}
        modelSelection={unavailableSelection}
        agentSelection={unavailableAgentSelection}
        onInput={() => undefined}
        onSubmit={() => undefined}
      />
    ));

    const meter = host.querySelector<HTMLElement>(".composer-context-meter");
    expect(meter).not.toBeNull();
    expect(meter?.dataset.contextPercentage).toBe("64");
    expect(meter?.getAttribute("aria-label")).toBe("Context 64% used · 64k of 100k tokens");
    expect(meter?.dataset.level).toBe("normal");
    expect(meter?.querySelector(".composer-context-fill")).not.toBeNull();

    const trigger = meter?.closest('[data-component="tooltip-v2-trigger"]');
    const event = new Event("pointerenter");
    Object.defineProperty(event, "pointerType", { value: "mouse" });
    trigger!.dispatchEvent(event);
    await vi.advanceTimersByTimeAsync(600);
    expect(tooltipText()).toBe("Context 64% used · 64k of 100k tokens");

    dispose();
    vi.useRealTimers();
  });

  it("renders an empty context ring without a fill", () => {
    const { host, dispose } = mount(() => (
      <Composer
        value=""
        disabled={false}
        action="send"
        contextUsage={{ used: 0, limit: 100_000 }}
        modelSelection={unavailableSelection}
        agentSelection={unavailableAgentSelection}
        onInput={() => undefined}
        onSubmit={() => undefined}
      />
    ));

    expect(
      host.querySelector<HTMLElement>(".composer-context-meter")?.dataset.contextPercentage,
    ).toBe("0");
    expect(host.querySelector(".composer-context-fill")).toBeNull();

    dispose();
  });

  it("keeps attachments available while submission is disabled", () => {
    const { host, dispose } = mount(() => (
      <Composer
        value=""
        disabled
        action="send"
        onAttachFiles={() => undefined}
        modelSelection={unavailableSelection}
        agentSelection={unavailableAgentSelection}
        onInput={() => undefined}
        onSubmit={() => undefined}
      />
    ));

    expect(
      host.querySelector<HTMLButtonElement>('[aria-label="Add images and files"]')?.disabled,
    ).toBe(false);
    dispose();
  });

  it("does not advertise or consume attachments without a callback", () => {
    const { host, dispose } = mount(() => (
      <Composer
        value=""
        disabled={false}
        action="send"
        modelSelection={unavailableSelection}
        agentSelection={unavailableAgentSelection}
        onInput={() => undefined}
        onSubmit={() => undefined}
      />
    ));

    const button = host.querySelector<HTMLButtonElement>('[aria-label="Add images and files"]');
    expect(button?.disabled).toBe(true);

    const form = host.querySelector("form");
    if (!form) throw new Error("Composer did not render its form");
    form.dispatchEvent(dragEvent("dragenter", { files: [], types: ["Files"] }));
    expect(host.querySelector(".composer-drop-overlay")).toBeNull();

    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { files: [new File(["x"], "x.txt")], getData: () => "" },
    });
    form.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    dispose();
  });

  it("delivers a picker selection only to the session that opened it", () => {
    const attach = vi.fn<(files: readonly File[]) => void>();
    const [sessionID, setSessionID] = createSignal<string | undefined>("a");
    const notes = new File(["notes"], "notes.txt", { type: "text/plain" });
    const { host, dispose } = mount(() => (
      <Composer
        value=""
        sessionID={sessionID()}
        disabled={false}
        action="send"
        onAttachFiles={attach}
        modelSelection={unavailableSelection}
        agentSelection={unavailableAgentSelection}
        onInput={() => undefined}
        onSubmit={() => undefined}
      />
    ));
    const button = host.querySelector<HTMLButtonElement>('[aria-label="Add images and files"]');
    const input = host.querySelector<HTMLInputElement>('input[type="file"]');
    if (!button || !input) throw new Error("Composer did not render its picker");
    vi.spyOn(input, "click");

    button.click();
    setSessionID("b");
    Object.defineProperty(input, "files", { configurable: true, value: [notes] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(attach).not.toHaveBeenCalled();

    button.click();
    Object.defineProperty(input, "files", { configurable: true, value: [notes] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(attach).toHaveBeenCalledWith([notes]);
    dispose();
  });

  it("attaches a file dropped on the editor without inserting its text", () => {
    const attach = vi.fn<(files: readonly File[]) => void>();
    const onInput = vi.fn<(value: string) => void>();
    const notes = new File(["notes"], "notes.txt", { type: "text/plain" });
    const { host, dispose } = mount(() => (
      <Composer
        value=""
        disabled={false}
        action="send"
        onAttachFiles={attach}
        modelSelection={unavailableSelection}
        agentSelection={unavailableAgentSelection}
        onInput={onInput}
        onSubmit={() => undefined}
      />
    ));
    const editor = host.querySelector<HTMLDivElement>('[aria-label="Prompt"]');
    if (!editor) throw new Error("Composer did not render its prompt");
    const dataTransfer = { files: [notes], types: ["Files"], getData: () => "dropped text" };

    const over = dragEvent("dragover", dataTransfer);
    editor.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);

    const drop = dragEvent("drop", dataTransfer);
    editor.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    expect(attach).toHaveBeenCalledTimes(1);
    expect(attach).toHaveBeenCalledWith([notes]);
    expect(onInput).not.toHaveBeenCalled();
    dispose();
  });

  it("keeps the drop state across nested drag transitions", () => {
    const { host, dispose } = mount(() => (
      <Composer
        value=""
        disabled={false}
        action="send"
        onAttachFiles={() => undefined}
        modelSelection={unavailableSelection}
        agentSelection={unavailableAgentSelection}
        onInput={() => undefined}
        onSubmit={() => undefined}
      />
    ));
    const form = host.querySelector("form");
    const editor = host.querySelector<HTMLDivElement>('[aria-label="Prompt"]');
    if (!form || !editor) throw new Error("Composer did not render its target");
    const dataTransfer = { files: [], types: ["Files"] };

    form.dispatchEvent(dragEvent("dragenter", dataTransfer));
    editor.dispatchEvent(dragEvent("dragenter", dataTransfer));
    editor.dispatchEvent(dragEvent("dragleave", dataTransfer));
    expect(host.querySelector(".composer-drop-overlay")).not.toBeNull();

    form.dispatchEvent(dragEvent("dragleave", dataTransfer));
    expect(host.querySelector(".composer-drop-overlay")).toBeNull();
    dispose();
  });

  it("hides the drop state when attachment capability disappears", () => {
    const [canAttach, setCanAttach] = createSignal(true);
    const { host, dispose } = mount(() => (
      <Composer
        value=""
        disabled={false}
        action="send"
        onAttachFiles={canAttach() ? () => undefined : undefined}
        modelSelection={unavailableSelection}
        agentSelection={unavailableAgentSelection}
        onInput={() => undefined}
        onSubmit={() => undefined}
      />
    ));
    const form = host.querySelector("form");
    if (!form) throw new Error("Composer did not render its form");

    form.dispatchEvent(dragEvent("dragenter", { files: [], types: ["Files"] }));
    expect(host.querySelector(".composer-drop-overlay")).not.toBeNull();

    setCanAttach(false);
    expect(host.querySelector(".composer-drop-overlay")).toBeNull();
    dispose();
  });

  it("lets ProseMirror insert a URI-only paste", () => {
    const onInput = vi.fn<(value: string) => void>();
    const { host, dispose } = mount(() => (
      <Composer
        value=""
        disabled={false}
        action="send"
        onAttachFiles={() => undefined}
        modelSelection={unavailableSelection}
        agentSelection={unavailableAgentSelection}
        onInput={onInput}
        onSubmit={() => undefined}
      />
    ));
    const editor = host.querySelector<HTMLDivElement>('[aria-label="Prompt"]');
    if (!editor) throw new Error("Composer did not render its prompt");

    // Empty text/plain must defer to ProseMirror instead of replacing the
    // selection with an empty slice, so the URI-list fallback still inserts.
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: {
        files: [],
        getData: (type: string) => (type === "text/uri-list" ? "https://example.com/a" : ""),
      },
    });
    editor.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(onInput.mock.calls.at(-1)?.[0]).toContain("https://example.com/a");
    dispose();
  });
});
