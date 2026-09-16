import type { Meta } from "storybook-solidjs-vite";

import { Icon } from "@opencode/ui/icon";
import { IconButton } from "@opencode/ui/icon-button";

import { CatalogCard, CatalogPage } from "./StoryLayout";

const meta = {
  title: "Design System/Icon Actions",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

function IconActionsPage() {
  return (
    <CatalogPage
      title="Icon Actions"
      intro="Icon-only actions use the upstream IconButton. Their accessible label names the action; size follows where the control lives."
    >
      <CatalogCard
        title="Placement sizes"
        description="Compact row 20; chrome and prominent actions 24."
      >
        <div class="design-system-control-row design-system-align-end">
          <div class="design-system-icon-example">
            <IconButton size="small" icon={<Icon name="trash" />} aria-label="Delete session" />
            <span>Compact row</span>
          </div>
          <div class="design-system-icon-example">
            <IconButton icon={<Icon name="close" />} aria-label="Close panel" />
            <span>Panel chrome</span>
          </div>
          <div class="design-system-icon-example">
            <IconButton
              size="normal"
              variant="contrast"
              icon={<Icon name="plus" />}
              aria-label="New session"
            />
            <span>Prominent</span>
          </div>
        </div>
      </CatalogCard>

      <CatalogCard
        title="Role variants"
        description="Ghost is the normal chrome action; contrast is reserved for the main icon action."
      >
        <div class="design-system-control-row">
          <IconButton
            variant="ghost"
            icon={<Icon name="settings-gear" />}
            aria-label="Open settings"
          />
          <IconButton
            variant="ghost"
            icon={<Icon name="chevron-left" />}
            aria-label="Hide sessions"
          />
          <IconButton variant="contrast" icon={<Icon name="plus" />} aria-label="New session" />
          <IconButton
            variant="ghost"
            icon={<Icon name="trash" />}
            disabled
            aria-label="Delete unavailable"
          />
        </div>
      </CatalogCard>

      <CatalogCard
        title="Keyboard focus"
        description="This specimen uses the same ring token as the upstream focus-visible state."
      >
        <div class="design-system-focus-stage">
          <IconButton
            class="design-system-focus-preview"
            icon={<Icon name="close" />}
            aria-label="Focused close action"
          />
          <span class="design-system-caption">
            2px ring, 2px offset; clipped chrome uses an inset offset.
          </span>
        </div>
      </CatalogCard>

      <CatalogCard
        title="Dense row reveal"
        description="The action may reveal on row hover, but its hit area and label remain canonical."
      >
        <div class="design-system-session-row design-system-session-row-preview">
          <Icon name="chevron-right" size="small" />
          <span class="design-system-ellipsis">
            A long session title that must not push the delete action out of view
          </span>
          <IconButton size="small" icon={<Icon name="trash" />} aria-label="Delete session" />
        </div>
      </CatalogCard>
    </CatalogPage>
  );
}

export const Catalog = { render: () => <IconActionsPage /> };
