// @vitest-environment node
import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { runnerPath } from "./e2e/runner-path.ts";

const root = join(import.meta.dirname, "owned-profile");
const artifacts = join(root, "artifacts");

it("uses the owned path while accepting equivalent absolute runner paths", () => {
  expect(runnerPath(artifacts, artifacts)).toBe(artifacts);
  expect(runnerPath(`${root}/app/../artifacts`, artifacts)).toBe(artifacts);
});

it.each([
  undefined,
  "",
  "artifacts",
  join(root, "artifacts-other"),
  join(root, "artifacts", "nested"),
  `${artifacts}/../../outside`,
])("rejects runner path redirection: %s", (value) => {
  expect(() => runnerPath(value, artifacts)).toThrow("owned location");
});
