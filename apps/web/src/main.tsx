import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Effect } from "effect";

import { App } from "./App.tsx";
import "./styles.css";

const root = Effect.runSync(Effect.fromNullishOr(document.querySelector<HTMLDivElement>("#root")));

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
