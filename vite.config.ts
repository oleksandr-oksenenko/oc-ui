import { defineConfig } from "vite-plus";

const jsxA11yRules = {
  "jsx-a11y/alt-text": "error",
  "jsx-a11y/anchor-has-content": "error",
  "jsx-a11y/anchor-is-valid": "error",
  "jsx-a11y/aria-props": "error",
  "jsx-a11y/aria-proptypes": "error",
  "jsx-a11y/aria-role": "error",
  "jsx-a11y/aria-unsupported-elements": "error",
  "jsx-a11y/click-events-have-key-events": "error",
  "jsx-a11y/heading-has-content": "error",
  "jsx-a11y/interactive-supports-focus": "error",
  // The rule currently recognizes React's `htmlFor` but not Solid's typed `for` attribute.
  "jsx-a11y/label-has-associated-control": "off",
  "jsx-a11y/no-access-key": "error",
  "jsx-a11y/no-autofocus": "error",
  "jsx-a11y/no-distracting-elements": "error",
  "jsx-a11y/no-noninteractive-element-interactions": "error",
  "jsx-a11y/no-noninteractive-tabindex": "error",
  "jsx-a11y/no-redundant-roles": "error",
  "jsx-a11y/no-static-element-interactions": "error",
  // Native equivalents do not cover focusable, value-bearing resize separators.
  "jsx-a11y/prefer-tag-over-role": "off",
  "jsx-a11y/role-has-required-aria-props": "error",
  "jsx-a11y/tabindex-no-positive": "error",
} as const;

export default defineConfig({
  defaultPackage: "./apps/desktop",
  fmt: {},
  lint: {
    plugins: ["unicorn", "typescript", "oxc", "import", "promise"],
    categories: {
      correctness: "error",
      suspicious: "error",
    },
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: {
      "eslint/no-underscore-dangle": "off",
      "typescript/no-unsafe-type-assertion": "off",
      "react/react-in-jsx-scope": "off",
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    options: {
      denyWarnings: true,
      typeAware: true,
      typeCheck: true,
    },
    overrides: [
      {
        files: ["apps/desktop/src/renderer/**/*.tsx"],
        rules: {
          "import/no-unassigned-import": "off",
        },
      },
      {
        files: [
          "apps/desktop/src/renderer/App.tsx",
          "apps/desktop/src/renderer/components/**/*.tsx",
        ],
        plugins: ["unicorn", "typescript", "oxc", "import", "promise", "react", "jsx-a11y"],
        rules: {
          ...jsxA11yRules,
          "import/no-unassigned-import": "off",
          "react/immutability": "off",
          "react/no-multi-comp": "error",
          "react/react-in-jsx-scope": "off",
          "unicorn/filename-case": ["error", { case: "pascalCase" }],
        },
      },
      {
        files: [
          "apps/desktop/.storybook/**/*.ts",
          "apps/desktop/stories/**/*.tsx",
          "apps/desktop/.storybook/**/*.tsx",
        ],
        plugins: ["unicorn", "typescript", "oxc", "import", "promise", "react", "jsx-a11y"],
        rules: {
          ...jsxA11yRules,
          "import/no-unassigned-import": "off",
          "react/immutability": "off",
          "react/no-multi-comp": "off",
          "react/react-in-jsx-scope": "off",
          "unicorn/filename-case": "off",
        },
      },
      {
        files: ["apps/desktop/src/**/*.test.ts", "apps/desktop/src/**/*.test.tsx"],
        plugins: ["unicorn", "typescript", "oxc", "import", "promise", "vitest"],
        rules: {
          "import/no-unassigned-import": "off",
          "react/immutability": "off",
          "react/no-multi-comp": "off",
          "react/react-in-jsx-scope": "off",
          "unicorn/filename-case": "off",
        },
      },
      {
        files: ["apps/desktop/src/main/**/*.ts", "apps/desktop/src/preload/**/*.ts"],
        plugins: ["unicorn", "typescript", "oxc", "import", "promise", "node"],
      },
    ],
  },
  run: {
    cache: true,
  },
});
