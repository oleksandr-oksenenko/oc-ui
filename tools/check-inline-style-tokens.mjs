/* oxlint-disable effecttsgo/async-function -- Build-time CLI awaits Stylelint and filesystem traversal without an application runtime. */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "@typescript/typescript6";
import stylelint from "stylelint";

import { appCustomPropertyPattern, appDesignRules } from "../stylelint.config.mjs";

// Stylelint checks CSS files. Apply the same vocabulary to var() references in
// inline styles and injected CSS strings, including nested fallback references.
async function check(file) {
  if (statSync(file).isDirectory()) {
    for (const child of readdirSync(file)) await check(path.join(file, child));
    return;
  }
  if (!/\.tsx?$/.test(file)) return;
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/\bvar\(\s*--([\w-]+)/g)) {
    if (appCustomPropertyPattern.test(match[1])) continue;
    const line = source.slice(0, match.index).split("\n").length;
    console.error(`${file}:${line}: Use an --oc-* foundation token instead of --${match[1]}.`);
    process.exitCode = 1;
  }

  // Parse literals instead of matching JavaScript source: test expectations and
  // ordinary text can contain colors without defining a style.
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const snippets = [];
  const visit = (node) => {
    if (ts.isPropertyAssignment(node)) {
      const name = node.name.text?.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      const value = node.initializer;
      if (
        /^(?:color|scrollbar-[a-z-]+|background(?:-color|-image)?|border(?:-.+)?|font(?:-.+)?|line-height|letter-spacing|box-shadow|outline(?:-.+)?)$/.test(
          name,
        ) &&
        (ts.isStringLiteralLike(value) || ts.isNumericLiteral(value))
      ) {
        snippets.push({ node, css: `a { ${name}: ${value.text}; }` });
      }
    }
    const parent = node.parent;
    const injected =
      parent &&
      ((ts.isPropertyAssignment(parent) && parent.name.text === "unsafeCSS") ||
        (ts.isVariableDeclaration(parent) && /css$/i.test(parent.name.text)) ||
        (ts.isBinaryExpression(parent) &&
          ts.isPropertyAccessExpression(parent.left) &&
          parent.left.name.text === "textContent" &&
          /style/i.test(parent.left.expression.getText(tree))));
    if (injected && (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node))) {
      const css = ts.isTemplateExpression(node)
        ? node.head.text + node.templateSpans.map((span) => `dynamic${span.literal.text}`).join("")
        : node.text;
      if (/\{\s*(?:--[\w-]+|[a-z-]+)\s*:/.test(css)) snippets.push({ node, css });
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  for (const { node, css } of snippets) {
    const result = await stylelint.lint({
      code: css,
      config: {
        referenceFiles: [
          fileURLToPath(
            new URL("../apps/desktop/src/renderer/styles/foundations.css", import.meta.url),
          ),
        ],
        rules: {
          ...appDesignRules,
          // The existing reference check enforces the app vocabulary. Injected
          // shadow styles also declare the diff renderer's public inputs.
          "custom-property-pattern": null,
          "declaration-property-unit-allowed-list": {
            ...appDesignRules["declaration-property-unit-allowed-list"],
            "--diffs-font-size": [],
            "--diffs-line-height": [],
          },
        },
      },
    });
    for (const warning of result.results[0].warnings) {
      const line = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
      console.error(`${file}:${line}: ${warning.text}`);
      process.exitCode = 1;
    }
  }
}

const targets = process.argv.slice(2);
for (const target of targets.length
  ? targets
  : ["apps/desktop/src/renderer", "apps/desktop/stories"]) {
  await check(target);
}
