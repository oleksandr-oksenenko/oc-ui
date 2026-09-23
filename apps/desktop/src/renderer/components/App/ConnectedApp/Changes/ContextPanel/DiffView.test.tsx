import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { mount } from "../../../../../test/mount.ts";
import { stubResizeObserver } from "../../../../../test/resize-observer.ts";
import { DiffView } from "./DiffView.tsx";
import type { DiffFileData } from "./DiffView.tsx";

/** CodeView renders on the next frame and highlights asynchronously. */
const waitFor = <T,>(assertion: () => T | Promise<T>) => vi.waitFor(assertion, { timeout: 5_000 });

const malformedFile: DiffFileData = {
  file: "src/example.ts",
  patch: "",
  additions: 2,
  deletions: 1,
  status: "modified",
};

const mixedFiles: readonly DiffFileData[] = [
  { file: "src/opened.ts", patch: "", additions: 2, deletions: 1, status: "modified" },
  {
    file: "src/closed.ts",
    patch: "",
    additions: 1,
    deletions: 0,
    status: "added",
    defaultExpanded: false,
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DiffView", () => {
  it("keeps the controlled comparison available while loading", async () => {
    const onComparisonChange = vi.fn<(value: string) => void>();
    const { host, dispose } = mount(() => (
      <DiffView
        files={[]}
        presentation={{
          loading: true,
          comparison: "working",
          comparisonOptions: [
            { value: "working", label: "Working changes" },
            { value: "branch", label: "Changes vs main" },
          ],
          onComparisonChange,
        }}
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

  it("hides the comparison selector when only one comparison is available", () => {
    stubResizeObserver();
    const { host, dispose } = mount(() => (
      <DiffView files={[malformedFile]} presentation={{ loading: false, comparison: "working" }} />
    ));

    expect(host.querySelector('[data-component="select-v2"]')).toBeNull();
    expect(host.textContent).toContain("1 file");
    dispose();
  });

  it("shows the comparison selector with no files when two comparisons exist", () => {
    const { host, dispose } = mount(() => (
      <DiffView
        files={[]}
        presentation={{
          loading: false,
          comparison: "branch",
          comparisonOptions: [
            { value: "working", label: "Working changes" },
            { value: "branch", label: "Changes vs main" },
          ],
        }}
      />
    ));

    const select = host.querySelector<HTMLElement>('[data-component="select-v2"]');
    expect(select).not.toBeNull();
    expect(select?.textContent).toContain("Changes vs main");
    dispose();
  });

  it("uses workspace-state wording for an empty comparison", () => {
    const host = document.createElement("div");
    const dispose = render(
      () => (
        <DiffView
          files={[]}
          presentation={{
            loading: false,
            emptyMessage: "No changes against main",
            emptyDescription: "The working copy matches its merge base with main.",
          }}
        />
      ),
      host,
    );

    expect(host.textContent).toContain("No changes against main");
    expect(host.textContent).not.toContain("session changes");
    dispose();
  });

  it("keeps cached files visible during a failed refresh", async () => {
    stubResizeObserver();
    const onRetry = vi.fn<() => void>();
    const { host, dispose } = mount(() => (
      <DiffView
        files={[malformedFile]}
        presentation={{
          loading: false,
          stale: true,
          error: "The server is unavailable.",
          onRetry,
        }}
      />
    ));

    expect(host.textContent).toContain("The server is unavailable.");
    expect(host.textContent).toContain("1 file");
    await waitFor(() => expect(host.textContent).toContain("src/example.ts"));
    const retry = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Retry",
    );
    expect(retry).toBeDefined();
    retry?.click();
    expect(onRetry).toHaveBeenCalledOnce();
    dispose();
  });

  it("collapses and expands every file from the summary control", async () => {
    stubResizeObserver();
    const { host, dispose } = mount(() => (
      <DiffView files={mixedFiles} presentation={{ loading: false }} />
    ));

    const trigger = (path: string) =>
      host.querySelector<HTMLButtonElement>(`[aria-label$=" ${path}"]`);
    const summaryToggle = () => host.querySelector<HTMLButtonElement>(".diff-collapse-toggle");

    await waitFor(() => expect(trigger("src/opened.ts")).not.toBeNull());
    expect(trigger("src/opened.ts")?.getAttribute("aria-expanded")).toBe("true");
    expect(trigger("src/closed.ts")?.getAttribute("aria-expanded")).toBe("false");

    summaryToggle()?.click();
    await waitFor(() =>
      expect(trigger("src/opened.ts")?.getAttribute("aria-label")).toBe("Expand src/opened.ts"),
    );
    expect(summaryToggle()?.getAttribute("aria-label")).toBe("Expand all files");
    expect(trigger("src/opened.ts")?.getAttribute("aria-expanded")).toBe("false");
    expect(trigger("src/closed.ts")?.getAttribute("aria-expanded")).toBe("false");

    summaryToggle()?.click();
    await waitFor(() =>
      expect(trigger("src/closed.ts")?.getAttribute("aria-label")).toBe("Collapse src/closed.ts"),
    );
    expect(summaryToggle()?.getAttribute("aria-label")).toBe("Collapse all files");
    expect(trigger("src/opened.ts")?.getAttribute("aria-expanded")).toBe("true");
    expect(trigger("src/closed.ts")?.getAttribute("aria-expanded")).toBe("true");

    trigger("src/closed.ts")?.click();
    await waitFor(() =>
      expect(trigger("src/closed.ts")?.getAttribute("aria-expanded")).toBe("false"),
    );
    expect(summaryToggle()?.getAttribute("aria-label")).toBe("Collapse all files");
    dispose();
  });

  it("keeps files collapsed when the same paths refresh", async () => {
    stubResizeObserver();
    const file: DiffFileData = {
      file: "src/refresh.ts",
      patch: "",
      additions: 1,
      deletions: 0,
      status: "modified",
    };
    let update!: (next: readonly DiffFileData[]) => void;
    const { host, dispose } = mount(() => {
      const [files, setFiles] = createSignal<readonly DiffFileData[]>([file]);
      update = setFiles;
      return <DiffView files={files()} presentation={{ loading: false }} />;
    });

    await waitFor(() => expect(host.querySelector(".diff-collapse-toggle")).not.toBeNull());
    host.querySelector<HTMLButtonElement>(".diff-collapse-toggle")?.click();
    await waitFor(() =>
      expect(host.querySelector('[aria-label="Expand src/refresh.ts"]')).not.toBeNull(),
    );

    update([{ ...file, additions: 2 }]);

    await waitFor(() =>
      expect(host.querySelector('[aria-label="Expand src/refresh.ts"]')).not.toBeNull(),
    );
    expect(
      host.querySelector<HTMLButtonElement>(".diff-collapse-toggle")?.getAttribute("aria-label"),
    ).toBe("Expand all files");
    dispose();
  });
});
