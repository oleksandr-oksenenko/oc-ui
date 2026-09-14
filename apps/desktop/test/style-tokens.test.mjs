// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";

// Vitest inlines node_modules, so the Vite pipeline transforms stylelint's
// module graph on every run. Loading it natively skips that transform while
// keeping stylelint.lint behavior identical.
const nativeRequire = createRequire(import.meta.url);
const stylelint = nativeRequire("stylelint");

it(
  "rejects both upstream token families in feature CSS but allows the adapters",
  { timeout: 30_000 },
  async () => {
    const code =
      "a {\n  color: var(--v2-text-text-base);\n  border-color: var(--border-base);\n}\n";
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const feature = await stylelint.lint({
      code,
      codeFilename: path.join(root, "apps/desktop/src/renderer/ui/Example.css"),
      cwd: root,
    });
    expect(
      feature.results[0].warnings.filter((w) => w.rule === "custom-property-pattern"),
    ).toHaveLength(2);
    expect(feature.errored).toBe(true);
    for (const name of ["foundations", "opencode-overrides"]) {
      const adapter = await stylelint.lint({
        code,
        codeFilename: path.join(root, `apps/desktop/src/renderer/styles/${name}.css`),
        cwd: root,
      });
      expect(adapter.results[0].warnings).toEqual([]);
    }
  },
);

it("resolves every app token used by component, story, and injected styles", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const foundation = readFileSync(path.join(root, "src/renderer/styles/foundations.css"), "utf8");
  const tokens = new Set([...foundation.matchAll(/(--oc-[\w-]+)\s*:/g)].map((match) => match[1]));
  const unresolved = [];
  for (const directory of ["src/renderer", "stories"]) {
    for (const file of readdirSync(path.join(root, directory), {
      recursive: true,
      encoding: "utf8",
    })) {
      if (!/\.(?:css|tsx?)$/.test(file)) continue;
      const source = readFileSync(path.join(root, directory, file), "utf8");
      for (const match of source.matchAll(/\bvar\(\s*(--oc-[\w-]+)/g)) {
        if (!tokens.has(match[1])) unresolved.push(`${directory}/${file}: ${match[1]}`);
      }
    }
  }
  expect(unresolved).toEqual([]);
});

it(
  "checks nested fallbacks in injected styles while allowing app tokens and upstream selectors",
  { timeout: 30_000 },
  () => {
    const directory = mkdtempSync(path.join(tmpdir(), "ocui-style-tokens-"));
    const allowed = path.join(directory, "allowed.tsx");
    const invalid = path.join(directory, "invalid.tsx");
    const checker = fileURLToPath(
      new URL("../../../tools/check-inline-style-tokens.mjs", import.meta.url),
    );
    try {
      writeFileSync(
        allowed,
        'const css = `[data-component="button-v2"] { color: var(--oc-text-base); }`;',
      );
      writeFileSync(
        invalid,
        "const css = `a { color: var(--oc-text-base, var(--text-base)); background: var(--v2-background-bg-base); }`;",
      );
      const result = spawnSync(process.execPath, [checker, allowed, invalid], {
        encoding: "utf8",
      });
      expect(result.status).toBe(1);
      expect(result.stderr).not.toContain(`${allowed}:`);
      expect(result.stderr).toContain("--text-base");
      expect(result.stderr).toContain("--v2-background-bg-base");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

it(
  "checks literal inline and injected design values without linting displayed code or assertions",
  { timeout: 30_000 },
  () => {
    const directory = mkdtempSync(path.join(tmpdir(), "ocui-style-values-"));
    const file = path.join(directory, "example.tsx");
    const checker = fileURLToPath(
      new URL("../../../tools/check-inline-style-tokens.mjs", import.meta.url),
    );
    const run = (source) => {
      writeFileSync(file, source);
      return spawnSync(process.execPath, [checker, file], { encoding: "utf8" });
    };
    try {
      const cases = [
        ['const frame = { background: "#050506" };', "color-no-hex"],
        [
          'const view = <div style={{ fontSize: "12px" }} />;',
          "declaration-property-unit-allowed-list",
        ],
        ['const frame = { "border-radius": "4px" };', "declaration-property-unit-allowed-list"],
        [
          'const frame = { color: "var(--oc-unknown-test-token)" };',
          "no-unknown-custom-properties",
        ],
        ['const frame = { color: "var(--oc-text-base) !important" };', "declaration-no-important"],
        ['const frame = { scrollbarWidth: "thin" };', "property-disallowed-list"],
        ["const css = `.sr-only { position: absolute; }`;", "selector-disallowed-list"],
        [
          "const options = { unsafeCSS: `:host { --diffs-font-size: 12px; }` };",
          "declaration-property-unit-allowed-list",
        ],
        [
          "style.textContent = `::highlight(${name}) { color: rgb(1 2 3); }`;",
          "function-disallowed-list",
        ],
      ];
      const files = cases.map(([source], index) => {
        const target = path.join(directory, `invalid-${index}.tsx`);
        writeFileSync(target, source);
        return target;
      });
      const result = spawnSync(process.execPath, [checker, ...files], { encoding: "utf8" });
      expect(result.status, result.stderr).toBe(1);
      for (const [index, [, rule]] of cases.entries()) {
        const diagnostics = result.stderr
          .split("\n")
          .filter((line) => line.startsWith(`${files[index]}:`));
        expect(diagnostics.join("\n"), files[index]).toContain(rule);
      }
      const allowed = run(`
      const frame = { background: "var(--oc-surface-canvas)", width: "390px" };
      const view = <div style={{ "font-size": "var(--oc-type-body-size)" }} />;
      const code = "function example() { color: '#fff' }";
      expect(color).toBe("rgb(104, 104, 104)");
      const options = { unsafeCSS: ":host { --diffs-font-size: var(--oc-type-code-size); }" };
    `);
      expect(allowed.status, allowed.stderr).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

it(
  "enforces shared CSS ownership and token references while allowing the owning files",
  { timeout: 30_000 },
  async () => {
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const lint = async (code, file = "apps/desktop/src/renderer/ui/Example.css") => {
      const result = await stylelint.lint({
        code,
        codeFilename: path.join(root, file),
        cwd: root,
      });
      return result.results[0].warnings.map((warning) => warning.rule);
    };
    expect(await lint("a { color: var(--oc-unknown-test-token); }")).toContain(
      "no-unknown-custom-properties",
    );
    expect(await lint("a { color: var(--oc-text-base); }")).not.toContain(
      "no-unknown-custom-properties",
    );
    expect(await lint("a { margin: 0 !important; }")).toContain("declaration-no-important");
    expect(
      await lint("a { margin: 0 !important; }", "apps/desktop/src/renderer/styles/focus.css"),
    ).not.toContain("declaration-no-important");
    const scrollbar = "a::-webkit-scrollbar { scrollbar-width: thin; }";
    for (const file of [
      "apps/desktop/src/renderer/ui/Example.css",
      "apps/desktop/stories/Example.css",
    ]) {
      expect(await lint(scrollbar, file)).toEqual(
        expect.arrayContaining(["property-disallowed-list", "selector-disallowed-list"]),
      );
      expect(await lint(".sr-only { position: absolute; }", file)).toContain(
        "selector-disallowed-list",
      );
    }
    expect(await lint(scrollbar, "apps/desktop/src/renderer/styles/scrollbars.css")).toEqual([]);
  },
);
