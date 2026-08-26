import { createSignal, onCleanup, onMount, type Accessor } from "solid-js";

export const MOBILE_SHELL_MEDIA_QUERY = "(max-width: 719px)";

type PanelStateOptions = {
  readonly leftSidebarOpen?: boolean;
  readonly rightPanelOpen?: boolean;
};

type PanelState = {
  readonly mobile: Accessor<boolean>;
  readonly leftSidebarOpen: Accessor<boolean>;
  readonly rightPanelOpen: Accessor<boolean>;
  readonly setLeftSidebarOpen: (open: boolean) => void;
  readonly setRightPanelOpen: (open: boolean) => void;
  readonly toggleLeftSidebar: () => void;
  readonly toggleRightPanel: () => void;
};

export function createShellPanelState(options: PanelStateOptions = {}): PanelState {
  const [mobile, setMobile] = createSignal(false);
  const [leftSidebarOpen, setLeftSidebarOpenSignal] = createSignal(options.leftSidebarOpen ?? true);
  const [rightPanelOpen, setRightPanelOpenSignal] = createSignal(options.rightPanelOpen ?? false);

  const setLeftSidebarOpen = (open: boolean): void => {
    if (open && mobile()) setRightPanelOpenSignal(false);
    setLeftSidebarOpenSignal(open);
  };

  const setRightPanelOpen = (open: boolean): void => {
    if (open && mobile()) setLeftSidebarOpenSignal(false);
    setRightPanelOpenSignal(open);
  };

  const toggleLeftSidebar = (): void => setLeftSidebarOpen(!leftSidebarOpen());
  const toggleRightPanel = (): void => setRightPanelOpen(!rightPanelOpen());

  onMount(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(MOBILE_SHELL_MEDIA_QUERY);
    const syncMode = (): void => {
      setMobile(media.matches);
      if (media.matches) {
        setLeftSidebarOpenSignal(false);
        setRightPanelOpenSignal(false);
      }
    };
    const closeMobileOverlay = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || !mobile()) return;
      if (!leftSidebarOpen() && !rightPanelOpen()) return;
      event.preventDefault();
      setLeftSidebarOpenSignal(false);
      setRightPanelOpenSignal(false);
    };

    syncMode();
    media.addEventListener("change", syncMode);
    window.addEventListener("keydown", closeMobileOverlay);
    onCleanup(() => {
      media.removeEventListener("change", syncMode);
      window.removeEventListener("keydown", closeMobileOverlay);
    });
  });

  return {
    mobile,
    leftSidebarOpen,
    rightPanelOpen,
    setLeftSidebarOpen,
    setRightPanelOpen,
    toggleLeftSidebar,
    toggleRightPanel,
  };
}
