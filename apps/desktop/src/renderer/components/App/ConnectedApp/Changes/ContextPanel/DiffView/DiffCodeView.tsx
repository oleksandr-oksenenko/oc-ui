import { CodeView } from "@pierre/diffs";
import type { CodeViewOptions } from "@pierre/diffs";
import { createEffect, createMemo, createSignal, on, onCleanup, untrack } from "solid-js";
import { render } from "solid-js/web";

import { activeDiffTheme } from "../../../../../../diff-highlighter.ts";
import { useDiffHighlight } from "../../../../../../ui/DiffHighlightProvider.tsx";
import { useTheme } from "../../../../../../ui/ThemeProvider.tsx";

import type { DiffFileData, DiffReviewView } from "../DiffView.tsx";
import { DiffFileHeader } from "./DiffFileHeader.tsx";
import {
  createDiffCodeViewItem,
  diffItemSignature,
  enhanceRenderedDiff,
  createReviewAnnotation,
  syncGutterCommentIcons,
  DIFF_HEADER_HEIGHT,
  DIFF_LINE_HEIGHT,
  type AnnotationMetadata,
} from "./diff-code-view.ts";
import { getSelectedCode, prepareDiffRender } from "./diff-render-data.ts";

export type DiffCodeViewProps = {
  readonly files: readonly DiffFileData[];
  readonly review?: DiffReviewView;
  readonly expanded: (file: DiffFileData) => boolean;
  readonly onToggle: (path: string, expanded: boolean) => void;
};

const UNSAFE_CSS = `
  :host {
    position: relative;
    --diffs-font-size: var(--oc-type-code-size);
    --diffs-line-height: var(--oc-type-code-line-height);
    --diffs-bg-selection-override: var(--oc-surface-selected);
  }

  :host::after {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 3;
    border: 1px solid var(--oc-border-base);
    border-radius: var(--oc-radius);
    pointer-events: none;
  }

  :is(code[data-code], [data-expand-button]):focus-visible {
    outline: var(--oc-focus-ring-outline);
    outline-offset: var(--oc-focus-ring-inset-offset);
  }

  :host([data-diff-file-unavailable]) [data-line] {
    color: var(--oc-text-muted);
  }

  [data-gutter-buffer="annotation"] {
    position: relative;
  }

  .diff-review-gutter-icon {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 14px;
    height: 14px;
    color: var(--oc-text-base);
    pointer-events: none;
  }
`;

/**
 * Solid adapter for one vanilla Pierre CodeView. CodeView owns the file-list
 * viewport, item measurement, sticky headers, and element pooling; this
 * component derives controlled items from panel props and maps Pierre's
 * callbacks back onto the app-owned review state.
 */
export function DiffCodeView(props: DiffCodeViewProps) {
  const { theme } = useTheme();
  const manager = useDiffHighlight();
  const [host, setHost] = createSignal<HTMLDivElement>();

  let view: CodeView<AnnotationMetadata> | undefined;
  let pendingFocusPath: string | undefined;
  let versionCounter = 0;
  const versions = new Map<string, { readonly signature: string; readonly version: number }>();

  /**
   * CodeView asks for header content during its render pass, so each file's
   * header is a Solid root keyed by path. Reusing the container keeps the
   * product Tooltip's state and avoids leaking a root per render.
   */
  type HeaderRoot = {
    readonly container: HTMLElement;
    readonly dispose: () => void;
    readonly update: (input: {
      readonly expanded: boolean;
      readonly additions: number;
      readonly deletions: number;
      readonly onToggle: (expanded: boolean) => void;
    }) => void;
  };
  const headerRoots = new Map<string, HeaderRoot>();

  const headerRootFor = (path: string): HeaderRoot => {
    const existing = headerRoots.get(path);
    if (existing) return existing;
    const [expanded, setExpanded] = createSignal(false);
    const [additions, setAdditions] = createSignal(0);
    const [deletions, setDeletions] = createSignal(0);
    const [onToggle, setOnToggle] = createSignal<(expanded: boolean) => void>(() => undefined);
    const container = document.createElement("div");
    const dispose = render(
      () => (
        <DiffFileHeader
          path={path}
          expanded={expanded()}
          additions={additions()}
          deletions={deletions()}
          onToggle={(next) => onToggle()(next)}
        />
      ),
      container,
    );
    const root: HeaderRoot = {
      container,
      dispose,
      update: (input) => {
        setExpanded(input.expanded);
        setAdditions(input.additions);
        setDeletions(input.deletions);
        setOnToggle(() => input.onToggle);
      },
    };
    headerRoots.set(path, root);
    return root;
  };

  const filesById = createMemo(
    () => new Map(props.files.map((file) => [file.file, file] as const)),
  );

  // Preparing patches is the expensive part, so it only reruns when the file
  // list changes; review and expansion changes reuse the parsed metadata.
  const prepared = createMemo(() =>
    props.files.map((file) => ({ file, renderData: prepareDiffRender(file) })),
  );

  const versionFor = (path: string, signature: string): number => {
    const current = versions.get(path);
    if (current?.signature === signature) return current.version;
    versionCounter += 1;
    versions.set(path, { signature, version: versionCounter });
    return versionCounter;
  };

  const items = createMemo(() =>
    prepared().map(({ file, renderData }) => {
      const expanded = props.expanded(file);
      const signature = diffItemSignature({
        path: file.file,
        renderData,
        expanded,
        review: props.review,
      });
      return createDiffCodeViewItem({
        file,
        renderData,
        expanded,
        review: props.review,
        version: versionFor(file.file, signature),
      });
    }),
  );

  const selection = createMemo(() => props.review?.selectedLines ?? null);
  const gutterEnabled = createMemo(
    () => props.review !== undefined && props.review.editingCommentID === undefined,
  );

  const optionsFor = (): CodeViewOptions<AnnotationMetadata> => ({
    theme: activeDiffTheme(theme()),
    themeType: theme(),
    diffStyle: "unified",
    overflow: "scroll",
    disableFileHeader: false,
    stickyHeaders: true,
    itemMetrics: { diffHeaderHeight: DIFF_HEADER_HEIGHT, lineHeight: DIFF_LINE_HEIGHT },
    layout: { paddingTop: 0, paddingBottom: 8, gap: 8 },
    enableGutterUtility: gutterEnabled(),
    enableLineSelection: props.review !== undefined,
    controlledSelection: false,
    unsafeCSS: UNSAFE_CSS,
    renderCustomHeader: (_input, context) => {
      const file = filesById().get(context.item.id);
      const root = headerRootFor(context.item.id);
      root.update({
        expanded: context.item.collapsed !== true,
        additions: file?.additions ?? 0,
        deletions: file?.deletions ?? 0,
        onToggle: (expanded) => props.onToggle(context.item.id, expanded),
      });
      return root.container;
    },
    renderAnnotation: (annotation) => {
      const review = props.review;
      const comment = review?.comments.find((item) => item.id === annotation.metadata?.commentID);
      return comment && review ? createReviewAnnotation(comment, review) : undefined;
    },
    onGutterUtilityClick: (selected, context) => {
      const review = props.review;
      if (!review || context.item.type !== "diff") return;
      const selectedCode = getSelectedCode(context.item.fileDiff, selected);
      if (selectedCode !== undefined)
        review.onBeginComment?.(context.item.id, selected, selectedCode);
    },
    onPostRender: (container, _instance, phase, context) => {
      if (phase === "unmount") return;
      container.classList.add("diff-file");
      container.classList.toggle("diff-file-unavailable", context.item.type === "file");
      enhanceRenderedDiff(container);
      syncGutterCommentIcons(container);
      if (pendingFocusPath !== context.item.id) return;
      pendingFocusPath = undefined;
      container.querySelector<HTMLElement>("[data-diff-file-toggle]")?.focus();
    },
  });

  const captureFocus = (): void => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return;
    const path = active.dataset.diffFileToggle;
    if (path !== undefined) pendingFocusPath = path;
  };

  const syncItems = (): void => {
    if (!view) return;
    captureFocus();
    view.setItems(items());
  };

  const syncSelection = (): void => {
    if (!view) return;
    const selected = selection();
    if (selected)
      view.setSelectedLines({ id: selected.path, range: selected.range }, { notify: false });
    else view.clearSelectedLines({ notify: false });
  };

  const rebuild = (): void => {
    const element = host();
    if (!element) return;
    view?.cleanUp();
    view = new CodeView<AnnotationMetadata>(optionsFor(), manager());
    view.setup(element);
    syncItems();
    syncSelection();
  };

  createEffect(on([host, manager], () => untrack(rebuild)));
  createEffect(on(items, () => syncItems(), { defer: true }));
  createEffect(on(selection, () => syncSelection(), { defer: true }));
  createEffect(
    on([() => theme(), gutterEnabled], () => view?.setOptions(optionsFor()), { defer: true }),
  );
  createEffect(() => {
    const ids = new Set(props.files.map((file) => file.file));
    for (const path of versions.keys()) if (!ids.has(path)) versions.delete(path);
    for (const [path, root] of headerRoots) {
      if (ids.has(path)) continue;
      root.dispose();
      headerRoots.delete(path);
    }
  });

  onCleanup(() => {
    view?.cleanUp();
    view = undefined;
    versions.clear();
    for (const root of headerRoots.values()) root.dispose();
    headerRoots.clear();
  });

  return (
    <div
      ref={(element) => setHost(element)}
      class="diff-code-view oc-scrollable"
      role="region"
      aria-label="Changed files"
    />
  );
}
