import { serverFilePathFromFileUrl, serverPathResolve } from "./serverPath.ts";

/** Classify the source target before browser URL resolution or sanitization. */
export function transcriptLinkKind(href: string): "web" | "fragment" | "file" | "unsupported" {
  const value = href.trim();
  if (/^(https?:|\/\/)/i.test(value)) return "web";
  if (value.startsWith("#")) return "fragment";
  // Marked percent-encodes backslashes in Markdown destinations.
  if (/^[a-zA-Z]:(?:[\\/]|%5c|%2f)/i.test(value) || /^file:/i.test(value)) return "file";
  if (value === "" || /^[a-z][a-z\d+.-]*:/i.test(value)) return "unsupported";
  return "file";
}

/** URI path references are relative to the session, not the renderer document. */
export function transcriptFilePath(href: string, directory: string): string | undefined {
  const value = href.trim();
  if (transcriptLinkKind(value) !== "file") return undefined;
  if (value.split("#", 1)[0]!.includes("?")) return undefined;
  if (/^file:/i.test(value)) {
    const path = serverFilePathFromFileUrl(value);
    return path === undefined ? undefined : serverPathResolve(directory, path);
  }
  let path: string;
  try {
    path = decodeURIComponent(value.split(/[?#]/, 1)[0]!);
  } catch {
    return undefined;
  }
  if (path.includes("\0")) return undefined;
  return serverPathResolve(directory, path);
}
