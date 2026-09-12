// Product roles plus local layout inputs and the component contracts we use.
// Upstream design tokens belong only in foundations and its selector adapter.
export const appCustomPropertyPattern =
  /^(?:oc-[a-z0-9-]+|shell-(?:left-sidebar|right-panel)-width|permissions-dialog-max-height|ds-token|kb-popper-anchor-width|checkbox-(?:align|offset))$/;

export const appDesignRules = {
  "no-unknown-custom-properties": true,
  "declaration-no-important": true,
  "property-disallowed-list": ["/^scrollbar-/"],
  "selector-disallowed-list": ["/::?-webkit-scrollbar/", "/\\.sr-only\\b/"],
  "custom-property-pattern": appCustomPropertyPattern,
  "color-no-hex": true,
  "color-named": "never",
  "function-disallowed-list": [
    /^(?:color|color-contrast|color-mix|contrast-color|device-cmyk|gray|hsl|hsla|hwb|lab|lch|light-dark|oklab|oklch|rgb|rgba)$/i,
  ],
  // Foundations owns concrete design values. Product and story styles
  // consume radius and absolute type-size values through CSS variables.
  "declaration-property-unit-allowed-list": {
    "/(?:^|-)radius$/": [],
    "font-size": [],
  },
  "declaration-property-value-allowed-list": {
    "font-family": [/^var\(.+\)$/, /^(?:inherit|initial|unset|revert|revert-layer)$/],
    "font-weight": [/^var\(.+\)$/, /^(?:inherit|normal|initial|unset|revert|revert-layer)$/],
  },
};

export default {
  extends: ["stylelint-config-standard"],
  referenceFiles: ["apps/desktop/src/renderer/styles/foundations.css"],
  ignoreFiles: ["**/out/**", "**/dist/**", "**/dist-web/**", "**/storybook-static/**"],
  reportDescriptionlessDisables: true,
  reportNeedlessDisables: true,
  rules: {
    "selector-class-pattern": "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:--[a-z0-9]+(?:-[a-z0-9]+)*)?$",
  },
  overrides: [
    {
      files: ["apps/**/*.css"],
      rules: {
        ...appDesignRules,
      },
    },
    {
      files: ["apps/desktop/src/renderer/styles/scrollbars.css"],
      rules: {
        "property-disallowed-list": null,
        "selector-disallowed-list": ["/\\.sr-only\\b/"],
      },
    },
    {
      files: ["apps/desktop/src/renderer/styles/focus.css"],
      rules: {
        // The shared focus policy must win over pinned upstream state selectors.
        "declaration-no-important": null,
      },
    },
    {
      files: [
        "apps/desktop/src/renderer/components/**/*.css",
        "apps/desktop/src/renderer/ui/**/*.css",
      ],
      rules: {
        // Focus selectors may express local state, but ring geometry belongs to
        // renderer/styles/focus.css so every control follows the same roles.
        "property-disallowed-list": ["/^outline(?:-.+)?$/", "/^scrollbar-/"],
        "rule-selector-property-disallowed-list": {
          "/:(?:focus|focus-visible|focus-within)\\b/": ["box-shadow"],
        },
      },
    },
    {
      files: ["apps/desktop/src/renderer/styles/opencode-overrides.css"],
      rules: {
        // This adapter sets upstream component tokens in their product context.
        "custom-property-pattern": null,
      },
    },
    {
      files: ["apps/desktop/src/renderer/styles/foundations.css"],
      rules: {
        "custom-property-pattern": null,
        "color-no-hex": null,
        "color-named": null,
        "declaration-property-unit-allowed-list": null,
        "declaration-property-value-allowed-list": null,
        "function-disallowed-list": null,
      },
    },
    {
      files: [
        "apps/desktop/src/renderer/components/App/ConnectedApp/Conversation/SessionPane/SessionPane.css",
      ],
      rules: {
        // Markdown headings and inline code scale with their 14px prose
        // container. Keep that relationship local; other font sizes use tokens.
        "declaration-property-unit-allowed-list": {
          "/(?:^|-)radius$/": [],
          "font-size": ["em"],
        },
      },
    },
  ],
};
