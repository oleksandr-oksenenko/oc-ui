import { Effect } from "effect";
import { render } from "solid-js/web";

import { App } from "./App.tsx";
import "@opencode-ai/ui/styles";
import "@opencode-ai/ui/styles/tokens";
import "./styles.css";

document.documentElement.dataset.platform = navigator.platform.toLowerCase().includes("mac")
  ? "macos"
  : "other";
document.documentElement.dataset.colorScheme = "dark";

const root = Effect.runSync(Effect.fromNullishOr(document.querySelector<HTMLDivElement>("#root")));

render(() => <App />, root);
