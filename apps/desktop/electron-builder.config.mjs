// oxlint-disable-next-line effecttsgo/process-env -- electron-builder reads its signing environment.
const configuredIdentity = globalThis.process.env.CSC_NAME?.trim() || undefined;

export default {
  appId: "net.oksenenko.ocui",
  productName: "Ocui",
  directories: {
    output: "dist",
  },
  files: ["out/main/**/*", "out/preload/**/*", "out/renderer/**/*", "!node_modules/**/*"],
  asar: true,
  extraResources: [
    { from: "src/main/browser/upstream/LICENSE", to: "licenses/opencode-browser-LICENSE" },
    {
      from: "out/opencode-runtime/session-tools",
      to: "opencode-runtime/session-tools",
      filter: ["**/*"],
    },
    {
      from: "out/opencode-runtime/opencode-worker.mjs",
      to: "opencode-runtime/opencode-worker.mjs",
    },
    {
      // electron-builder skips a source root's node_modules directory; map the
      // package tree explicitly so native/WASM files and nested versions survive.
      from: "out/opencode-runtime/node_modules",
      to: "opencode-runtime/node_modules",
      filter: ["**/*"],
    },
  ],
  dmg: {
    writeUpdateInfo: false,
  },
  mac: {
    binaries: [
      "Contents/Resources/opencode-runtime/node_modules/@opencode-ai/pty-darwin-arm64/bin/opencode-pty",
      "Contents/Resources/opencode-runtime/node_modules/@lydell/node-pty-darwin-arm64/prebuilds/darwin-arm64/spawn-helper",
    ],
    category: "public.app-category.developer-tools",
    hardenedRuntime: false,
    identity: configuredIdentity ?? "-",
    notarize: false,
    timestamp: "none",
    target: [
      { target: "dir", arch: ["arm64"] },
      { target: "dmg", arch: ["arm64"] },
    ],
  },
};
