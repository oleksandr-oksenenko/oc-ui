import { ipcRenderer } from "electron";
import { BROWSER_ANNOTATOR_CHANNEL } from "../shared/browser-annotator-protocol.ts";
import type {
  BrowserAnnotatorMessage,
  BrowserAnnotatorReply,
} from "../shared/browser-annotator.ts";
import { createAnnotatorCard } from "./browser-annotator-card.ts";

/**
 * Wires the in-page comment card to main. It runs in the tab's isolated world;
 * the card draws into a closed shadow root, and replies are bounded by the
 * shared schema in main. The page can still observe the card's node and the key
 * events that pass through it, so comments are user-visible data, not secret
 * input.
 *
 * This file deliberately avoids the Effect runtime and the browser tool RPC
 * package: it runs on every page, so it imports only the channel constant, the
 * message types (erased at build), and the card. Messages from main are
 * trusted; only main can send on this channel.
 */

const IN_PAGE_ONLY = window.top === window;

const card = createAnnotatorCard((reply: BrowserAnnotatorReply) => {
  if (IN_PAGE_ONLY) ipcRenderer.send(BROWSER_ANNOTATOR_CHANNEL, reply);
});

ipcRenderer.on(
  BROWSER_ANNOTATOR_CHANNEL,
  (_event: Electron.IpcRendererEvent, message: BrowserAnnotatorMessage) => {
    if (!IN_PAGE_ONLY) return;
    if (message._tag === "open") card.open(message);
    else card.close();
  },
);
