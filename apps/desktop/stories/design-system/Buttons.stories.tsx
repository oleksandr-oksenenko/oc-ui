import type { Meta } from "storybook-solidjs-vite";

import { Button } from "@opencode-ai/ui/button";

import { CatalogCard, CatalogPage } from "./StoryLayout";

const meta = {
  title: "Design System/Buttons",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

function ButtonsPage() {
  return (
    <CatalogPage
      title="Buttons"
      intro="Text actions use one normal size from the pinned OpenCode Button primitive. Their role decides the visual hierarchy."
    >
      <CatalogCard
        title="Role hierarchy"
        description="Use one role per action, independent of its label."
      >
        <div class="design-system-stack">
          <div class="design-system-example-row">
            <Button size="normal" variant="contrast">
              Create session
            </Button>
            <span class="design-system-example-label">Primary action</span>
          </div>
          <div class="design-system-example-row">
            <Button size="normal" variant="outline">
              Retry
            </Button>
            <span class="design-system-example-label">Inline or panel recovery</span>
          </div>
          <div class="design-system-example-row">
            <Button size="normal" variant="danger">
              Delete session
            </Button>
            <span class="design-system-example-label">Destructive confirmation</span>
          </div>
        </div>
      </CatalogCard>

      <CatalogCard
        title="Default size"
        description="Normal is the canonical size for text actions, including forms, dialogs, and recovery."
      >
        <div class="design-system-control-row design-system-align-end">
          <Button size="normal" variant="outline">
            Add project
          </Button>
          <Button size="normal" variant="outline">
            Retry connection
          </Button>
          <Button size="normal" variant="contrast">
            Connect
          </Button>
        </div>
      </CatalogCard>

      <CatalogCard
        title="States"
        description="Loading keeps the action width stable and disabled prevents a false affordance."
      >
        <div class="design-system-control-row">
          <Button size="normal" variant="contrast">
            Ready
          </Button>
          <Button size="normal" variant="loading" disabled>
            Connecting…
          </Button>
          <Button size="normal" disabled>
            Unavailable
          </Button>
          <Button size="normal" variant="danger" disabled>
            Delete unavailable
          </Button>
        </div>
      </CatalogCard>

      <CatalogCard
        title="Recovery"
        description="Retry actions use the same visible secondary role."
      >
        <div class="design-system-retry-grid">
          <div class="design-system-context-box">
            <span>Projects could not be loaded.</span>
            <Button size="normal" variant="outline">
              Retry
            </Button>
          </div>
          <div class="design-system-sidebar-box">
            <span>Sessions unavailable</span>
            <Button size="normal" variant="outline">
              Retry
            </Button>
          </div>
        </div>
      </CatalogCard>

      <CatalogCard
        title="Long content"
        description="Text may wrap, but the action stays legible and does not invent a compact label."
      >
        <div class="design-system-narrow-example">
          <Button class="design-system-long-action" size="normal" variant="contrast">
            Create a session in the selected server project
          </Button>
        </div>
      </CatalogCard>
    </CatalogPage>
  );
}

export const Catalog = { render: () => <ButtonsPage /> };
