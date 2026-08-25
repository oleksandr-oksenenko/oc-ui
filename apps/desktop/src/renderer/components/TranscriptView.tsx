import { Button } from "@opencode-ai/ui/button";
import { Loader } from "@opencode-ai/ui/loader";
import { For, Show, createEffect } from "solid-js";

import type { TranscriptItem } from "../domain/transcript.ts";

export type TranscriptViewProps = {
  readonly items: readonly TranscriptItem[];
  readonly loading: boolean;
  readonly error?: string;
  readonly working: boolean;
  readonly onRetry: () => void;
};

export function TranscriptView(props: TranscriptViewProps) {
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

  return (
    <div
      class="transcript-scroller"
      ref={(element) => {
        scroller = element;
      }}
      onScroll={trackScroll}
    >
      <Show when={props.loading && props.items.length === 0}>
        <div class="transcript-state">
          <Loader aria-label="Loading transcript" />
          <span>Loading transcript</span>
        </div>
      </Show>

      <Show when={props.error}>
        {(error) => (
          <div class="transcript-state" role="alert">
            <p>{error()}</p>
            <Button type="button" size="small" variant="outline" onClick={props.onRetry}>
              Retry
            </Button>
          </div>
        )}
      </Show>

      <div class="transcript-list">
        <For each={props.items}>
          {(item) => (
            <article class={`message ${item.kind}`} data-message-id={item.id}>
              <p class="message-author">{item.kind === "user" ? "You" : "Assistant"}</p>
              <Show
                when={item.kind === "assistant"}
                fallback={<p class="message-text">{item.kind === "user" ? item.text : ""}</p>}
              >
                <For each={item.kind === "assistant" ? item.textBlocks : []}>
                  {(block) => <p class="message-text">{block}</p>}
                </For>
                <Show when={item.kind === "assistant" && item.state === "failed"}>
                  <p class="message-failure">Response failed</p>
                </Show>
              </Show>
            </article>
          )}
        </For>

        <Show when={props.working}>
          <div class="working-indicator" role="status">
            <span class="working-dot" />
            <span>OpenCode is working</span>
          </div>
        </Show>
      </div>
    </div>
  );
}
