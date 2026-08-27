import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vite-plus/test";

import { ConnectionForm } from "./ConnectionForm.tsx";

describe("ConnectionForm", () => {
  it("offers a built-in server action for returning from remote setup", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const onUseBuiltInServer = vi.fn<() => void>();
    const dispose = render(
      () => (
        <ConnectionForm
          serverUrl="http://homie:4096"
          password=""
          busy={false}
          hasSavedConnection={false}
          onServerUrlInput={() => undefined}
          onPasswordInput={() => undefined}
          onConnect={() => undefined}
          onUseBuiltInServer={onUseBuiltInServer}
          onForget={() => undefined}
        />
      ),
      host,
    );

    const button = [...host.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === "Use built-in server",
    );
    expect(button).toBeDefined();
    button?.click();
    expect(onUseBuiltInServer).toHaveBeenCalledOnce();

    dispose();
    host.remove();
  });
});
