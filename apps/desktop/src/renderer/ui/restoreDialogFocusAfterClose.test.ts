import { afterEach, expect, it, vi } from "vite-plus/test";

import { restoreDialogFocusAfterClose } from "./restoreDialogFocusAfterClose.ts";

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

it("skips target lookup when the owner is disposed during the closing animation", () => {
  vi.useFakeTimers();
  let disposed = false;
  const target = vi.fn<() => HTMLElement | undefined>(
    () => document.querySelector<HTMLElement>("button") ?? undefined,
  );
  restoreDialogFocusAfterClose(target, () => !disposed);
  disposed = true;

  vi.runAllTimers();

  expect(target).not.toHaveBeenCalled();
});

it("restores a connected opener after the closing animation", () => {
  vi.useFakeTimers();
  const opener = document.createElement("button");
  document.body.append(opener);
  restoreDialogFocusAfterClose(() => opener);

  expect(document.activeElement).not.toBe(opener);
  vi.runAllTimers();

  expect(document.activeElement).toBe(opener);
});
