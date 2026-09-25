import { createEffect, createSignal, on, onCleanup, onMount, type Accessor } from "solid-js";

import {
  type ContextView,
  type SessionPanelLayout,
  type SessionPanelLayouts,
} from "./sessionPanelLayouts.ts";

export const MOBILE_SHELL_MEDIA_QUERY = "(max-width: 719px)";
export const COMPACT_SHELL_MEDIA_QUERY = "(min-width: 720px) and (max-width: 959px)";

type PanelStateOptions = {
  readonly leftSidebarOpen?: boolean;
  /** Initial right panel visibility before a session is selected (fixtures and tests). */
  readonly rightPanelOpen?: boolean;
  /** Selected session; with `layouts`, the right panel is remembered per session. */
  readonly selectedID?: Accessor<string | undefined>;
  /** Per-session context panel records. Omitted by session-less fixtures. */
  readonly layouts?: SessionPanelLayouts;
};

type PanelState = {
  readonly mobile: Accessor<boolean>;
  readonly contextView: Accessor<ContextView>;
  readonly setContextView: (view: ContextView) => void;
  readonly leftSidebarOpen: Accessor<boolean>;
  readonly rightPanelOpen: Accessor<boolean>;
  readonly setLeftSidebarOpen: (open: boolean) => void;
  readonly setRightPanelOpen: (open: boolean) => void;
  readonly toggleLeftSidebar: () => void;
  readonly toggleRightPanel: () => void;
};

type NarrowOverride = {
  readonly sessionID?: string;
  readonly open: boolean;
};

export function createShellPanelState(options: PanelStateOptions = {}): PanelState {
  const [mobile, setMobile] = createSignal(false);
  const [compact, setCompact] = createSignal(false);
  const [sidebarOpenByMode, setSidebarOpenByMode] = createSignal({
    wide: options.leftSidebarOpen ?? true,
    compact: false,
    mobile: false,
  });
  const [emptyOpen, setEmptyOpen] = createSignal(options.rightPanelOpen ?? false);
  const [emptyView, setEmptyView] = createSignal<ContextView>("diff");
  // Narrow layouts show the panel as an overlay: hidden until an explicit
  // action, tagged so a selection change cannot carry it into another session.
  const [narrowOverride, setNarrowOverride] = createSignal<NarrowOverride | undefined>(undefined);

  const selectedID = (): string | undefined => options.selectedID?.();
  const sidebarMode = (): "wide" | "compact" | "mobile" =>
    mobile() ? "mobile" : compact() ? "compact" : "wide";
  const leftSidebarOpen = (): boolean => sidebarOpenByMode()[sidebarMode()];

  const layout = (): SessionPanelLayout => {
    const id = selectedID();
    if (options.layouts !== undefined && id !== undefined) return options.layouts.layout(id);
    return { open: emptyOpen(), view: emptyView() };
  };

  const narrowOpen = (): boolean => {
    const override = narrowOverride();
    return override !== undefined && override.sessionID === selectedID() ? override.open : false;
  };

  const rightPanelOpen = (): boolean => (mobile() ? narrowOpen() : layout().open);
  const contextView = (): ContextView => layout().view;

  const setRightPanelOpen = (open: boolean): void => {
    if (open && mobile()) setLeftSidebarOpen(false);
    const id = selectedID();
    if (options.layouts !== undefined && id !== undefined) options.layouts.remember(id, { open });
    else setEmptyOpen(open);
    if (mobile()) setNarrowOverride({ sessionID: id, open });
  };

  const setContextView = (view: ContextView): void => {
    const id = selectedID();
    if (options.layouts !== undefined && id !== undefined) options.layouts.remember(id, { view });
    else setEmptyView(view);
  };

  const setLeftSidebarOpen = (open: boolean): void => {
    // Opening the sessions overlay closes the context overlay without remembering it.
    if (open && mobile()) setNarrowOverride(undefined);
    setSidebarOpenByMode((current) => ({ ...current, [sidebarMode()]: open }));
  };

  const toggleLeftSidebar = (): void => setLeftSidebarOpen(!leftSidebarOpen());
  const toggleRightPanel = (): void => setRightPanelOpen(!rightPanelOpen());

  // A selection change ends the previous session's temporary narrow overlay.
  // An override already accepted for the new selection in the same update stays.
  createEffect(
    on(
      selectedID,
      (id) => {
        const override = narrowOverride();
        if (override !== undefined && override.sessionID !== id) setNarrowOverride(undefined);
      },
      { defer: true },
    ),
  );

  onMount(() => {
    if (!("matchMedia" in window)) return;
    const mobileMedia = window.matchMedia(MOBILE_SHELL_MEDIA_QUERY);
    const compactMedia = window.matchMedia(COMPACT_SHELL_MEDIA_QUERY);
    const syncMode = (): void => {
      setMobile(mobileMedia.matches);
      setCompact(compactMedia.matches);
      setNarrowOverride(undefined);
      if (mobileMedia.matches) {
        setSidebarOpenByMode((current) => ({ ...current, mobile: false }));
      }
    };
    const closeMobileOverlay = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || !mobile()) return;
      if (!leftSidebarOpen() && !rightPanelOpen()) return;
      event.preventDefault();
      setLeftSidebarOpen(false);
      setNarrowOverride(undefined);
    };

    syncMode();
    mobileMedia.addEventListener("change", syncMode);
    compactMedia.addEventListener("change", syncMode);
    window.addEventListener("keydown", closeMobileOverlay);
    onCleanup(() => {
      mobileMedia.removeEventListener("change", syncMode);
      compactMedia.removeEventListener("change", syncMode);
      window.removeEventListener("keydown", closeMobileOverlay);
    });
  });

  return {
    contextView,
    setContextView,
    mobile,
    leftSidebarOpen,
    rightPanelOpen,
    setLeftSidebarOpen,
    setRightPanelOpen,
    toggleLeftSidebar,
    toggleRightPanel,
  };
}
