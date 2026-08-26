/**
 * Provider-neutral transcript data. A domain adapter should project its own
 * message records into these small presentation types before rendering.
 */
export type TranscriptInline =
  | string
  | {
      readonly kind: "text";
      readonly text: string;
    }
  | {
      readonly kind: "link";
      readonly text: string;
      readonly href: string;
    };

export type TranscriptContent = TranscriptInline | readonly TranscriptInline[];

export type AssistantTextBlock =
  | {
      readonly kind: "paragraph";
      readonly content: TranscriptContent;
    }
  | {
      readonly kind: "heading";
      readonly content: TranscriptContent;
      readonly level?: 1 | 2 | 3;
    }
  | {
      readonly kind: "list";
      readonly items: readonly TranscriptContent[];
      readonly ordered?: boolean;
    }
  | {
      readonly kind: "quote";
      readonly content: TranscriptContent;
    };

type ReasoningSummaryBlock = {
  readonly kind: "reasoning";
  readonly summary: string;
  readonly label?: string;
  readonly duration?: string;
  readonly defaultOpen?: boolean;
};

export type ToolCallKind = "read" | "search" | "command" | "generic";

type ToolCallBlock = {
  readonly kind: "tool";
  readonly name: string;
  readonly toolKind?: ToolCallKind;
  readonly target?: string;
  readonly detail?: string;
  readonly status: "running" | "done" | "failed";
  readonly output?: string;
  readonly defaultExpanded?: boolean;
};

export type AssistantBlock = AssistantTextBlock | ReasoningSummaryBlock | ToolCallBlock;

type UserTranscriptMessage = {
  readonly kind: "user";
  readonly id: string;
  readonly text: string;
};

type AssistantTranscriptMessage = {
  readonly kind: "assistant";
  readonly id: string;
  readonly blocks: readonly AssistantBlock[];
  readonly state: "streaming" | "complete" | "failed";
};

export type TranscriptMessage = UserTranscriptMessage | AssistantTranscriptMessage;
