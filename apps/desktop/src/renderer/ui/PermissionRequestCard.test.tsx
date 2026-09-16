import type { PermissionReply, PermissionRequest } from "@opencode/client";
import { describe, expect, it, vi } from "vite-plus/test";

import { mount } from "../test/mount.ts";
import { PermissionRequestCard } from "./PermissionRequestCard.tsx";

const request = (
  save: readonly string[] | undefined = ["src/**", "package.json"],
): PermissionRequest => ({
  id: "per_build",
  sessionID: "ses_oc_ui",
  action: "read files",
  resources: ["/workspace/src/permission.ts", "/workspace/package.json"],
  save: save ? [...save] : undefined,
  message: "The agent needs these files to verify the change.",
  source: { type: "tool", messageID: "msg_123", id: "tool_456" },
  metadata: { privateHint: "not for display" },
});

describe("PermissionRequestCard", () => {
  it("renders the reviewed request fields as text and hides arbitrary metadata", () => {
    const unsafe = {
      ...request(),
      message: '<img src=x onerror="alert(1)">',
    } satisfies PermissionRequest;
    const mounted = mount(() => (
      <PermissionRequestCard request={unsafe} onReply={() => undefined} />
    ));

    expect(mounted.host.querySelector("h2")?.textContent).toBe("read files");
    expect(mounted.host.textContent).toContain("/workspace/src/permission.ts");
    expect(mounted.host.textContent).toContain("tool_456");
    expect(mounted.host.textContent).toContain("src/**");
    expect(mounted.host.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(mounted.host.querySelector("img")).toBeNull();
    expect(mounted.host.textContent).not.toContain("privateHint");
    expect(mounted.host.textContent).not.toContain("msg_123");
    mounted.dispose();
  });

  it("maps each explicit action to the upstream reply without replying on Escape", () => {
    const onReply = vi.fn<(reply: PermissionReply) => void>();
    const mounted = mount(() => <PermissionRequestCard request={request()} onReply={onReply} />);

    const buttons = [...mounted.host.querySelectorAll<HTMLButtonElement>("button")];
    buttons.find((button) => button.textContent === "Reject all")?.click();
    buttons.find((button) => button.textContent === "Allow once")?.click();
    buttons.find((button) => button.textContent === "Always allow")?.click();
    mounted.host.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(onReply.mock.calls).toEqual([["reject"], ["once"], ["always"]]);
    mounted.dispose();
  });

  it("omits persistent approval when no nonempty save patterns are supplied", () => {
    const mounted = mount(() => (
      <PermissionRequestCard request={request([""])} onReply={() => undefined} />
    ));

    expect(
      [...mounted.host.querySelectorAll("button")].map((button) => button.textContent),
    ).toEqual(["Reject all", "Allow once"]);
    expect(mounted.host.querySelector("[data-permission-save-patterns]")).toBeNull();
    mounted.dispose();
  });

  it("suppresses persistent approval rather than changing mixed server patterns", () => {
    const mounted = mount(() => (
      <PermissionRequestCard request={request(["src/**", ""])} onReply={() => undefined} />
    ));

    expect(
      [...mounted.host.querySelectorAll("button")].map((button) => button.textContent),
    ).toEqual(["Reject all", "Allow once"]);
    expect(mounted.host.textContent).not.toContain("src/**");
    mounted.dispose();
  });

  it("disables every reply while unavailable or submitting and keeps a mutation error visible", () => {
    const mounted = mount(() => (
      <PermissionRequestCard
        request={request()}
        submitting
        error="The permission response could not be sent. Try again."
        onReply={() => undefined}
      />
    ));

    expect(
      [...mounted.host.querySelectorAll<HTMLButtonElement>("button")].every(
        (button) => button.disabled,
      ),
    ).toBe(true);
    expect(mounted.host.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(mounted.host.querySelector('[role="alert"]')?.textContent).toContain(
      "could not be sent",
    );
    mounted.dispose();
  });
});
