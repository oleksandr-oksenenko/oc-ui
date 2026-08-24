import { useAtom } from "@effect/atom-react";
import { Effect } from "effect";
import { Atom } from "effect/unstable/reactivity";

const message = Effect.runSync(Effect.succeed("oc-ui is ready"));
const countAtom = Atom.make(0);

export function App() {
  const [count, setCount] = useAtom(countAtom);

  return (
    <main>
      <p className="eyebrow">OpenCode UI</p>
      <h1>{message}</h1>
      <p>React, Effect, and the OpenCode 2 client are installed.</p>
      <button type="button" onClick={() => setCount((current) => current + 1)}>
        Effect atom count: {count}
      </button>
    </main>
  );
}
