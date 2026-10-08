import { createEffect, createSignal, onCleanup, onMount, type JSX } from "solid-js";

import "./Workspace.css";

export type WorkspaceProps = {
  readonly sidebar?: JSX.Element;
  readonly main: JSX.Element;
  readonly context?: JSX.Element;
  readonly bottom?: JSX.Element;
  readonly bottomOpen?: boolean;
  readonly leftSidebarOpen: boolean;
  readonly rightPanelOpen: boolean;
  readonly mobile?: boolean;
};

type ResizeSide = "left" | "right" | "bottom";

const LEFT_MIN = 220;
const LEFT_MAX = 420;
const LEFT_DEFAULT = 248;
const RIGHT_MIN = 280;
const RIGHT_MAX = 840;
const RIGHT_DEFAULT = 360;
const MAIN_MIN = 420;
const BOTTOM_MIN = 120;
const BOTTOM_MAX = 600;
const BOTTOM_DEFAULT = 280;
const MAIN_HEIGHT_MIN = 160;
const KEYBOARD_STEP = 16;

export function Workspace(props: WorkspaceProps) {
  // These slots are fixed for the lifetime of a mounted workspace. Resolve
  // each JSX getter once so presence checks do not recreate live children.
  const sidebar = props.sidebar;
  const main = props.main;
  const context = props.context;
  const bottom = props.bottom;
  let workspace: HTMLDivElement | undefined;
  let drag:
    | {
        readonly pointerID: number;
        readonly side: ResizeSide;
        readonly startPosition: number;
        readonly startSize: number;
      }
    | undefined;

  const [leftWidth, setLeftWidth] = createSignal(LEFT_DEFAULT);
  const [rightWidth, setRightWidth] = createSignal(RIGHT_DEFAULT);
  const [bottomHeight, setBottomHeight] = createSignal(BOTTOM_DEFAULT);
  const [workspaceHeight, setWorkspaceHeight] = createSignal(0);
  const [resizing, setResizing] = createSignal<ResizeSide>();
  const sidebarPresent = sidebar != null;
  const contextOpen = () => context != null && props.rightPanelOpen;
  const bottomOpen = () => bottom != null && props.bottomOpen === true;
  const mobileOverlayOpen = () =>
    props.mobile === true && ((props.leftSidebarOpen && sidebarPresent) || contextOpen());

  createEffect(() => {
    if (resizing() !== "bottom" || (bottomOpen() && !mobileOverlayOpen())) return;
    drag = undefined;
    setResizing(undefined);
    removePointerListeners();
  });

  onMount(() => {
    if (!workspace || !globalThis.ResizeObserver) return;
    const observer = new ResizeObserver(() => setWorkspaceHeight(workspace?.clientHeight ?? 0));
    observer.observe(workspace);
    onCleanup(() => observer.disconnect());
  });

  createEffect(() => {
    const overlay =
      props.mobile === true
        ? props.leftSidebarOpen && sidebarPresent
          ? "left"
          : contextOpen()
            ? "right"
            : undefined
        : undefined;
    if (!overlay) return;

    queueMicrotask(() => {
      const selector = overlay === "left" ? ".shell-left-sidebar" : ".shell-right-panel";
      workspace
        ?.querySelector<HTMLElement>(`${selector} [autofocus]`)
        ?.focus({ preventScroll: true });
    });
  });

  function removePointerListeners() {
    window.removeEventListener("pointermove", continueResize);
    window.removeEventListener("pointerup", finishResize);
    window.removeEventListener("pointercancel", finishResize);
  }

  const currentSize = (side: ResizeSide) => {
    if (side === "bottom") {
      return (
        workspace?.querySelector<HTMLElement>(".shell-bottom-panel")?.offsetHeight || bottomHeight()
      );
    }
    const selector = side === "left" ? ".shell-left-sidebar" : ".shell-right-panel";
    return (
      workspace?.querySelector<HTMLElement>(selector)?.offsetWidth ||
      (side === "left" ? leftWidth() : rightWidth())
    );
  };

  const sizeBounds = (side: ResizeSide) => {
    if (side === "bottom") {
      const height = workspaceHeight() || workspace?.clientHeight || 0;
      const maximum =
        height > 0 ? Math.min(BOTTOM_MAX, Math.max(0, height - MAIN_HEIGHT_MIN)) : BOTTOM_MAX;
      return { minimum: Math.min(BOTTOM_MIN, maximum), maximum };
    }
    const minimum = side === "left" ? LEFT_MIN : RIGHT_MIN;
    const configuredMaximum = side === "left" ? LEFT_MAX : RIGHT_MAX;
    const otherWidth =
      side === "left"
        ? contextOpen()
          ? currentSize("right")
          : 0
        : props.leftSidebarOpen && sidebarPresent
          ? currentSize("left")
          : 0;
    const workspaceWidth = workspace?.clientWidth ?? 0;
    const availableMaximum =
      workspaceWidth > 0 ? workspaceWidth - otherWidth - MAIN_MIN : Number.POSITIVE_INFINITY;
    return {
      minimum,
      maximum: Math.max(minimum, Math.min(configuredMaximum, availableMaximum)),
    };
  };

  const setSize = (side: ResizeSide, nextSize: number) => {
    const { minimum, maximum } = sizeBounds(side);
    const size = Math.min(maximum, Math.max(minimum, nextSize));
    const shell = workspace?.closest<HTMLElement>(".app-shell-v2");
    if (side === "bottom") {
      setBottomHeight(size);
      workspace?.style.setProperty("--shell-bottom-panel-height", `${size}px`);
    } else if (side === "left") {
      setLeftWidth(size);
      shell?.style.setProperty("--shell-left-preferred-width", `${size}px`);
    } else {
      setRightWidth(size);
      shell?.style.setProperty("--shell-right-preferred-width", `${size}px`);
    }
  };

  const beginResize = (
    side: ResizeSide,
    event: PointerEvent & { readonly currentTarget: HTMLDivElement },
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    drag = {
      pointerID: event.pointerId,
      side,
      startPosition: side === "bottom" ? event.clientY : event.clientX,
      startSize: currentSize(side),
    };
    setResizing(side);
    removePointerListeners();
    window.addEventListener("pointermove", continueResize);
    window.addEventListener("pointerup", finishResize);
    window.addEventListener("pointercancel", finishResize);
  };

  function continueResize(event: PointerEvent) {
    if (!drag || drag.pointerID !== event.pointerId) return;
    const movement = (drag.side === "bottom" ? event.clientY : event.clientX) - drag.startPosition;
    setSize(drag.side, drag.startSize + (drag.side === "left" ? movement : -movement));
  }

  function finishResize(event: PointerEvent) {
    if (!drag || drag.pointerID !== event.pointerId) return;
    drag = undefined;
    setResizing(undefined);
    removePointerListeners();
  }

  onCleanup(removePointerListeners);

  const resizeWithKeyboard = (side: ResizeSide, event: KeyboardEvent) => {
    const size = currentSize(side);
    const direction = side === "right" ? -1 : 1;
    if (event.key === (side === "bottom" ? "ArrowDown" : "ArrowLeft")) {
      event.preventDefault();
      setSize(side, size - KEYBOARD_STEP * direction);
    } else if (event.key === (side === "bottom" ? "ArrowUp" : "ArrowRight")) {
      event.preventDefault();
      setSize(side, size + KEYBOARD_STEP * direction);
    } else if (event.key === "Home") {
      event.preventDefault();
      setSize(side, sizeBounds(side).minimum);
    } else if (event.key === "End") {
      event.preventDefault();
      setSize(side, sizeBounds(side).maximum);
    }
  };

  return (
    <div
      ref={(element) => {
        workspace = element;
      }}
      class="shell-workspace"
      classList={{
        "left-sidebar-open": props.leftSidebarOpen && sidebarPresent,
        "right-panel-open": contextOpen(),
        "bottom-panel-open": bottomOpen(),
        mobile: props.mobile === true,
        resizing: resizing() !== undefined,
        "resizing-left": resizing() === "left",
        "resizing-right": resizing() === "right",
        "resizing-bottom": resizing() === "bottom",
      }}
    >
      {props.leftSidebarOpen && sidebarPresent ? (
        <>
          <div
            class="shell-left-sidebar"
            role={props.mobile ? "dialog" : undefined}
            aria-modal={props.mobile ? "true" : undefined}
            aria-label={props.mobile ? "Sessions" : undefined}
          >
            {sidebar}
          </div>
          {props.mobile ? null : (
            <div
              class="shell-resize-handle shell-left-resize-handle oc-focus-inset"
              role="separator"
              aria-label="Resize sessions sidebar"
              aria-orientation="vertical"
              aria-valuemin={LEFT_MIN}
              aria-valuemax={sizeBounds("left").maximum}
              aria-valuenow={leftWidth()}
              tabIndex={0}
              onPointerDown={(event) => beginResize("left", event)}
              onKeyDown={(event) => resizeWithKeyboard("left", event)}
            />
          )}
        </>
      ) : null}
      <section
        class="shell-main"
        aria-hidden={mobileOverlayOpen() ? "true" : undefined}
        inert={mobileOverlayOpen()}
      >
        {main}
      </section>
      {contextOpen() ? (
        <>
          {props.mobile ? null : (
            <div
              class="shell-resize-handle shell-right-resize-handle oc-focus-inset"
              role="separator"
              aria-label="Resize context sidebar"
              aria-orientation="vertical"
              aria-valuemin={RIGHT_MIN}
              aria-valuemax={sizeBounds("right").maximum}
              aria-valuenow={rightWidth()}
              tabIndex={0}
              onPointerDown={(event) => beginResize("right", event)}
              onKeyDown={(event) => resizeWithKeyboard("right", event)}
            />
          )}
          <div
            class="shell-right-panel"
            role={props.mobile ? "dialog" : undefined}
            aria-modal={props.mobile ? "true" : undefined}
            aria-label={props.mobile ? "Workspace context" : undefined}
          >
            {context}
          </div>
        </>
      ) : null}
      {bottom != null ? (
        <section
          class="shell-bottom-panel"
          hidden={!bottomOpen()}
          aria-hidden={!bottomOpen() || mobileOverlayOpen() ? "true" : undefined}
          inert={!bottomOpen() || mobileOverlayOpen()}
        >
          {bottom}
        </section>
      ) : null}
      {bottomOpen() && !mobileOverlayOpen() ? (
        <div
          class="shell-resize-handle shell-bottom-resize-handle oc-focus-inset"
          role="separator"
          aria-label="Resize terminal panel"
          aria-orientation="horizontal"
          aria-valuemin={sizeBounds("bottom").minimum}
          aria-valuemax={sizeBounds("bottom").maximum}
          aria-valuenow={Math.min(bottomHeight(), sizeBounds("bottom").maximum)}
          tabIndex={0}
          onPointerDown={(event) => beginResize("bottom", event)}
          onKeyDown={(event) => resizeWithKeyboard("bottom", event)}
        />
      ) : null}
    </div>
  );
}
