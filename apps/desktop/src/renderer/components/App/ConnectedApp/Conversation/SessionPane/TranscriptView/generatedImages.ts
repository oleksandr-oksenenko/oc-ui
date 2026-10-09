import type { SessionMessageInfo, ToolContent } from "@opencode/client";

import { attachmentImageReferences } from "./AssistantMessage/Markdown/markdown.ts";

export type GeneratedImage = {
  readonly reference: string;
  readonly src?: string;
  readonly fullSrc?: string;
};

/** Inline bytes only: attachment references never read a host or server path. */
export function toolImageSource(content: ToolContent | undefined): string | undefined {
  if (content?.type !== "file") return undefined;
  if (
    content.mime.startsWith("image/") &&
    /^data:image\/(?:png|jpeg|webp|gif);base64,/.test(content.uri)
  )
    return content.uri;
  if (
    content.mime === "application/octet-stream" &&
    content.uri.startsWith("data:application/octet-stream;base64,iVBORw0KGgo")
  )
    return content.uri.replace("data:application/octet-stream;", "data:image/png;");
  return undefined;
}

type ProducedImage = GeneratedImage & {
  readonly messageIndex: number;
  readonly contentIndex: number;
  readonly turn: number;
};

/** The reserved transport name is the shared contract for projection and tool details. */
export function generatedImageAttachment(content: ToolContent | undefined) {
  if (content?.type !== "file") return undefined;
  const match = content.name?.match(/^(ocui-image-[A-Za-z0-9]{26})(\.original)?\.png$/);
  if (!match) return undefined;
  const role: "original" | "preview" = match[2] ? "original" : "preview";
  const supported =
    role === "original"
      ? content.mime === "application/octet-stream"
      : content.mime.startsWith("image/");
  return {
    reference: `attachment:${match[1]}`,
    role,
    src: supported ? toolImageSource(content) : undefined,
  };
}

/** Filenames preserve identity when normalization changes, removes, or reorders previews. */
function toolGeneratedImages(contents: readonly ToolContent[]) {
  const pairs = new Map<string, { preview?: string; original?: string; duplicate?: boolean }>();
  for (const content of contents) {
    const attachment = generatedImageAttachment(content);
    if (!attachment) continue;
    const { reference, role, src } = attachment;
    const pair = pairs.get(reference) ?? {};
    if (Object.hasOwn(pair, role)) pair.duplicate = true;
    pair[role] = src;
    pairs.set(reference, pair);
  }
  return pairs;
}

function indexGeneratedImages(messages: readonly SessionMessageInfo[]) {
  // An undefined entry means the identifier is ambiguous, not absent.
  const images = new Map<string, ProducedImage | undefined>();
  const fallback = new Map<string, GeneratedImage[]>();
  const positions = new Map<string, { index: number; turn: number }>();
  let turn = 0;
  for (const [messageIndex, message] of messages.entries()) {
    if (message.type === "user" || message.type === "idle" || message.type === "system") turn++;
    positions.set(message.id, { index: messageIndex, turn });
    if (message.type !== "assistant") continue;
    for (const [contentIndex, part] of message.content.entries()) {
      if (
        part.type !== "tool" ||
        (part.state.status !== "completed" && part.state.status !== "error")
      )
        continue;
      for (const [reference, pair] of toolGeneratedImages(part.state.content ?? [])) {
        const image: ProducedImage = {
          reference,
          src: pair.preview ?? pair.original,
          fullSrc: pair.original ?? pair.preview,
          messageIndex,
          contentIndex,
          turn,
        };
        images.set(reference, images.has(reference) || pair.duplicate ? undefined : image);
        const list = fallback.get(message.id) ?? [];
        list.push(image);
        fallback.set(message.id, list);
      }
    }
  }
  return { images, fallback, positions };
}

/** Derived from all loaded SDK messages, independently of mounted transcript rows. */
export function projectGeneratedImages(messages: readonly SessionMessageInfo[]) {
  const { images, fallback, positions } = indexGeneratedImages(messages);
  const resolve = (
    messageID: string,
    contentIndex: number,
    reference: string,
  ): ProducedImage | undefined => {
    const image = images.get(reference);
    const position = positions.get(messageID);
    if (!image || !position) return undefined;
    return image.messageIndex < position.index ||
      (image.messageIndex === position.index && image.contentIndex < contentIndex)
      ? image
      : undefined;
  };
  const consumed = new Set<string>();
  for (const message of messages) {
    if (message.type !== "assistant") continue;
    for (const [index, content] of message.content.entries()) {
      if (content.type !== "text") continue;
      for (const reference of attachmentImageReferences(content.text)) {
        const image = resolve(message.id, index, reference);
        if (image?.src && image.turn === positions.get(message.id)?.turn) consumed.add(reference);
      }
    }
  }
  for (const [messageID, list] of fallback) {
    const remaining = list
      .filter((image) => !consumed.has(image.reference))
      .map((image) => (images.get(image.reference) ? image : { reference: image.reference }));
    if (remaining.length) fallback.set(messageID, remaining);
    else fallback.delete(messageID);
  }
  return { resolve, fallback };
}
