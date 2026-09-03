import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vite-plus/test";

import { mount } from "../../../../../test/mount.ts";
import { DiffView } from "./DiffView.tsx";

const malformedFile = {
  file: "src/example.ts",
  patch: "",
  additions: 2,
  deletions: 1,
  status: "modified" as const,
};

describe("DiffView", () => {
  it("keeps the controlled comparison available while loading", async () => {
    const onComparisonChange = vi.fn<(value: string) => void>();
    const { host, dispose } = mount(() => (
      <DiffView
        files={[]}
        loading
        comparison="working"
        comparisonOptions={[
          { value: "working", label: "Working changes" },
          { value: "branch", label: "Changes vs main" },
        ]}
        onComparisonChange={onComparisonChange}
      />
    ));

    const select = host.querySelector<HTMLElement>('[data-component="select-v2"]');
    expect(select).not.toBeNull();
    expect(select?.textContent).toContain("Working changes");
    select?.focus();
    select?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    const branch = [
      ...document.body.querySelectorAll<HTMLElement>('[data-component="menu-v2-item"]'),
    ].find((option) => option.textContent?.includes("Changes vs main"));
    branch?.click();
    expect(onComparisonChange).toHaveBeenCalledWith("branch");
    expect(host.textContent).toContain("Loading diff");
    dispose();
  });

  it("uses workspace-state wording for an empty comparison", () => {
    const host = document.createElement("div");
    const dispose = render(
      () => (
        <DiffView
          files={[]}
          loading={false}
          emptyMessage="No changes against main"
          emptyDescription="The working copy matches its merge base with main."
        />
      ),
      host,
    );

    expect(host.textContent).toContain("No changes against main");
    expect(host.textContent).not.toContain("session changes");
    dispose();
  });

  it("keeps cached files visible during a failed refresh", () => {
    const onRetry = vi.fn<() => void>();
    const { host, dispose } = mount(() => (
      <DiffView
        files={[malformedFile]}
        loading={false}
        stale
        error="The server is unavailable."
        onRetry={onRetry}
      />
    ));

    expect(host.textContent).toContain("src/example.ts");
    expect(host.textContent).toContain("The server is unavailable.");
    expect(host.textContent).toContain("1 file");
    const retry = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Retry",
    );
    expect(retry).toBeDefined();
    retry?.click();
    expect(onRetry).toHaveBeenCalledOnce();
    dispose();
  });
});
