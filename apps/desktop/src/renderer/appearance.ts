import { Context, Effect, Schema } from "effect";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";

const ThemeSchema = Schema.Literals(["light", "dim", "dark"]);
export type Theme = typeof ThemeSchema.Type;
const parseTheme = Schema.decodeUnknownSync(ThemeSchema);
const storageKey = "ocui.theme.v1";

/** First run follows the desktop appearance; `dim` is the everyday dark. */
const systemTheme = (): Theme => {
  // SAFETY: Browsers expose matchMedia; non-DOM hosts such as tests may omit
  // it, and this optional shape is the boundary the check reads.
  const media = (globalThis as { matchMedia?: (query: string) => MediaQueryList }).matchMedia;
  return media?.("(prefers-color-scheme: dark)").matches === true ? "dim" : "light";
};

/** Window-owned preference. Synchronous storage settles before each change returns. */
export const makeAppearance = Effect.fn("Appearance.make")(function* (
  registry: AtomRegistry.AtomRegistry,
) {
  const initial = yield* Effect.try(() => {
    const saved = localStorage.getItem(storageKey);
    return saved === null ? systemTheme() : parseTheme(saved);
  }).pipe(Effect.orElseSucceed(() => "light" as const));
  const state = Atom.make<{ readonly theme: Theme; readonly notice?: string }>({ theme: initial });
  const unmount = registry.mount(state);
  yield* Effect.addFinalizer(() => Effect.sync(unmount));

  const setTheme = Effect.fn("Appearance.setTheme")(function* (theme: Theme) {
    registry.set(state, { theme });
    yield* Effect.try(() => localStorage.setItem(storageKey, theme)).pipe(
      Effect.catch(() =>
        Effect.sync(() =>
          registry.set(state, {
            theme,
            notice: "The theme changed, but could not be saved. Choose it again to retry.",
          }),
        ),
      ),
    );
  });
  return { state, setTheme };
});

export class Appearance extends Context.Service<
  Appearance,
  Effect.Success<ReturnType<typeof makeAppearance>>
>()("renderer/Appearance") {}
