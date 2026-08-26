import { Button } from "@opencode-ai/ui/button";
import { IconLoader2 } from "@tabler/icons-solidjs";
import { For, Show, createEffect, type JSX } from "solid-js";

import { AssistantMessage } from "./TranscriptView/AssistantMessage.tsx";
import { UserMessage } from "./TranscriptView/UserMessage.tsx";
import type { TranscriptMessage } from "./transcript-types.ts";

import "./SessionPane.css";

export type TranscriptViewProps = {
  readonly items: readonly TranscriptMessage[];
  readonly loading?: boolean;
  readonly error?: string;
  readonly working?: boolean;
  readonly workingLabel?: string;
  readonly onRetry?: () => void;
  readonly emptyMessage?: string;
};

export function TranscriptView(props: TranscriptViewProps): JSX.Element {
  let scroller: HTMLDivElement | undefined;
  let pinned = true;
  let previousFirst: string | undefined;
  let previousHeight = 0;

  const trackScroll = () => {
    if (!scroller) return;
    pinned = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 72;
    previousHeight = scroller.scrollHeight;
  };

  createEffect(() => {
    const first = props.items[0]?.id;
    const last = props.items.at(-1)?.id;
    const count = props.items.length;
    void last;
    void count;

    queueMicrotask(() => {
      if (!scroller) return;
      if (pinned || previousFirst === undefined) {
        scroller.scrollTop = scroller.scrollHeight;
      } else if (first !== previousFirst) {
        scroller.scrollTop += scroller.scrollHeight - previousHeight;
      }
      previousFirst = first;
      previousHeight = scroller.scrollHeight;
    });
  });

  const retry = () => props.onRetry?.();

  return (
    <div
      class="transcript-view"
      ref={(element) => {
        scroller = element;
      }}
      onScroll={trackScroll}
      aria-busy={props.loading === true}
    >
      <Show when={props.loading === true && props.items.length === 0}>
        <output class="transcript-state" aria-live="polite">
          <IconLoader2 class="transcript-state-loader" size={18} aria-label="Loading transcript" />
          <span>Loading transcript</span>
        </output>
      </Show>

      <Show when={props.error !== undefined}>
        <div class="transcript-state transcript-error-state" role="alert">
          <p>{props.error}</p>
          <Show when={props.onRetry !== undefined}>
            <Button type="button" size="small" variant="outline" onClick={retry}>
              Retry
            </Button>
          </Show>
        </div>
      </Show>

      <Show when={props.loading !== true && props.error === undefined && props.items.length === 0}>
        <div class="transcript-state transcript-empty-state">
          <p>{props.emptyMessage ?? "Start this session with a prompt"}</p>
        </div>
      </Show>

      <Show when={props.items.length > 0 || props.working === true}>
        <div class="transcript-document">
          <For each={props.items}>
            {(item) =>
              item.kind === "user" ? (
                <UserMessage id={item.id} text={item.text} />
              ) : (
                <AssistantMessage id={item.id} blocks={item.blocks} state={item.state} />
              )
            }
          </For>

          <Show when={props.working === true}>
            <output class="transcript-working" aria-live="polite">
              <IconLoader2 class="transcript-working-loader" size={16} aria-label="Working" />
              <span>{props.workingLabel ?? "Working"}</span>
            </output>
          </Show>
        </div>
      </Show>
    </div>
  );
}
