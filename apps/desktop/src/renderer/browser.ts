import { createBrowserHost } from "./browser-host.ts";
import { mountApp } from "./mount-app.tsx";

const dispose = mountApp(createBrowserHost());
window.addEventListener("pagehide", () => void dispose(), { once: true });
window.addEventListener("pageshow", (event) => {
  // A cached document has already disposed its renderer. Restore like a reload.
  if (event.persisted) window.location.reload();
});
