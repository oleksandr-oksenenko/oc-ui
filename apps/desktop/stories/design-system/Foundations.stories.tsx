/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- The scrollable catalog needs keyboard focus. */

import { For, onMount, Show, createSignal } from "solid-js";
import type { Meta } from "storybook-solidjs-vite";

import "./design-system.css";

type Token = {
  name: string;
  label: string;
  swatch?: boolean;
};

const tokenGroups: Array<{ title: string; tokens: Token[] }> = [
  {
    title: "Surfaces",
    tokens: [
      { name: "--oc-surface-canvas", label: "Application canvas", swatch: true },
      { name: "--oc-surface-subtle", label: "Subtle inset surface", swatch: true },
      { name: "--oc-surface-raised", label: "Raised surface", swatch: true },
      { name: "--oc-surface-control", label: "Control surface", swatch: true },
      { name: "--oc-surface-selected", label: "Selected surface", swatch: true },
      { name: "--oc-surface-hover", label: "Hover surface", swatch: true },
    ],
  },
  {
    title: "Borders",
    tokens: [
      { name: "--oc-border-muted", label: "Quiet divider", swatch: true },
      { name: "--oc-border-base", label: "Default border", swatch: true },
      { name: "--oc-border-strong", label: "Strong border", swatch: true },
      { name: "--oc-border-emphasis", label: "Emphasized border", swatch: true },
      { name: "--oc-focus-ring", label: "Keyboard focus", swatch: true },
    ],
  },
  {
    title: "Text and icons",
    tokens: [
      { name: "--oc-text-contrast", label: "Highest contrast text", swatch: true },
      { name: "--oc-text-strong", label: "Strong text", swatch: true },
      { name: "--oc-text-base", label: "Default text", swatch: true },
      { name: "--oc-text-muted", label: "Muted text", swatch: true },
      { name: "--oc-text-faint", label: "Faint text", swatch: true },
      { name: "--oc-icon-base", label: "Default icon", swatch: true },
    ],
  },
  {
    title: "Status and feedback",
    tokens: [
      { name: "--oc-status-info", label: "Information", swatch: true },
      { name: "--oc-status-success", label: "Success", swatch: true },
      { name: "--oc-status-warning", label: "Warning", swatch: true },
      { name: "--oc-status-danger", label: "Danger", swatch: true },
      { name: "--oc-status-danger-muted", label: "Muted danger", swatch: true },
      { name: "--oc-status-danger-border", label: "Danger border", swatch: true },
      { name: "--oc-diff-addition", label: "Diff addition", swatch: true },
      { name: "--oc-diff-deletion", label: "Diff deletion", swatch: true },
      { name: "--oc-selection", label: "Selection", swatch: true },
    ],
  },
];

const typeTokens = [
  ["Page title", "--oc-type-page-title-*", "design-system-type-page-title"],
  ["Heading", "--oc-type-heading-*", "design-system-type-heading"],
  ["Body", "--oc-type-body-*", "design-system-type-body"],
  ["Body relaxed", "--oc-type-body-relaxed-*", "design-system-type-body-relaxed"],
  ["Control", "--oc-type-control-*", "design-system-type-control"],
  ["Metadata", "--oc-type-metadata-*", "design-system-type-metadata"],
  ["Status", "--oc-type-status-*", "design-system-type-status"],
  ["Caption", "--oc-type-caption-*", "design-system-type-caption"],
  ["Tab", "--oc-type-tab-*", "design-system-type-tab"],
  ["Kicker", "--oc-type-kicker-*", "design-system-type-kicker"],
  ["Code", "--oc-type-code-*", "design-system-type-code"],
  ["Diff statistic", "--oc-type-diff-stat-*", "design-system-type-diff-stat"],
] as const;

const radiusToken = "--oc-radius";

const meta = {
  title: "Design System/Foundations",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

function TokenRow(props: { token: Token }) {
  const [value, setValue] = createSignal("reading token…");

  onMount(() => {
    setValue(
      getComputedStyle(document.documentElement).getPropertyValue(props.token.name).trim() ||
        "not defined",
    );
  });

  return (
    <div class="design-system-token">
      <Show
        when={props.token.swatch}
        fallback={
          <span
            class="design-system-token-swatch design-system-token-swatch-empty"
            aria-hidden="true"
          />
        }
      >
        <span
          class="design-system-token-swatch"
          style={{ "--ds-token": `var(${props.token.name})` }}
          aria-hidden="true"
        />
      </Show>
      <span class="design-system-token-name" title={props.token.label}>
        {props.token.name}
      </span>
      <span class="design-system-token-value">{value()}</span>
    </div>
  );
}

function FoundationsPage() {
  return (
    <main class="design-system-page" tabIndex={0}>
      <div class="design-system-shell">
        <header class="design-system-header">
          <p class="design-system-kicker">Review catalog</p>
          <h1 class="design-system-title">Foundations</h1>
          <p class="design-system-intro">
            The values below are read from the active dark/AMOLED document at runtime. This page is
            a compact reference for the tokens that shape oc-ui surfaces, hierarchy, feedback, and
            density.
          </p>
        </header>

        <section class="design-system-section" aria-labelledby="color-tokens-title">
          <h2 id="color-tokens-title" class="design-system-section-title">
            Color tokens
          </h2>
          <p class="design-system-section-description">
            Swatches use the token itself; the value column shows the resolved CSS custom property.
          </p>
          <div class="design-system-grid">
            <For each={tokenGroups}>
              {(group) => (
                <article class="design-system-card">
                  <h3 class="design-system-card-title">{group.title}</h3>
                  <div class="design-system-token-list">
                    <For each={group.tokens}>{(token) => <TokenRow token={token} />}</For>
                  </div>
                </article>
              )}
            </For>
          </div>
        </section>

        <section class="design-system-section" aria-labelledby="type-title">
          <h2 id="type-title" class="design-system-section-title">
            Typography
          </h2>
          <div class="design-system-grid">
            <article class="design-system-card">
              <h3 class="design-system-card-title">Type scale</h3>
              <div class="design-system-type-sample">
                <For each={typeTokens}>
                  {([label, token, className]) => (
                    <div class="design-system-type-row">
                      <span class={className}>{label}: OpenCode workspace</span>
                      <span class="design-system-type-label">{token}</span>
                    </div>
                  )}
                </For>
              </div>
            </article>
            <article class="design-system-card">
              <h3 class="design-system-card-title">Families and rhythm</h3>
              <div class="design-system-token-list design-system-family-list">
                <TokenRow token={{ name: "--oc-font-sans", label: "Product sans family" }} />
                <TokenRow token={{ name: "--oc-font-mono", label: "Product mono family" }} />
              </div>
            </article>
          </div>
        </section>

        <section class="design-system-section" aria-labelledby="density-title">
          <h2 id="density-title" class="design-system-section-title">
            Density
          </h2>
          <p class="design-system-section-description">
            The product uses one ordinary 4px radius token: <code>--oc-radius</code>. Spacing stays
            with the upstream component or the feature layout that owns it.
          </p>
          <div class="design-system-grid">
            <article class="design-system-card">
              <h3 class="design-system-card-title">Ownership rule</h3>
              <p class="design-system-caption">
                OpenCode primitives own their internal size and spacing. Feature styles own real
                product layout such as panel grids, transcript density, and dialog dimensions.
              </p>
            </article>
            <article class="design-system-card">
              <h3 class="design-system-card-title">Radius</h3>
              <div class="design-system-radius-list">
                <div class="design-system-measure">
                  <span class="design-system-measure-label">{radiusToken}</span>
                  <span
                    class="design-system-radius-box"
                    style={{ "border-radius": `var(${radiusToken}, 4px)` }}
                    aria-hidden="true"
                  />
                  <span class="design-system-measure-value">4px</span>
                </div>
              </div>
            </article>
          </div>
        </section>
      </div>
    </main>
  );
}

export const Catalog = {
  render: () => <FoundationsPage />,
};
