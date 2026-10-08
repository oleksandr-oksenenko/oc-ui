import { isAbsolute, resolve } from "node:path";

/** The runner selects owned locations; environment values only confirm that selection. */
export function runnerPath(value: string | undefined, expectedPath: string): string {
  if (value === undefined || !isAbsolute(value) || resolve(value) !== resolve(expectedPath)) {
    throw new Error("Packaged runner path does not match its owned location");
  }
  return resolve(expectedPath);
}
