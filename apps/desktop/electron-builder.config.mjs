// oxlint-disable-next-line effecttsgo/process-env -- electron-builder reads its signing environment.
const configuredIdentity = globalThis.process.env.CSC_NAME?.trim() || undefined;

export default {
  appId: "net.oksenenko.ocui",
  productName: "Ocui",
  directories: {
    output: "dist",
  },
  files: ["out/**/*"],
  asar: true,
  extraResources: [
    {
      from: ".packaging/opencode/opencode2",
      to: "opencode/opencode2",
    },
  ],
  dmg: {
    writeUpdateInfo: false,
  },
  mac: {
    binaries: ["Contents/Resources/opencode/opencode2"],
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
