import { vi } from "vite-plus/test";

export function stubResizeObserver(): void {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
}
