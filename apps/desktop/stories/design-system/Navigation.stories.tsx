import type { Meta } from "storybook-solidjs-vite";

import { Collapsible } from "@opencode-ai/ui/collapsible";
import { Icon } from "@opencode-ai/ui/icon";
import { Tabs } from "@opencode-ai/ui/tabs";

import { CatalogCard, CatalogPage } from "./StoryLayout";

const meta = {
  title: "Design System/Navigation",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

function NavigationPage() {
  return (
    <CatalogPage
      title="Navigation"
      intro="Tabs change peer views, disclosure rows reveal details, and tree rows move through sessions. They share type and focus rules without sharing one shape."
    >
      <CatalogCard
        title="Underline tabs"
        description="Use for peer content views with a stable content region."
      >
        <Tabs class="design-system-tabs" variant="underline" defaultValue="changes">
          <Tabs.List aria-label="Workspace views">
            <Tabs.Trigger value="changes">Changes</Tabs.Trigger>
            <Tabs.Trigger value="output">Output with a longer label</Tabs.Trigger>
            <Tabs.Trigger value="disabled" disabled>
              Disabled
            </Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content class="design-system-tabs-content" value="changes">
            Review 3 changed files in the active workspace.
          </Tabs.Content>
          <Tabs.Content class="design-system-tabs-content" value="output">
            The latest command output is ready to inspect.
          </Tabs.Content>
        </Tabs>
      </CatalogCard>

      <CatalogCard
        title="Disclosure rows"
        description="A 26px trigger owns collapsed and expanded state; content keeps a consistent indent."
      >
        <div class="design-system-control-column">
          <Collapsible class="design-system-collapsible" defaultOpen>
            <Collapsible.Trigger class="design-system-collapsible-trigger">
              <span>Reasoning</span>
              <Collapsible.Arrow />
            </Collapsible.Trigger>
            <Collapsible.Content class="design-system-collapsible-content">
              I’ll inspect the affected files, make the smallest consistent change, then verify it.
            </Collapsible.Content>
          </Collapsible>
          <Collapsible class="design-system-collapsible">
            <Collapsible.Trigger class="design-system-collapsible-trigger">
              <span>Shell command completed</span>
              <Collapsible.Arrow />
            </Collapsible.Trigger>
            <Collapsible.Content class="design-system-collapsible-content">
              pnpm check completed successfully.
            </Collapsible.Content>
          </Collapsible>
        </div>
      </CatalogCard>

      <CatalogCard
        title="Session tree rows"
        description="Selection, activity, and attention remain visually distinct."
      >
        <div class="design-system-tree">
          <div class="design-system-session-row" data-selected>
            <Icon name="chevron-down" size="small" />
            <span>Design system audit</span>
            <span class="design-system-status-dot" role="img" aria-label="Running" />
          </div>
          <div class="design-system-session-row design-system-tree-child">
            <span />
            <span class="design-system-ellipsis">
              Audit all product controls and intentionally long content
            </span>
            <span class="design-system-attention-dot" role="img" aria-label="Needs attention" />
          </div>
          <div class="design-system-session-row">
            <Icon name="chevron-right" size="small" />
            <span>Connection flow</span>
            <span />
          </div>
        </div>
      </CatalogCard>
    </CatalogPage>
  );
}

export const Catalog = { render: () => <NavigationPage /> };
