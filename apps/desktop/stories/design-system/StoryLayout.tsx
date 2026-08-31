/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- Scrollable catalog pages need keyboard focus. */

import type { JSX } from "solid-js";

import "./design-system.css";

export function CatalogPage(props: {
  readonly title: string;
  readonly intro: string;
  readonly children: JSX.Element;
}) {
  return (
    <main class="design-system-page" tabindex="0">
      <div class="design-system-shell">
        <header class="design-system-header">
          <p class="design-system-kicker">Review catalog</p>
          <h1 class="design-system-title">{props.title}</h1>
          <p class="design-system-intro">{props.intro}</p>
        </header>
        <div class="design-system-family-grid">{props.children}</div>
      </div>
    </main>
  );
}

export function CatalogCard(props: {
  readonly title: string;
  readonly description?: string;
  readonly class?: string;
  readonly children: JSX.Element;
}) {
  return (
    <section class={`design-system-family-card ${props.class ?? ""}`.trim()}>
      <header class="design-system-card-header">
        <h2 class="design-system-card-title">{props.title}</h2>
        {props.description ? <p class="design-system-caption">{props.description}</p> : null}
      </header>
      {props.children}
    </section>
  );
}
