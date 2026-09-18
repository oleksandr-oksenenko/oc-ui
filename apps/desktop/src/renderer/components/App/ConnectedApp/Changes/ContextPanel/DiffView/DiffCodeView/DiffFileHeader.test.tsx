import { describe, expect, it, vi } from "vite-plus/test";

import { mount } from "../../../../../../../test/mount.ts";

import { DiffFileHeader } from "./DiffFileHeader.tsx";

describe("DiffFileHeader", () => {
  it("renders an accessible disclosure button with truthful totals", () => {
    const onToggle = vi.fn<(expanded: boolean) => void>();
    const { host, dispose } = mount(() => (
      <DiffFileHeader
        path="src/example.ts"
        expanded
        additions={3}
        deletions={1}
        onToggle={onToggle}
      />
    ));

    const toggle = host.querySelector<HTMLButtonElement>("[data-diff-file-toggle]");
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(toggle?.getAttribute("aria-label")).toBe("Collapse src/example.ts");
    expect(host.querySelector(".sr-only")?.textContent).toBe("3 additions, 1 deletions");
    expect(host.querySelector('[data-slot="diff-changes-additions"]')?.textContent).toBe("+3");
    expect(host.querySelector('[data-slot="diff-changes-deletions"]')?.textContent).toBe("-1");

    toggle?.click();
    expect(onToggle).toHaveBeenCalledWith(false);
    dispose();
  });

  it("labels a collapsed file and omits empty change counters", () => {
    const { host, dispose } = mount(() => (
      <DiffFileHeader
        path="README.md"
        expanded={false}
        additions={0}
        deletions={0}
        onToggle={() => undefined}
      />
    ));

    expect(host.querySelector("[data-diff-file-toggle]")?.getAttribute("aria-label")).toBe(
      "Expand README.md",
    );
    expect(host.querySelector('[data-component="diff-changes"]')).toBeNull();
    expect(host.querySelector(".sr-only")?.textContent).toBe("0 additions, 0 deletions");
    dispose();
  });

  it("wires the path to start truncation with an LTR base and a hover tooltip", async () => {
    const path =
      "src/renderer/components/App/ConnectedApp/Changes/ContextPanel/very-long-file-name.tsx";
    const { host, dispose } = mount(() => (
      <DiffFileHeader path={path} expanded additions={1} deletions={1} onToggle={() => undefined} />
    ));

    const pathElement = host.querySelector<HTMLElement>(".diff-file-path");
    expect(pathElement?.classList.contains("truncate-start")).toBe(true);
    const isolatedPath = pathElement?.querySelector("bdi");
    expect(isolatedPath?.getAttribute("dir")).toBe("ltr");
    expect(isolatedPath?.textContent).toBe(path);
    expect(host.querySelector(".diff-file-name [title]")).toBeNull();
    expect(host.querySelector(`[aria-label="Collapse ${path}"]`)?.textContent).toContain(
      "very-long-file-name.tsx",
    );

    const trigger = pathElement?.closest('[data-component="tooltip-v2-trigger"]');
    expect(trigger).not.toBeNull();
    const event = new Event("pointerenter");
    Object.defineProperty(event, "pointerType", { value: "mouse" });
    trigger!.dispatchEvent(event);
    await vi.waitFor(() =>
      expect(document.body.querySelector('[data-component="tooltip-v2"]')?.textContent).toBe(path),
    );

    dispose();
  });
});
