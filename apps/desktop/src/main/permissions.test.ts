import { describe, expect, it } from "vite-plus/test";

import { allowsClipboardAccess } from "./permissions.ts";

const trustedRead = {
  permission: "clipboard-read",
  isMainWindow: true,
  isMainFrame: true,
  isTrustedUrl: true,
} as const;

describe("allowsClipboardAccess", () => {
  it("allows clipboard reads and writes from the trusted main frame", () => {
    expect(allowsClipboardAccess(trustedRead)).toBe(true);
    expect(allowsClipboardAccess({ ...trustedRead, permission: "clipboard-sanitized-write" })).toBe(
      true,
    );
  });

  it("denies every other permission", () => {
    expect(allowsClipboardAccess({ ...trustedRead, permission: "media" })).toBe(false);
    expect(allowsClipboardAccess({ ...trustedRead, permission: "notifications" })).toBe(false);
    expect(allowsClipboardAccess({ ...trustedRead, permission: "geolocation" })).toBe(false);
  });

  it("denies other windows and subframes", () => {
    expect(allowsClipboardAccess({ ...trustedRead, isMainWindow: false })).toBe(false);
    expect(allowsClipboardAccess({ ...trustedRead, isMainFrame: false })).toBe(false);
  });

  it("denies untrusted or missing URLs", () => {
    expect(allowsClipboardAccess({ ...trustedRead, isTrustedUrl: false })).toBe(false);
  });
});
