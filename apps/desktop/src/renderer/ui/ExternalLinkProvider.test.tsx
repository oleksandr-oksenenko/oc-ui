import { describe, expect, it, vi } from "vite-plus/test";

import { mount } from "../test/mount.ts";
import { ExternalLinkProvider } from "./ExternalLinkProvider.tsx";

const activate = (target: Element, type: "click" | "auxclick", init: MouseEventInit = {}) =>
  target.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init }),
  );

const preventDefault = (event: MouseEvent) => event.preventDefault();

describe("ExternalLinkProvider", () => {
  it("opens absolute web links and leaves relative, fragment, and unsafe targets alone", () => {
    const open = vi.fn<(url: string) => void>();
    const { host, dispose } = mount(() => (
      <ExternalLinkProvider open={open}>
        <a id="web" href="HTTPS://Example.test/dir/file?q=1#intro">
          <span id="web-child">web</span>
        </a>
        <a id="same-origin" href={`${window.location.origin}/in-app`}>
          same origin
        </a>
        <a id="fragment" href="#section">
          fragment
        </a>
        <a id="relative" href="/in-app">
          relative
        </a>
        <a id="unsafe" href="javascript:alert(1)">
          unsafe
        </a>
      </ExternalLinkProvider>
    ));
    // Registered after the provider, so it reads the provider's decision before
    // silencing the document navigation that jsdom cannot perform.
    const prevented: boolean[] = [];
    const observe = (event: MouseEvent) => {
      prevented.push(event.defaultPrevented);
      event.preventDefault();
    };
    document.addEventListener("click", observe);
    document.addEventListener("auxclick", observe);
    try {
      activate(host.querySelector("#web")!, "click");
      expect(open).toHaveBeenLastCalledWith("https://example.test/dir/file?q=1#intro");

      // A descendant of the anchor is still a link activation.
      activate(host.querySelector("#web-child")!, "click");
      expect(open).toHaveBeenCalledTimes(2);

      // An absolute link to this document's own origin is still external.
      activate(host.querySelector("#same-origin")!, "click");
      expect(open).toHaveBeenLastCalledWith(`${window.location.origin}/in-app`);

      // Middle-click opens externally too.
      activate(host.querySelector("#web")!, "auxclick", { button: 1 });
      expect(open).toHaveBeenCalledTimes(4);

      // Document targets are not handled and are not prevented by the provider.
      activate(host.querySelector("#fragment")!, "click");
      activate(host.querySelector("#relative")!, "click");
      activate(host.querySelector("#unsafe")!, "click");
      expect(open).toHaveBeenCalledTimes(4);
      expect(prevented).toEqual([true, true, true, true, false, false, false]);
    } finally {
      document.removeEventListener("click", observe);
      document.removeEventListener("auxclick", observe);
      dispose();
    }
  });

  it("ignores already-handled clicks and stops listening after disposal", () => {
    const open = vi.fn<(url: string) => void>();
    const external = document.createElement("a");
    external.href = "https://example.test/docs";
    document.body.append(external);
    const { dispose } = mount(() => <ExternalLinkProvider open={open} />);
    document.addEventListener("click", preventDefault);
    try {
      // A target listener that already handled the activation wins.
      external.addEventListener("click", preventDefault);
      activate(external, "click");
      expect(open).not.toHaveBeenCalled();
      external.removeEventListener("click", preventDefault);

      activate(external, "click");
      expect(open).toHaveBeenCalledTimes(1);

      dispose();
      activate(external, "click");
      expect(open).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener("click", preventDefault);
      external.remove();
      dispose();
    }
  });
});
