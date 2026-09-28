import type { SessionMessageUser } from "@opencode/client";
import { Browser } from "@opencode/plugin-browser/rpc";
import { createSessionPrompt } from "../src/renderer/opencode/session-prompt.ts";
import { formatBrowserAnnotations } from "../src/renderer/components/App/ConnectedApp/Browser/browser-annotations.ts";
import { previewImageBase64, previewImageMime } from "./image-fixtures.ts";

export const reviewComments = [
  {
    path: "apps/desktop/src/renderer/components/Composer.tsx",
    body: "Keep the draft when sending fails, so I can retry without losing my changes.",
    selection: { start: 74, end: 76 },
    selectedCode: "await send(prompt);\nclearDraft();",
  },
  {
    path: "apps/desktop/src/renderer/components/Workspace.tsx",
    body: "This work should belong to the session.\nKeep it when I switch conversations.",
    selection: { start: 18, side: "deletions" as const, end: 20, endSide: "additions" as const },
    selectedCode: "const local = createSignal(false);\nconst open = props.open;",
  },
];

export const annotations = [
  {
    id: "annotation-retry",
    source: {
      messageID: "earlier-response",
      block: "text:0",
      textDigest: "a".repeat(64),
      start: 0,
      end: 54,
    },
    quote: "The draft is cleared as soon as the request is submitted.",
    body: "Can we clear it only after the server confirms receipt?",
  },
];

export const browserAnnotation = {
  id: "browser-annotation-1",
  number: 1,
  mode: "element" as const,
  tab: {
    id: Browser.TabID.make("tab_00000000-0000-4000-8000-000000000001"),
    url: "http://localhost:3000/pricing",
    title: "Pricing",
    loading: false,
    canGoBack: false,
    canGoForward: false,
    generation: 1,
  },
  capturedAt: "2026-09-26T10:00:00.000Z",
  selection: {
    frameUrl: "http://localhost:3000/pricing",
    selector: "main > button.primary",
    tag: "button",
    text: "Choose Pro",
    role: "button",
    label: "Choose Pro",
    bounds: { x: 120, y: 240, width: 160, height: 42 },
    topFrame: true,
  },
  image: {
    name: "annotation-1.png",
    mime: previewImageMime,
    data: Uint8Array.from(atob(previewImageBase64), (value) => value.charCodeAt(0)),
  },
  body: "Give this button more breathing room.",
};

export const files: NonNullable<SessionMessageUser["files"]> = [
  {
    name: "composer-reference.png",
    mime: previewImageMime,
    data: previewImageBase64,
    source: { type: "inline" },
  },
  {
    name: "release-notes.md",
    mime: "text/markdown",
    data: btoa("# Release notes\n\nPreserve drafts when a request fails."),
    source: { type: "inline" },
  },
  {
    name: "pasted-text.txt",
    mime: "text/plain",
    data: btoa("A longer pasted note becomes a text attachment."),
    source: { type: "inline" },
  },
  { name: "requirements.pdf", mime: "application/pdf", data: "", source: { type: "inline" } },
];

export const attachmentMessage: SessionMessageUser = {
  id: "attachment-proposal",
  type: "user",
  time: { created: 0 },
  ...createSessionPrompt({
    instruction: "Please address this feedback and use the attached reference.",
    reviewComments,
    annotations,
  }),
  files,
  skills: [{ id: "review-skill", name: "review" }],
  agents: [{ name: "explore" }],
};

export const browserMessage: SessionMessageUser = {
  id: "browser-attachments-current",
  type: "user",
  time: { created: 0 },
  text: formatBrowserAnnotations([browserAnnotation]),
  files: [{ ...files[0]!, name: browserAnnotation.image.name }],
};

export const inlineSkillMessage: SessionMessageUser = {
  id: "inline-skill-current",
  type: "user",
  time: { created: 0 },
  text: "Use review to check the changes.",
  skills: [{ id: "review-skill", name: "review", mention: { start: 4, end: 10, text: "review" } }],
};

/** File objects for the real composer's controlled attachment input. */
export function attachmentFiles(): File[] {
  return files.map(
    (file) =>
      new File(
        [Uint8Array.from(atob(file.data), (value) => value.charCodeAt(0))],
        file.name ?? "attachment",
        { type: file.mime },
      ),
  );
}
