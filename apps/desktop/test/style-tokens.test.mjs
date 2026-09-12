// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";
it("rejects both upstream token families in feature CSS but allows the adapters", () => {
  const code = "a {\n  color: var(--v2-text-text-base);\n  border-color: var(--border-base);\n}\n";
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const lint = (file) =>
    spawnSync(
      process.execPath,
      [
        path.join(root, "node_modules/stylelint/bin/stylelint.mjs"),
        "--stdin",
        "--stdin-filename",
        path.join(root, file),
        "--formatter",
        "json",
      ],
      { cwd: root, input: code, encoding: "utf8" },
    );
  const feature = lint("apps/desktop/src/renderer/ui/Example.css");
  expect(feature.status).toBe(2);
  expect(
    JSON.parse(feature.stderr)[0].warnings.filter((w) => w.rule === "custom-property-pattern"),
  ).toHaveLength(2);
  for (const name of ["foundations", "opencode-overrides"]) {
    const adapter = lint(`apps/desktop/src/renderer/styles/${name}.css`);
    expect(adapter.status, adapter.stdout || adapter.stderr).toBe(0);
  }
});

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

it("checks nested fallbacks in injected styles while allowing app tokens and upstream selectors", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ocui-style-tokens-"));
  const file = path.join(directory, "example.tsx");
  const checker = fileURLToPath(
    new URL("../../../tools/check-inline-style-tokens.mjs", import.meta.url),
  );
  const run = () => spawnSync(process.execPath, [checker, file], { encoding: "utf8" });
  try {
    writeFileSync(
      file,
      'const css = `[data-component="button-v2"] { color: var(--oc-text-base); }`;',
    );
    expect(run().status).toBe(0);
    writeFileSync(
      file,
      "const css = `a { color: var(--oc-text-base, var(--text-base)); background: var(--v2-background-bg-base); }`;",
    );
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--text-base");
    expect(result.stderr).toContain("--v2-background-bg-base");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("checks literal inline and injected design values without linting displayed code or assertions", () => {
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
    for (const source of [
      'const frame = { background: "#050506" };',
      'const view = <div style={{ fontSize: "12px" }} />;',
      'const frame = { "border-radius": "4px" };',
      'const frame = { color: "var(--oc-unknown-test-token)" };',
      'const frame = { color: "var(--oc-text-base) !important" };',
      'const frame = { scrollbarWidth: "thin" };',
      "const css = `.sr-only { position: absolute; }`;",
      "const options = { unsafeCSS: `:host { --diffs-font-size: 12px; }` };",
      "style.textContent = `::highlight(${name}) { color: rgb(1 2 3); }`;",
    ]) {
      const result = run(source);
      expect(result.status, result.stderr).toBe(1);
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
});

it("enforces shared CSS ownership and token references while allowing the owning files", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const lint = (code, file = "apps/desktop/src/renderer/ui/Example.css") => {
    const result = spawnSync(
      process.execPath,
      [
        path.join(root, "node_modules/stylelint/bin/stylelint.mjs"),
        "--stdin",
        "--stdin-filename",
        path.join(root, file),
        "--formatter",
        "json",
      ],
      { cwd: root, input: code, encoding: "utf8" },
    );
    return JSON.parse(result.stderr)[0].warnings.map((warning) => warning.rule);
  };
  expect(lint("a { color: var(--oc-unknown-test-token); }")).toContain(
    "no-unknown-custom-properties",
  );
  expect(lint("a { color: var(--oc-text-base); }")).not.toContain("no-unknown-custom-properties");
  expect(lint("a { margin: 0 !important; }")).toContain("declaration-no-important");
  expect(
    lint("a { margin: 0 !important; }", "apps/desktop/src/renderer/styles/focus.css"),
  ).not.toContain("declaration-no-important");
  const scrollbar = "a::-webkit-scrollbar { scrollbar-width: thin; }";
  for (const file of [
    "apps/desktop/src/renderer/ui/Example.css",
    "apps/desktop/stories/Example.css",
  ]) {
    expect(lint(scrollbar, file)).toEqual(
      expect.arrayContaining(["property-disallowed-list", "selector-disallowed-list"]),
    );
    expect(lint(".sr-only { position: absolute; }", file)).toContain("selector-disallowed-list");
  }
  expect(lint(scrollbar, "apps/desktop/src/renderer/styles/scrollbars.css")).toEqual([]);
});
