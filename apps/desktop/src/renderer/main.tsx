import { Effect } from "effect";
import { render } from "solid-js/web";

import { App } from "./App.tsx";
import "@opencode-ai/ui/styles";
import "./styles.css";

const root = Effect.runSync(Effect.fromNullishOr(document.querySelector<HTMLDivElement>("#root")));

render(() => <App />, root);
