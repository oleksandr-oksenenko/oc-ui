export function serverPathChild(directory: string, relativeEntry: string): string {
  const separator = serverPathSeparator(directory);
  const base = nativeSeparators(trimTrailingSeparators(directory), separator);
  const child = nativeSeparators(trimSeparators(relativeEntry), separator);
  if (child === "") return base;
  if (base === "" || base.endsWith(separator)) return `${base}${child}`;
  return `${base}${separator}${child}`;
}

export function serverPathParent(directory: string): string {
  const separator = serverPathSeparator(directory);
  const normalized = directory.replaceAll("\\", "/");
  const root = serverPathRoot(normalized);
  const trimmed = trimTrailingSeparators(normalized);
  if (trimmed === "" || trimmed === root) return directory;

  const index = trimmed.lastIndexOf("/");
  if (index < root.length) return nativeSeparators(root, separator);
  const parent = index <= 0 ? "/" : trimmed.slice(0, index);
  return nativeSeparators(parent, separator);
}

function serverPathSeparator(directory: string): "/" | "\\" {
  if (directory.startsWith("/")) return "/";
  return directory.includes("\\") ? "\\" : "/";
}

function serverPathRoot(directory: string): string {
  if (directory.startsWith("//")) {
    const [server, share] = directory.slice(2).split("/");
    return server && share ? `//${server}/${share}` : "//";
  }
  if (directory.startsWith("/")) return "/";
  if (isWindowsDriveRoot(directory)) return directory.slice(0, 3);
  return "";
}

function isWindowsDriveRoot(directory: string): boolean {
  const letter = directory.charAt(0).toLowerCase();
  return (
    directory.length >= 3 &&
    letter >= "a" &&
    letter <= "z" &&
    directory.charAt(1) === ":" &&
    directory.charAt(2) === "/"
  );
}

function trimSeparators(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
}

function trimTrailingSeparators(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  const root = serverPathRoot(normalized);
  if (normalized === root) return normalized;
  return normalized.replace(/\/+$/g, "");
}

function nativeSeparators(value: string, separator: "/" | "\\"): string {
  return separator === "\\" ? value.replaceAll("/", "\\") : value;
}
