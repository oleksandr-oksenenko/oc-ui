import type { SessionMessageAssistant } from "@opencode/client";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { ServerFileImageReader } from "../../../../../../opencode/file-images.ts";
import { mount } from "../../../../../../test/mount.ts";
import { AssistantMessage } from "./AssistantMessage.tsx";

const createObjectURLDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const revokeObjectURLDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");

function stubObjectURL(create: (blob: Blob) => string, revoke: (url: string) => void): void {
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: create,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: revoke,
  });
}

function restoreProperty(name: string, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) Object.defineProperty(URL, name, descriptor);
  else Reflect.deleteProperty(URL, name);
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const message: SessionMessageAssistant = {
  id: "assistant-file-image",
  time: { created: 1, completed: 2 },
  type: "assistant",
  agent: "build",
  model: { providerID: "openai", id: "gpt-5" },
  content: [{ type: "text", text: "![Tool states](file:///srv/project/tool-states.png)" }],
  finish: "stop",
};

describe("AssistantMessage", () => {
  afterEach(() => {
    restoreProperty("createObjectURL", createObjectURLDescriptor);
    restoreProperty("revokeObjectURL", revokeObjectURLDescriptor);
  });

  it("re-reads a mounted file image when the reader changes", async () => {
    const createObjectURL = vi.fn<(blob: Blob) => string>((blob) => `blob:${blob.type}`);
    const revokeObjectURL = vi.fn<(url: string) => void>();
    stubObjectURL(createObjectURL, revokeObjectURL);
    const first = vi.fn<ServerFileImageReader>(
      async () => new Blob([new Uint8Array([1])], { type: "first" }),
    );
    const second = vi.fn<ServerFileImageReader>(
      async () => new Blob([new Uint8Array([2])], { type: "second" }),
    );
    const [reader, setReader] = createSignal<ServerFileImageReader>(first);

    const { host, dispose } = mount(() => (
      <AssistantMessage message={message} sessionStatus="idle" readFileImage={reader()} />
    ));
    try {
      await settle();
      expect(host.querySelector("img")?.getAttribute("src")).toBe("blob:first");

      setReader(() => second);
      await settle();
      expect(second).toHaveBeenCalledTimes(1);
      expect(host.querySelector("img")?.getAttribute("src")).toBe("blob:second");
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:first");
    } finally {
      dispose();
    }
  });
});
