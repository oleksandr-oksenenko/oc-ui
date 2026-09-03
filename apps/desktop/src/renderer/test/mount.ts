import type { JSX } from "solid-js";
import { render } from "solid-js/web";

export function mount(view: () => JSX.Element) {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(view, host);
  return {
    host,
    dispose: () => {
      dispose();
      host.remove();
    },
  };
}
