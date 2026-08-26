import { createSignal, type JSX } from "solid-js";

import "./Workspace.css";

export type WorkspaceProps = {
  readonly sidebar?: JSX.Element;
  readonly main: JSX.Element;
  readonly context?: JSX.Element;
  readonly leftSidebarOpen: boolean;
  readonly rightPanelOpen: boolean;
  readonly mobile?: boolean;
};

type ResizeSide = "left" | "right";

const LEFT_MIN = 160;
const LEFT_MAX = 420;
const LEFT_DEFAULT = 200;
const RIGHT_MIN = 280;
const RIGHT_MAX = 560;
const RIGHT_DEFAULT = 360;
const MAIN_MIN = 420;
const KEYBOARD_STEP = 16;

export function Workspace(props: WorkspaceProps) {
  let workspace: HTMLDivElement | undefined;
  let drag:
    | {
        readonly pointerID: number;
        readonly side: ResizeSide;
        readonly startX: number;
        readonly startWidth: number;
      }
    | undefined;

  const [leftWidth, setLeftWidth] = createSignal(LEFT_DEFAULT);
  const [rightWidth, setRightWidth] = createSignal(RIGHT_DEFAULT);
  const [resizing, setResizing] = createSignal<ResizeSide>();
  const sidebarPresent = () => props.sidebar != null;
  const contextOpen = () => props.context != null && props.rightPanelOpen;
  const mobileOverlayOpen = () =>
    props.mobile === true && ((props.leftSidebarOpen && sidebarPresent()) || contextOpen());

  const widthBounds = (side: ResizeSide) => {
    const minimum = side === "left" ? LEFT_MIN : RIGHT_MIN;
    const configuredMaximum = side === "left" ? LEFT_MAX : RIGHT_MAX;
    const otherWidth =
      side === "left"
        ? contextOpen()
          ? rightWidth()
          : 0
        : props.leftSidebarOpen && sidebarPresent()
          ? leftWidth()
          : 0;
    const workspaceWidth = workspace?.clientWidth ?? 0;
    const availableMaximum =
      workspaceWidth > 0 ? workspaceWidth - otherWidth - MAIN_MIN : Number.POSITIVE_INFINITY;
    return {
      minimum,
      maximum: Math.max(minimum, Math.min(configuredMaximum, availableMaximum)),
    };
  };

  const setWidth = (side: ResizeSide, nextWidth: number) => {
    const { minimum, maximum } = widthBounds(side);
    const width = Math.min(maximum, Math.max(minimum, nextWidth));
    const shell = workspace?.closest<HTMLElement>(".app-shell-v2");
    if (side === "left") {
      setLeftWidth(width);
      shell?.style.setProperty("--shell-left-sidebar-width", `${width}px`);
    } else {
      setRightWidth(width);
      shell?.style.setProperty("--shell-right-panel-width", `${width}px`);
    }
  };

  const beginResize = (side: ResizeSide, event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag = {
      pointerID: event.pointerId,
      side,
      startX: event.clientX,
      startWidth: side === "left" ? leftWidth() : rightWidth(),
    };
    setResizing(side);
  };

  const continueResize = (event: PointerEvent) => {
    if (!drag || drag.pointerID !== event.pointerId) return;
    const movement = event.clientX - drag.startX;
    setWidth(drag.side, drag.startWidth + (drag.side === "left" ? movement : -movement));
  };

  const finishResize = (event: PointerEvent) => {
    if (!drag || drag.pointerID !== event.pointerId) return;
    drag = undefined;
    setResizing(undefined);
  };

  const resizeWithKeyboard = (side: ResizeSide, event: KeyboardEvent) => {
    const currentWidth = side === "left" ? leftWidth() : rightWidth();
    const direction = side === "left" ? 1 : -1;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setWidth(side, currentWidth - KEYBOARD_STEP * direction);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setWidth(side, currentWidth + KEYBOARD_STEP * direction);
    } else if (event.key === "Home") {
      event.preventDefault();
      setWidth(side, widthBounds(side).minimum);
    } else if (event.key === "End") {
      event.preventDefault();
      setWidth(side, widthBounds(side).maximum);
    }
  };

  return (
    <div
      ref={(element) => {
        workspace = element;
      }}
      class="shell-workspace"
      classList={{
        "left-sidebar-open": props.leftSidebarOpen && sidebarPresent(),
        "right-panel-open": contextOpen(),
        mobile: props.mobile === true,
        resizing: resizing() !== undefined,
      }}
    >
      {props.leftSidebarOpen && sidebarPresent() ? (
        <>
          <div
            class="shell-left-sidebar"
            role={props.mobile ? "dialog" : undefined}
            aria-modal={props.mobile ? "true" : undefined}
            aria-label={props.mobile ? "Sessions" : undefined}
          >
            {props.sidebar}
          </div>
          {props.mobile ? null : (
            <div
              class="shell-resize-handle shell-left-resize-handle"
              role="separator"
              aria-label="Resize sessions sidebar"
              aria-orientation="vertical"
              aria-valuemin={LEFT_MIN}
              aria-valuemax={widthBounds("left").maximum}
              aria-valuenow={leftWidth()}
              tabIndex={0}
              onPointerDown={(event) => beginResize("left", event)}
              onPointerMove={continueResize}
              onPointerUp={finishResize}
              onLostPointerCapture={finishResize}
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
        {props.main}
      </section>
      {contextOpen() ? (
        <>
          {props.mobile ? null : (
            <div
              class="shell-resize-handle shell-right-resize-handle"
              role="separator"
              aria-label="Resize context sidebar"
              aria-orientation="vertical"
              aria-valuemin={RIGHT_MIN}
              aria-valuemax={widthBounds("right").maximum}
              aria-valuenow={rightWidth()}
              tabIndex={0}
              onPointerDown={(event) => beginResize("right", event)}
              onPointerMove={continueResize}
              onPointerUp={finishResize}
              onLostPointerCapture={finishResize}
              onKeyDown={(event) => resizeWithKeyboard("right", event)}
            />
          )}
          <div
            class="shell-right-panel"
            role={props.mobile ? "dialog" : undefined}
            aria-modal={props.mobile ? "true" : undefined}
            aria-label={props.mobile ? "Workspace context" : undefined}
          >
            {props.context}
          </div>
        </>
      ) : null}
    </div>
  );
}
