export default {
  extends: ["stylelint-config-standard"],
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
        },
      },
    },
    {
      files: ["apps/desktop/src/renderer/components/**/*.css"],
      rules: {
        // Focus selectors may express local state, but ring geometry belongs to
        // renderer/styles/focus.css so every control follows the same roles.
        "property-disallowed-list": ["/^outline(?:-.+)?$/"],
        "rule-selector-property-disallowed-list": {
          "/:(?:focus|focus-visible|focus-within)\\b/": ["box-shadow"],
        },
      },
    },
    {
      files: ["apps/desktop/src/renderer/styles/foundations.css"],
      rules: {
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
