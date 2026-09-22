/**
 * Whether a web permission is the one deliberate exception to the session's
 * default-deny policy: clipboard access from the trusted main renderer. The
 * transcript copy controls need the write path, and Electron checks the read
 * permission even for writes; everything else — every other permission, frame,
 * and window — stays denied.
 */
export function allowsClipboardAccess(input: {
  readonly permission: string;
  readonly isMainWindow: boolean;
  readonly isMainFrame: boolean;
  readonly isTrustedUrl: boolean;
}): boolean {
  return (
    (input.permission === "clipboard-read" || input.permission === "clipboard-sanitized-write") &&
    input.isMainWindow &&
    input.isMainFrame &&
    input.isTrustedUrl
  );
}
