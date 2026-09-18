import { CodeView } from "@pierre/diffs";
import { WorkerPoolManager } from "@pierre/diffs/worker";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { mount } from "../../../../../../test/mount.ts";
import { stubResizeObserver } from "../../../../../../test/resize-observer.ts";
import { DiffHighlightProvider } from "../../../../../../ui/DiffHighlightProvider.tsx";
import type { DiffFileData, DiffReviewView } from "../DiffView.tsx";
import { DiffCodeView } from "./DiffCodeView.tsx";

/** CodeView renders on the next frame and highlights asynchronously. */
const waitFor = <T,>(assertion: () => T | Promise<T>) => vi.waitFor(assertion, { timeout: 5_000 });

// Any pool method a renderer calls is a no-op; this test only needs identity.
const fakeManager = new Proxy(WorkerPoolManager.prototype, {
  get: () => () => undefined,
});

const file = (overrides: Partial<DiffFileData> = {}): DiffFileData => ({
  file: overrides.file ?? "src/example.ts",
  additions: overrides.additions ?? 1,
  deletions: overrides.deletions ?? 1,
  status: overrides.status ?? "modified",
  patch: overrides.patch ?? "@@ -1 +1 @@\n-old\n+new\n",
  ...overrides,
});

const selection = { start: 1, side: "additions", end: 1 } as const;
const comment = {
  id: "comment-1",
  path: "src/example.ts",
  body: "Check this",
  selection,
  selectedCode: "new\n",
};

const review = (overrides: Partial<DiffReviewView> = {}): DiffReviewView => ({
  comments: [comment],
  ...overrides,
});

beforeEach(() => {
  stubResizeObserver();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("DiffCodeView", () => {
  it("publishes derived items with collapse state and per-path versions", () => {
    const setItems = vi.spyOn(CodeView.prototype, "setItems");
    const { dispose } = mount(() => (
      <DiffCodeView
        files={[file(), file({ file: "src/closed.ts", defaultExpanded: false })]}
        expanded={(candidate) => candidate.defaultExpanded ?? true}
        onToggle={() => undefined}
      />
    ));

    const items = setItems.mock.calls.at(-1)?.[0] ?? [];
    expect(items).toMatchObject([
      { id: "src/example.ts", type: "diff", collapsed: false },
      { id: "src/closed.ts", type: "diff", collapsed: true },
    ]);
    expect(items[0]?.version).toBeTypeOf("number");
    dispose();
  });

  it("republishes content with a new version but keeps comment bodies inert", () => {
    const setItems = vi.spyOn(CodeView.prototype, "setItems");
    const [files, setFiles] = createSignal<readonly DiffFileData[]>([file()]);
    const [body, setBody] = createSignal("Check this");
    const { dispose } = mount(() => (
      <DiffCodeView
        files={files()}
        review={review({ comments: [{ ...comment, body: body() }] })}
        expanded={() => true}
        onToggle={() => undefined}
      />
    ));

    const items = () => setItems.mock.calls.at(-1)?.[0] ?? [];
    const firstVersion = items()[0]?.version;

    setBody("Check this and that");
    expect(items()[0]?.version).toBe(firstVersion);

    setFiles([file({ patch: "@@ -1 +1 @@\n-old\n+changed\n" })]);
    const changed = items()[0];
    expect(changed?.version).not.toBe(firstVersion);
    expect(changed?.type === "diff" && changed.fileDiff.additionLines.join("")).toContain(
      "changed",
    );
    dispose();
  });

  it("publishes the review selection and clears it again", () => {
    const setSelectedLines = vi.spyOn(CodeView.prototype, "setSelectedLines");
    const clearSelectedLines = vi.spyOn(CodeView.prototype, "clearSelectedLines");
    const [reviewView, setReviewView] = createSignal<DiffReviewView | undefined>(
      review({ selectedLines: { path: "src/example.ts", range: selection } }),
    );
    const { dispose } = mount(() => (
      <DiffCodeView
        files={[file()]}
        review={reviewView()}
        expanded={() => true}
        onToggle={() => undefined}
      />
    ));

    expect(setSelectedLines).toHaveBeenCalledWith(
      { id: "src/example.ts", range: selection },
      { notify: false },
    );

    setReviewView(undefined);
    expect(clearSelectedLines).toHaveBeenCalledWith({ notify: false });
    dispose();
  });

  it("recreates the CodeView when the highlight manager changes", () => {
    const setup = vi.spyOn(CodeView.prototype, "setup");
    const cleanUp = vi.spyOn(CodeView.prototype, "cleanUp");
    const [manager, setManager] = createSignal<WorkerPoolManager | undefined>(undefined);
    const { host, dispose } = mount(() => (
      <DiffHighlightProvider manager={manager}>
        <DiffCodeView files={[file()]} expanded={() => true} onToggle={() => undefined} />
      </DiffHighlightProvider>
    ));

    expect(setup).toHaveBeenCalledTimes(1);
    setManager(fakeManager);
    expect(setup).toHaveBeenCalledTimes(2);
    expect(cleanUp).toHaveBeenCalledTimes(1);
    expect(host.querySelectorAll(":scope > div")).toHaveLength(1);

    dispose();
    expect(cleanUp).toHaveBeenCalledTimes(2);
  });

  it("renders headers that toggle through the owner and restores focus after refresh", async () => {
    const onToggle = vi.fn<(path: string, expanded: boolean) => void>();
    const [files, setFiles] = createSignal<readonly DiffFileData[]>([file()]);
    const { host, dispose } = mount(() => (
      <DiffCodeView files={files()} expanded={() => true} onToggle={onToggle} />
    ));

    await waitFor(() =>
      expect(host.querySelector('[data-diff-file-toggle="src/example.ts"]')).not.toBeNull(),
    );
    const toggle = host.querySelector<HTMLButtonElement>(
      '[data-diff-file-toggle="src/example.ts"]',
    );
    toggle?.focus();
    toggle?.click();
    expect(onToggle).toHaveBeenCalledWith("src/example.ts", false);

    setFiles([file({ patch: "@@ -1 +1 @@\n-old\n+changed\n" })]);
    await waitFor(() => {
      const next = host.querySelector<HTMLButtonElement>(
        '[data-diff-file-toggle="src/example.ts"]',
      );
      expect(next).not.toBeNull();
      expect(document.activeElement).toBe(next);
    });
    dispose();
  });

  it("marks collapsed rows so their rendered height matches the item estimate", async () => {
    const [expanded, setExpanded] = createSignal(false);
    const { host, dispose } = mount(() => (
      <DiffCodeView files={[file()]} expanded={() => expanded()} onToggle={() => undefined} />
    ));

    await waitFor(() => {
      expect(host.querySelector("diffs-container")?.hasAttribute("data-diff-file-collapsed")).toBe(
        true,
      );
    });

    setExpanded(true);
    await waitFor(() => {
      expect(host.querySelector("diffs-container")?.hasAttribute("data-diff-file-collapsed")).toBe(
        false,
      );
    });
    dispose();
  });

  it("renders review annotations and marks fallback rows", async () => {
    const { host, dispose } = mount(() => (
      <DiffCodeView
        files={[file(), file({ file: "README.md", patch: "", additions: 0, deletions: 0 })]}
        review={review()}
        expanded={() => true}
        onToggle={() => undefined}
      />
    ));

    await waitFor(() => {
      expect(host.querySelector<HTMLElement>(".diff-review-annotation")?.dataset.commentId).toBe(
        "comment-1",
      );
    });
    expect(host.querySelector(".diff-review-text")?.textContent).toBe("Check this");
    await waitFor(() => {
      const fallback = host.querySelector<HTMLElement>(".diff-file-unavailable");
      expect(fallback).not.toBeNull();
      expect(fallback?.shadowRoot?.textContent).toContain("This patch could not be displayed.");
    });
    dispose();
  });
});
