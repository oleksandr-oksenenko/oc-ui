import { Effect } from "effect";
import { AtomRegistry } from "effect/unstable/reactivity";
import { afterEach, expect, it, vi } from "vite-plus/test";

import { makeAppearance } from "./appearance.ts";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it("saves successive choices in order and restores the last choice in a new owner", () => {
  const registry = AtomRegistry.make();
  try {
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const appearance = yield* makeAppearance(registry);
          expect(registry.get(appearance.state).theme).toBe("light");
          yield* appearance.setTheme("dark");
          yield* appearance.setTheme("light");
          yield* appearance.setTheme("dark");
        }),
      ),
    );
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const restored = yield* makeAppearance(registry);
          expect(registry.get(restored.state)).toEqual({ theme: "dark" });
        }),
      ),
    );
  } finally {
    registry.dispose();
  }
});

it.each(["broken", "system", '"dark"'])("ignores invalid stored preference %s", (saved) => {
  localStorage.setItem("ocui.theme.v1", saved);
  const registry = AtomRegistry.make();
  try {
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const appearance = yield* makeAppearance(registry);
          expect(registry.get(appearance.state).theme).toBe("light");
        }),
      ),
    );
  } finally {
    registry.dispose();
  }
});

it("still changes theme when storage is unavailable and can retry after recovery", () => {
  const storage = vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
    throw new Error("Storage unavailable");
  });
  const registry = AtomRegistry.make();
  try {
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const appearance = yield* makeAppearance(registry);
          yield* appearance.setTheme("dark");
          expect(registry.get(appearance.state)).toEqual({
            theme: "dark",
            notice: expect.stringContaining("could not be saved"),
          });
          storage.mockRestore();
          yield* appearance.setTheme("dark");
          expect(registry.get(appearance.state)).toEqual({ theme: "dark" });
          expect(localStorage.getItem("ocui.theme.v1")).toBe("dark");
        }),
      ),
    );
  } finally {
    registry.dispose();
  }
});
