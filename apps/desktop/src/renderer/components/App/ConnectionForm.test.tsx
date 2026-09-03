import { describe, expect, it, vi } from "vite-plus/test";

import { mount } from "../../test/mount.ts";
import { ConnectionForm } from "./ConnectionForm.tsx";

describe("ConnectionForm", () => {
  it("presents built-in and remote as explicit connection choices", () => {
    const onModeChange = vi.fn<(mode: "local" | "remote") => void>();
    const onUseBuiltInServer = vi.fn<() => void>();
    const { host, dispose } = mount(() => (
      <ConnectionForm
        mode="local"
        serverUrl="http://homie:4096"
        password=""
        busy={false}
        onModeChange={onModeChange}
        onServerUrlInput={() => undefined}
        onPasswordInput={() => undefined}
        onConnect={() => undefined}
        onUseBuiltInServer={onUseBuiltInServer}
        onForget={() => undefined}
      />
    ));

    expect(host.textContent).toContain("Built-in");
    expect(host.textContent).toContain("Remote");
    expect(host.querySelectorAll("input")).toHaveLength(2);
    const remote = host.querySelector<HTMLInputElement>('input[type="radio"][value="remote"]');
    remote?.click();
    expect(onModeChange).toHaveBeenCalledWith("remote");

    const button = [...host.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === "Start built-in server",
    );
    expect(button).toBeDefined();
    button?.click();
    expect(onUseBuiltInServer).toHaveBeenCalledOnce();

    dispose();
  });

  it("shows remote fields and the saved choice without exposing a saved password", () => {
    const onForget = vi.fn<() => void>();
    const { host, dispose } = mount(() => (
      <ConnectionForm
        mode="remote"
        serverUrl="http://homie:4096"
        password=""
        busy={false}
        savedTarget={{ kind: "remote", serverUrl: "http://homie:4096" }}
        onModeChange={() => undefined}
        onServerUrlInput={() => undefined}
        onPasswordInput={() => undefined}
        onConnect={() => undefined}
        onUseBuiltInServer={() => undefined}
        onForget={onForget}
      />
    ));

    expect(host.textContent).toContain("Saved choice");
    expect(host.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe("");
    const forget = [...host.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === "Forget saved choice",
    );
    forget?.click();
    expect(onForget).toHaveBeenCalledOnce();

    dispose();
  });
});
