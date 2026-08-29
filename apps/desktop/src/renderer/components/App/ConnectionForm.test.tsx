import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vite-plus/test";

import { ConnectionForm } from "./ConnectionForm.tsx";

describe("ConnectionForm", () => {
  it("presents built-in and remote as explicit connection choices", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const onModeChange = vi.fn<(mode: "local" | "remote") => void>();
    const onUseBuiltInServer = vi.fn<() => void>();
    const dispose = render(
      () => (
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
      ),
      host,
    );

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
    host.remove();
  });

  it("shows remote fields and the saved choice without exposing a saved password", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const onForget = vi.fn<() => void>();
    const dispose = render(
      () => (
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
      ),
      host,
    );

    expect(host.textContent).toContain("Saved choice");
    expect(host.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe("");
    const forget = [...host.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === "Forget saved choice",
    );
    forget?.click();
    expect(onForget).toHaveBeenCalledOnce();

    dispose();
    host.remove();
  });
});
