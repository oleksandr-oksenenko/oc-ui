import { isAbsolute, join } from "node:path";

export const USER_DATA_PATH_ARGUMENT_PREFIX = "--ocui-user-data-path=";

export const resolveSessionDataPath = (userDataPath: string): string =>
  join(userDataPath, "Session Data");

export const resolveUserDataPath = (
  defaultUserDataPath: string,
  args: readonly string[],
): string => {
  const overrides = args
    .filter((argument) => argument.startsWith(USER_DATA_PATH_ARGUMENT_PREFIX))
    .map((argument) => argument.slice(USER_DATA_PATH_ARGUMENT_PREFIX.length));

  if (overrides.length > 1) {
    throw new Error("Duplicate --ocui-user-data-path arguments are not allowed");
  }

  const override = overrides[0];
  if (override === undefined) {
    return defaultUserDataPath;
  }
  if (override.length === 0) {
    throw new Error("--ocui-user-data-path requires a nonempty absolute path");
  }
  if (!isAbsolute(override)) {
    throw new Error(`--ocui-user-data-path must be an absolute path: ${override}`);
  }

  return override;
};
