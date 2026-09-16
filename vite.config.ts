import { recommended as effectRecommended } from "@effect/tsgo/oxlint-presets";
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

// These areas deliberately use framework or host APIs rather than modeling their
// entire lifecycle as Effect programs. Effect correctness rules still apply.
const effectPromiseBoundaryRules = {
  "effecttsgo/async-function": "off",
  "effecttsgo/extends-native-error": "off",
  "effecttsgo/global-fetch": "off",
  "effecttsgo/global-timers": "off",
  "effecttsgo/new-promise": "off",
} as const;

const effectNodeBoundaryRules = {
  "effecttsgo/async-function": "off",
  "effecttsgo/node-builtin-import": "off",
  "effecttsgo/process-env": "off",
} as const;

export default defineConfig({
  defaultPackage: "./apps/desktop",
  fmt: {
    ignorePatterns: ["tools/oxlint/anti-slop/**"],
  },
  lint: {
    extends: [effectRecommended],
    // Vendored native backend retains upstream structure. It remains typechecked,
    // built and exercised by native acceptance; house-style diagnostics apply to our adapters.
    ignorePatterns: ["tools/oxlint/anti-slop/**", "apps/desktop/src/main/browser/upstream/**"],
    plugins: ["unicorn", "typescript", "oxc", "import", "promise"],
    categories: {
      correctness: "error",
      suspicious: "error",
    },
    jsPlugins: [
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
      { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
      {
        name: "anti-slop-effect",
        specifier: "./tools/oxlint/anti-slop/effect/index.ts",
      },
    ],
    rules: {
      "anti-slop-effect/no-service-constructor-imports": "error",
      "anti-slop/no-chained-type-assertions": "error",
      "anti-slop/no-conditional-empty-object-spread": "error",
      "anti-slop/no-known-value-widening": "error",
      "anti-slop/no-module-mocking": "error",
      "anti-slop/no-object-parameters": "error",
      "anti-slop/no-reflect-apply": "error",
      "anti-slop/no-reflect-get": "error",
      "anti-slop/no-runtime-typeof": "error",
      "anti-slop/no-shape-in-symbol-names": "error",
      "anti-slop/no-unknown-parameters": "error",
      "anti-slop/no-unknown-returns": "error",
      "anti-slop/no-unknown-type-aliases": "error",
      "anti-slop/no-unsafe-dictionary-type": "error",
      "anti-slop/no-widen-then-assert": "error",
      "anti-slop/require-safety-comment-for-type-assertion": "error",
      "eslint/complexity": ["error", { max: 20 }],
      "eslint/no-underscore-dangle": "off",
      "import/no-unassigned-import": [
        "error",
        {
          allow: ["**/*.css", "@opencode/ui/styles", "@opencode/ui/styles/tokens"],
        },
      ],
      "typescript/no-unsafe-type-assertion": "error",
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
        files: [
          "apps/desktop/src/renderer/connection.ts",
          "apps/desktop/src/renderer/test/workspace.ts",
          "apps/desktop/stories/transcript-annotations/TranscriptAnnotations.tsx",
          "apps/desktop/stories/AddProjectDialog.stories.tsx",
        ],
        rules: { "anti-slop-effect/no-service-constructor-imports": "off" },
      },
      {
        files: ["apps/desktop/src/renderer/test/**/*.ts"],
        rules: effectPromiseBoundaryRules,
      },
      {
        // The SDK requires a fetch callback; preserve HTTP status at that boundary.
        files: ["apps/desktop/src/renderer/opencode/connection.ts"],
        rules: {
          "effecttsgo/async-function": "off",
          "effecttsgo/extends-native-error": "off",
          "effecttsgo/global-fetch": "off",
        },
      },
      {
        files: ["apps/desktop/src/renderer/ui/restoreDialogFocusAfterClose.ts"],
        rules: { "effecttsgo/global-timers": "off" },
      },
      {
        // DOM hashing and focus updates await browser APIs or already-owned actions.
        files: [
          "apps/desktop/src/renderer/components/App/ConnectedApp/Conversation/createAnnotationHighlights.ts",
          "apps/desktop/src/renderer/components/App/ConnectedApp/Conversation/createTranscriptAnnotations.ts",
          "apps/desktop/src/renderer/components/App/ConnectedApp/GlobalForms/ReviewDialog.tsx",
        ],
        rules: { "effecttsgo/async-function": "off" },
      },
      {
        files: [
          "apps/desktop/src/renderer/App.tsx",
          "apps/desktop/src/renderer/components/**/*.tsx",
        ],
        plugins: ["unicorn", "typescript", "oxc", "import", "promise", "react", "jsx-a11y"],
        rules: {
          ...jsxA11yRules,
          "react/immutability": "off",
          // Solid tracks list identity through <For>; React's key model does not apply.
          "react/jsx-key": "off",
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
          ...effectPromiseBoundaryRules,
          "effecttsgo/node-builtin-import": "off",
          "effecttsgo/strict-effect-provide": "off",
          "react/immutability": "off",
          "react/no-multi-comp": "off",
          "react/react-in-jsx-scope": "off",
          "unicorn/filename-case": "off",
        },
      },
      {
        files: ["apps/desktop/src/main/**/*.ts", "apps/desktop/src/preload/**/*.ts"],
        plugins: ["unicorn", "typescript", "oxc", "import", "promise", "node"],
        rules: effectNodeBoundaryRules,
      },
      {
        files: ["apps/desktop/electron.vite.config.ts", "packages/opencode-session-tools/build.ts"],
        rules: effectNodeBoundaryRules,
      },
      {
        files: [
          "apps/desktop/wdio.conf.ts",
          "apps/desktop/test/e2e/**/*.{ts,mjs}",
          "apps/desktop/test/browser-inspection.test.mjs",
          "apps/desktop/test/style-tokens.test.mjs",
        ],
        rules: {
          ...effectPromiseBoundaryRules,
          ...effectNodeBoundaryRules,
          "effecttsgo/global-console": "off",
          "effecttsgo/global-date": "off",
        },
      },
      {
        files: ["tools/**/*.mjs"],
        rules: {
          "effecttsgo/global-console": "off",
          "effecttsgo/node-builtin-import": "off",
        },
      },
    ],
  },
  run: {
    cache: true,
  },
});
