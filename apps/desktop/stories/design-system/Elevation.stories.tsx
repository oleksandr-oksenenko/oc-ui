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
    use: "Pending messages, question and permission cards.",
  },
  {
    token: "--oc-shadow-lift",
    label: "--oc-shadow-lift",
    use: "Composer shell: the one surface that leaves the canvas.",
  },
  {
    token: "--oc-shadow-floating",
    label: "--oc-shadow-floating",
    use: "Menus, dialogs, popovers, and the toast.",
  },
] as const;

function ElevationPage() {
  return (
    <CatalogPage
      title="Elevation"
      intro="Elevation is a role, not decoration: light-theme shadows grow by distance and spread rather than darker edges, every surface keeps its own 1px border, and no shadow draws a ring. Black cannot shade black, so the dark theme keeps only the floating recipe. Switch the toolbar theme to compare Light and Dark (AMOLED)."
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
        title="Dark theme"
        description="AMOLED keeps the border and the surface step for separation. Only overlays that cross text or images keep a shadow."
      >
        <p class="design-system-elevation-use">
          Card: none · Lift: none · Floating: 0 10px 28px rgb(0 0 0 / 55%)
        </p>
      </CatalogCard>
    </CatalogPage>
  );
}

export const Catalog: StoryObj = {
  render: () => <ElevationPage />,
};
