/**
 * Convert a `file:` URL from session content into a path on the connected
 * server. WHATWG parses every valid `file:` URL as absolute (including
 * `file:x`); other schemes, malformed escapes, and paths containing NUL return
 * undefined.
 *
 * The renderer never loads `file:` URLs itself; it resolves them through the
 * server's file contract because session files belong to the server, not to
 * the Electron host.
 */
export function serverFilePathFromFileUrl(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== "file:" || url.username !== "" || url.password !== "" || url.port !== "") {
    return undefined;
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return undefined;
  }
  if (pathname.includes("\0")) return undefined;
  if (url.hostname !== "") {
    // WHATWG folds `localhost` into the empty host; other hosts are UNC shares.
    return `//${url.hostname}${pathname}`;
  }
  // A Windows drive path survives WHATWG parsing as `/C:/...`; the server's
  // native path rules need the leading slash removed. A bare drive root
  // (`/C:`) needs its separator restored to stay absolute.
  if (/^\/[a-zA-Z]:[\\/]/.test(pathname)) return pathname.slice(1);
  if (/^\/[a-zA-Z]:$/.test(pathname)) return `${pathname.slice(1)}/`;
  return pathname;
}

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
