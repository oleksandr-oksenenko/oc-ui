import { RegistryContext } from "@effect/atom-solid";
import { Effect } from "effect";
import { render } from "solid-js/web";

import type { AppHost } from "../shared/app-host.ts";
import { App } from "./App.tsx";
import { createRenderer } from "./connection.ts";
import "@opencode-ai/ui/styles";
import "@opencode-ai/ui/styles/tokens";
import "./styles.css";

export function mountApp(host: AppHost) {
  document.documentElement.dataset.host = host.kind;
  document.documentElement.dataset.platform = navigator.platform.toLowerCase().includes("mac")
    ? "macos"
    : "other";
  const root = Effect.runSync(
    Effect.fromNullishOr(document.querySelector<HTMLDivElement>("#root")),
  );
  const renderer = createRenderer(host);
  const disposeView = render(
    () => (
      <RegistryContext.Provider value={renderer.registry}>
        <App renderer={renderer} />
      </RegistryContext.Provider>
    ),
    root,
  );
  return () => {
    disposeView();
    return renderer.dispose();
  };
}
