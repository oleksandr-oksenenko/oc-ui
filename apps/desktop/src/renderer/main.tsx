import type { DesktopApi } from "../shared/desktop-api.ts";
import { mountApp } from "./mount-app.tsx";

// This module-local declaration does not expose the bridge to browser code.
declare const window: Window & { readonly desktop: DesktopApi };
const dispose = mountApp({ kind: "desktop", ...window.desktop });
window.addEventListener("pagehide", () => void dispose(), { once: true });
