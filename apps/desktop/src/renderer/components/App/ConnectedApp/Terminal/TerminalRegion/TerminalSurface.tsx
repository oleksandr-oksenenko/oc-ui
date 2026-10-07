import { useAtomValue } from "@effect/atom-solid";
import { Effect, Schema } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { createEffect, onCleanup, onMount, Show } from "solid-js";
import { Button } from "@opencode/ui/button";
import type { Restty } from "restty";

import type { TerminalSessions } from "../../../../../opencode/terminal-sessions.ts";
import { WorkspaceRequestError, type WorkspaceOwner } from "../../../../../workspace-owner.ts";
import { useTheme } from "../../../../../ui/ThemeProvider.tsx";
import type { createTerminalFonts } from "../createTerminalFonts.ts";
import { createTerminalOutputFilter } from "./terminalOutput.ts";
import "./TerminalSurface.css";

export type TerminalSurfaceProps = {
  readonly id: string;
  readonly controller: Pick<TerminalSessions, "transport">;
  readonly fonts: ReturnType<typeof createTerminalFonts>;
  readonly effects: WorkspaceOwner;
  readonly serverUrl: string;
  readonly visible: boolean;
};

/** The retained DOM surface owns rendering; its workspace owns async setup and settlement. */
export function TerminalSurface(props: TerminalSurfaceProps) {
  let root: HTMLDivElement | undefined;
  let widget: Restty | undefined;
  let started = false;
  let attached = false;
  let refreshTheme: (() => void) | undefined;
  let startRenderer: (() => void) | undefined;
  const appearance = useTheme();
  const state = Atom.make<{ ready: boolean; error?: string }>({ ready: false });
  const releaseState = props.effects.mount(state);
  const current = useAtomValue(() => state);
  const lifetime = props.effects.latest();
  const focusForAction = (loadingAction?: Element) => {
    const active = document.activeElement;
    if (
      props.visible &&
      (active?.hasAttribute("data-terminal-focus") ||
        (loadingAction?.hasAttribute("data-terminal-focus") &&
          !loadingAction.isConnected &&
          active === document.body))
    )
      widget?.focus();
  };
  const updateLayout = () => {
    if (!current().ready || !widget) return false;
    widget.setPaused(!props.visible);
    if (!props.visible || !root || root.clientWidth <= 0 || root.clientHeight <= 0) return false;
    // Hidden initialization may have measured 1x1. Measure usable geometry
    // before the first connection forwards any grid size to the server.
    widget.updateSize(true);
    if (!attached) {
      attached = true;
      widget.connectPty(props.serverUrl);
    }
    return true;
  };

  onMount(() => {
    if (!root) return;
    const element = root;
    const observer = new ResizeObserver(() => {
      updateLayout();
    });
    observer.observe(element);
    onCleanup(() => observer.disconnect());
    startRenderer = () => {
      started = true;
      attached = false;
      const loadingAction = document.activeElement ?? undefined;
      props.effects.registry.set(state, { ready: false });
      lifetime.run(
        Effect.callback<void, WorkspaceRequestError>((resume, signal) => {
          // oxlint-disable-next-line effecttsgo/async-function -- Retain Restty's uncancellable import/font/GPU initialization at its Promise boundary.
          const initialized = (async () => {
            const { Restty, parseGhosttyTheme } = await import("restty");
            if (signal.aborted) return;
            const fonts = await props.effects.runPromise(props.fonts);
            if (signal.aborted) return;
            const styles = getComputedStyle(element);
            const readTheme = () => {
              const palette = getComputedStyle(element);
              return parseGhosttyTheme(
                [
                  `background = ${palette.getPropertyValue("--oc-surface-canvas").trim()}`,
                  `foreground = ${palette.getPropertyValue("--oc-text-base").trim()}`,
                  `cursor-color = ${palette.getPropertyValue("--oc-text-base").trim()}`,
                ].join("\n"),
              );
            };
            refreshTheme = () => widget?.applyTheme(readTheme());
            const transport = props.controller.transport(props.id);
            const filterOutput = createTerminalOutputFilter();
            const clipboard = (operation: () => Promise<boolean>) =>
              props.effects.runPromise(
                props.effects.request(operation).pipe(
                  Effect.asVoid,
                  Effect.catch((error) =>
                    Effect.logWarning("Terminal clipboard operation failed", error),
                  ),
                ),
              );
            widget = new Restty({
              root: element,
              surface: {
                autoInit: false,
                createInitialPane: { focus: false },
                shortcuts: false,
                searchUi: true,
                defaultContextMenu: false,
                contextMenu: {
                  getItems: (pane) => [
                    {
                      label: "Copy",
                      action: () =>
                        clipboard(() => pane.runtime.interaction.copySelectionToClipboard()),
                    },
                    {
                      label: "Paste",
                      enabled: transport.isConnected(),
                      action: () => clipboard(() => pane.runtime.interaction.pasteFromClipboard()),
                    },
                  ],
                },
                paneStyles: false,
              },
              terminal: {
                renderer: "auto",
                fonts: [...fonts],
                fontSize: Number.parseFloat(styles.getPropertyValue("--oc-type-body-size")),
                fontSizeMode: "em",
                // The pinned text-shaper decoder corrupts WOFF2 i/j outlines;
                // its bytecode hinting also stretches glyphs at this size.
                fontHinting: false,
                fontScaleOverrides: [{ match: /^Noto Emoji$/, scale: 1.25 }],
                theme: readTheme(),
                maxScrollbackBytes: 10_000_000,
                showResizeOverlay: false,
                autoResize: false,
              },
              services: {
                ptyTransport: {
                  ...transport,
                  connect: (options) =>
                    transport.connect({
                      ...options,
                      callbacks: {
                        ...options.callbacks,
                        onData: (text) => {
                          const safe = filterOutput(text);
                          if (safe) options.callbacks.onData?.(safe);
                        },
                      },
                    }),
                },
                beforeInput: ({ text }) => (transport.isConnected() ? text : null),
              },
            });
            const pane = widget.getActivePane();
            if (!pane) throw new Error("The terminal surface could not be created.");
            pane.container.querySelector("textarea")?.setAttribute("aria-label", "Terminal input");
            pane.container.querySelector("canvas")?.setAttribute("aria-label", "Terminal output");
            pane.container.querySelector("canvas")?.classList.add("oc-focus-inset");
            await pane.runtime.lifecycle.init();
            if (signal.aborted) return;
            if (widget.getBackend() === "none")
              throw new Error("WebGPU or WebGL2 is required to display the terminal.");
            props.effects.registry.set(state, { ready: true });
            if (updateLayout()) focusForAction(loadingAction);
          })().catch((cause: unknown) => {
            widget?.destroy();
            widget = undefined;
            resume(
              Effect.fail(
                Schema.is(WorkspaceRequestError)(cause)
                  ? cause
                  : new WorkspaceRequestError({ cause }),
              ),
            );
          });
          return Effect.promise(() => initialized).pipe(
            Effect.andThen(
              Effect.sync(() => {
                widget?.destroy();
                widget = undefined;
              }),
            ),
          );
        }).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              props.effects.registry.set(state, {
                ready: false,
                error:
                  error.cause instanceof Error && error.cause.message
                    ? error.cause.message
                    : "The terminal renderer could not start.",
              });
            }),
          ),
        ),
      );
    };
    createEffect(() => {
      if (props.visible && !started) startRenderer?.();
    });
  });

  createEffect(() => {
    appearance.theme();
    if (current().ready) refreshTheme?.();
  });
  createEffect(() => {
    if (updateLayout()) focusForAction();
  });
  onCleanup(() => {
    lifetime.cancel();
    releaseState();
  });

  return (
    <div
      class="terminal-surface"
      data-terminal-id={props.id}
      data-ready={current().ready}
      hidden={!props.visible}
      inert={!props.visible}
    >
      <div
        ref={(element) => {
          root = element;
        }}
        class="terminal-renderer"
      />
      <Show when={!current().ready}>
        <div class="terminal-renderer-notice" role={current().error ? "alert" : "status"}>
          <span>{current().error ?? "Loading terminal…"}</span>
          <Show when={current().error}>
            <Button
              size="small"
              variant="ghost"
              data-terminal-focus
              aria-label="Retry terminal renderer"
              onClick={() => startRenderer?.()}
            >
              Retry renderer
            </Button>
          </Show>
        </div>
      </Show>
    </div>
  );
}
