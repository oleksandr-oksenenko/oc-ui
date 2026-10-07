/* oxlint-disable effecttsgo/async-function */

import { describe, expect, it } from "vite-plus/test";
import { createBrowserAnnotationPrompt } from "../stories/BrowserAnnotationComposerFixture.tsx";

describe("browser annotation story transports", () => {
  it("keeps the first failure and call history independent when instances are interleaved", async () => {
    const first = createBrowserAnnotationPrompt();
    const second = createBrowserAnnotationPrompt();
    const firstInput = {
      sessionID: "first",
      id: "first-request",
      text: "First annotation",
      delivery: "steer",
    };
    const secondInput = {
      sessionID: "second",
      id: "second-request",
      text: "Second annotation",
      delivery: "steer",
    };

    await expect(first(firstInput)).rejects.toThrow("Fixture admission failure");
    expect(second).not.toHaveBeenCalled();
    await expect(second(secondInput)).rejects.toThrow("Fixture admission failure");
    expect(first).toHaveBeenCalledOnce();

    await expect(first(firstInput)).resolves.toMatchObject({
      sessionID: "first",
      payload: { text: firstInput.text },
    });
    expect(second).toHaveBeenCalledOnce();
    await expect(second(secondInput)).resolves.toMatchObject({
      sessionID: "second",
      payload: { text: secondInput.text },
    });
    expect(first.mock.calls.map(([input]) => input)).toEqual([firstInput, firstInput]);
    expect(second.mock.calls.map(([input]) => input)).toEqual([secondInput, secondInput]);
  });
});
