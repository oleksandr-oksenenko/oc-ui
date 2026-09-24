import { For } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { CatalogCard, CatalogPage } from "./StoryLayout";

const meta = {
  title: "Design System/Elevation",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

const roles = [
  {
    token: "none",
    label: "no shadow",
    use: "Flat baseline. The border carries the edge on its own.",
  },
  {
    token: "--oc-shadow-card",
    label: "--oc-shadow-card",
    use: "Diff files, pending messages, question and permission cards.",
  },
  {
    token: "--oc-shadow-lift",
    label: "--oc-shadow-lift",
    use: "Composer shell: the one surface that leaves the canvas.",
  },
  {
    token: "--oc-shadow-floating",
    label: "--oc-shadow-floating",
    use: "Menus, dialogs, and the selection popover.",
  },
  {
    token: "--oc-shadow-popover",
    label: "--oc-shadow-popover",
    use: "Composer pickers and prompt editor menus.",
  },
] as const;

function ElevationPage() {
  return (
    <CatalogPage
      title="Elevation"
      intro="Elevation is a role, not decoration: content cards sit on a soft contact shadow, the composer lifts off the canvas, and overlays reuse the two existing recipes. Switch the toolbar theme to compare light, dim, and AMOLED."
    >
      <CatalogCard
        title="Roles"
        description="Each sample is a canvas surface with one role applied; the values follow the active theme."
      >
        <div class="design-system-elevation-grid">
          <For each={roles}>
            {(role) => (
              <figure class="design-system-elevation-item">
                <span
                  class="design-system-elevation-sample"
                  style={{ "box-shadow": role.token === "none" ? "none" : `var(${role.token})` }}
                />
                <figcaption class="design-system-elevation-label">{role.label}</figcaption>
                <span class="design-system-elevation-use">{role.use}</span>
              </figure>
            )}
          </For>
        </div>
      </CatalogCard>

      <CatalogCard
        title="Primary action"
        description="The filled send action keeps a small contact shadow; disabled and stop states opt out."
      >
        <div class="design-system-elevation-actions">
          <figure class="design-system-elevation-item">
            <span class="design-system-elevation-action design-system-elevation-action-raised" />
            <figcaption class="design-system-elevation-label">--oc-shadow-action</figcaption>
          </figure>
          <figure class="design-system-elevation-item">
            <span class="design-system-elevation-action" />
            <figcaption class="design-system-elevation-label">none</figcaption>
          </figure>
        </div>
      </CatalogCard>
    </CatalogPage>
  );
}

export const Catalog: StoryObj = {
  render: () => <ElevationPage />,
};
