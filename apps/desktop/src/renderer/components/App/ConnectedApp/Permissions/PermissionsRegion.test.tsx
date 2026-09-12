import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { ServerFlowDialogProvider } from "../../../../ui/ServerFlowDialogProvider.tsx";
import { PermissionsRegion } from "./PermissionsRegion.tsx";
import { permissionsFixture, request, session } from "./permissions-test-fixture.ts";

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function mountRegion() {
  const fixture = permissionsFixture();
  const [connected, setConnected] = createSignal(true);
  const onOpenSession = vi.fn<(sessionID: string) => void>();
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(
    () => (
      <ServerFlowDialogProvider>
        <PermissionsRegion
          controller={fixture.value}
          connected={connected}
          onOpenSession={onOpenSession}
        />
      </ServerFlowDialogProvider>
    ),
    host,
  );
  return { fixture, connected, setConnected, onOpenSession, host, dispose };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("PermissionsRegion", () => {
  it("shows the workspace pending count and non-ready states without a false zero", () => {
    const mounted = mountRegion();
    const launcher = mounted.host.querySelector<HTMLButtonElement>("button");
    expect(launcher?.textContent).toContain("1");
    expect(launcher?.getAttribute("aria-label")).toBe("Permissions, 1 pending permission request");

    mounted.fixture.setEntries([]);
    mounted.fixture.setInboxState("loading");
    expect(launcher?.textContent).toContain("…");
    expect(launcher?.getAttribute("aria-label")).toContain("loading");

    mounted.fixture.setInboxState("failed");
    expect(launcher?.textContent).toContain("?");
    expect(launcher?.querySelector(".permissions-region-status.failed")).not.toBeNull();
    expect(launcher?.getAttribute("aria-label")).toContain("unavailable");

    mounted.setConnected(false);
    expect(launcher?.querySelector(".permissions-region-status.disconnected")).not.toBeNull();
    expect(launcher?.getAttribute("aria-label")).toContain("cached, disconnected");
    mounted.dispose();
  });

  it("refreshes both views on open and returns focus to its launcher on close", async () => {
    const mounted = mountRegion();
    const launcher = mounted.host.querySelector<HTMLButtonElement>("button")!;
    launcher.focus();
    launcher.click();
    await settle();
    expect(mounted.fixture.inboxSync).toHaveBeenCalledOnce();
    expect(mounted.fixture.savedSync).toHaveBeenCalledOnce();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();

    const close = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Close permissions dialog"]',
    );
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    close?.click();
    vi.advanceTimersByTime(110);
    await Promise.resolve();
    expect(document.body.querySelector("[data-dialog-layer]")).toBeNull();
    expect(document.activeElement).toBe(launcher);
    mounted.dispose();
  });

  it("closes before routing an enabled Open session action", async () => {
    const mounted = mountRegion();
    mounted.fixture.setEntries([
      { session: session({ id: "session-target", title: "Target" }), requests: [request()] },
    ]);
    mounted.host.querySelector<HTMLButtonElement>("button")?.click();
    await settle();
    document.body
      .querySelector<HTMLButtonElement>('button[aria-label="Open session Target"]')
      ?.click();
    await settle();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(mounted.onOpenSession).toHaveBeenCalledWith("session-target");
    mounted.dispose();
  });
});
