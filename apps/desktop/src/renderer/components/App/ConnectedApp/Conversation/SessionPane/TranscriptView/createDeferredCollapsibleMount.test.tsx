import { Collapsible } from "@opencode-ai/ui/collapsible";
import { Show, type JSX } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";

import { mount } from "../../../../../../test/mount.ts";
import { createDeferredCollapsibleMount } from "./createDeferredCollapsibleMount.ts";

function DeferredDisclosure(props: {
  readonly children: JSX.Element;
  readonly defaultOpen?: boolean;
}): JSX.Element {
  const content = createDeferredCollapsibleMount(props.defaultOpen === true);
  return (
    <Collapsible defaultOpen={props.defaultOpen === true} onOpenChange={content.onOpenChange}>
      <Collapsible.Trigger>Toggle</Collapsible.Trigger>
      <Show when={content.mount()}>
        <Collapsible.Content>{props.children}</Collapsible.Content>
      </Show>
    </Collapsible>
  );
}

describe("createDeferredCollapsibleMount", () => {
  it("does not construct or animate content before the first expansion", () => {
    const raf = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(() => 0);
    const created = vi.fn<() => string>(() => "");
    const { host, dispose } = mount(() => (
      <DeferredDisclosure>
        {created()}
        <p>value</p>
      </DeferredDisclosure>
    ));

    expect(created).not.toHaveBeenCalled();
    expect(raf).not.toHaveBeenCalled();
    expect(host.querySelector('[data-slot="collapsible-content"]')).toBeNull();

    host.querySelector<HTMLButtonElement>('[data-slot="collapsible-trigger"]')!.click();

    expect(created).toHaveBeenCalledTimes(1);
    expect(raf).toHaveBeenCalledTimes(1);
    const content = host.querySelector<HTMLElement>('[data-slot="collapsible-content"]');
    expect(content?.textContent).toBe("value");
    expect(content?.getAttribute("data-expanded")).toBe("");
    const trigger = host.querySelector<HTMLButtonElement>('[data-slot="collapsible-trigger"]')!;
    expect(trigger.getAttribute("aria-controls")).toBe(content?.id);

    raf.mockRestore();
    dispose();
  });

  it("keeps the disclosure lifecycle through close and reopen", () => {
    const { host, dispose } = mount(() => (
      <DeferredDisclosure>
        <p data-annotation-block='["body"]'>value</p>
      </DeferredDisclosure>
    ));
    const trigger = host.querySelector<HTMLButtonElement>('[data-slot="collapsible-trigger"]')!;

    trigger.click();
    expect(
      host
        .querySelector('[data-slot="collapsible-content"] [data-annotation-block]')
        ?.getAttribute("data-annotation-block"),
    ).toBe('["body"]');

    trigger.click();
    expect(host.querySelector('[data-slot="collapsible-content"]')).toBeNull();
    expect(host.querySelector('[data-slot="collapsible-trigger"]')).toBe(trigger);

    trigger.click();
    expect(host.querySelector('[data-slot="collapsible-content"]')?.textContent).toBe("value");
    expect(host.querySelector('[data-slot="collapsible-trigger"]')).toBe(trigger);

    dispose();
  });

  it("mounts content immediately when the disclosure starts open", () => {
    const { host, dispose } = mount(() => (
      <DeferredDisclosure defaultOpen>
        <p>value</p>
      </DeferredDisclosure>
    ));

    expect(host.querySelector('[data-slot="collapsible-content"]')?.textContent).toBe("value");

    dispose();
  });
});
