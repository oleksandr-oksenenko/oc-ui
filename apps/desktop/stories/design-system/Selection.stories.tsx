import { createSignal } from "solid-js";
import type { Meta } from "storybook-solidjs-vite";

import { RadioGroup, RadioItem } from "@opencode-ai/ui/radio";
import { Select } from "@opencode-ai/ui/select";

import { CatalogCard, CatalogPage } from "./StoryLayout";

const meta = {
  title: "Design System/Selection",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

function SelectionPage() {
  const [mode, setMode] = createSignal("direct");
  const [effort, setEffort] = createSignal("Balanced");
  const efforts = ["Fast", "Balanced", "Thorough"];

  return (
    <CatalogPage
      title="Selection"
      intro="Radio groups choose among a small visible set. Selects handle a short single-line menu. Searchable domain pickers remain feature-owned because their row content differs."
    >
      <CatalogCard
        title="Compact choice"
        description="Use for two or three options that benefit from descriptions."
      >
        <RadioGroup
          name="location-mode"
          label="Where should the session run?"
          value={mode()}
          onChange={setMode}
        >
          <RadioItem
            value="direct"
            label="Use the project directory"
            description="Commands and changes happen directly in the project directory."
          />
          <RadioItem
            value="worktree"
            label="Create a worktree"
            description="Create a separate Git worktree at the project commit."
          />
          <RadioItem value="unavailable" label="Unavailable option" disabled />
        </RadioGroup>
        <p class="design-system-caption">Selected: {mode()}</p>
      </CatalogCard>

      <CatalogCard
        title="Simple select"
        description="A compact trigger is right for agent, variant, effort, and other short values."
      >
        <div class="design-system-control-column">
          <Select
            class="design-system-select"
            options={efforts}
            current={effort()}
            placeholder="Choose effort"
            onSelect={(value) => value && setEffort(value)}
            aria-label="Reasoning effort"
          />
          <Select
            class="design-system-select"
            options={efforts}
            current={effort()}
            disabled
            aria-label="Disabled reasoning effort"
          />
          <span class="design-system-caption">Selected: {effort()}</span>
        </div>
      </CatalogCard>

      <CatalogCard
        title="Picker density contracts"
        description="The content determines row density; model and project rows should not be forced into one generic shape."
      >
        <div class="design-system-picker-comparison">
          <div class="design-system-picker">
            <div class="design-system-picker-search">Search models</div>
            <div class="design-system-picker-heading">OpenAI</div>
            <div class="design-system-picker-row design-system-picker-row-compact" data-selected>
              <span>GPT-5.6 Sol</span>
              <span aria-hidden="true">✓</span>
            </div>
            <div class="design-system-picker-row design-system-picker-row-compact">
              <span>GPT-5.6 Luna</span>
            </div>
          </div>
          <div class="design-system-picker">
            <div class="design-system-picker-search">Search projects</div>
            <div class="design-system-picker-row design-system-picker-row-rich" data-selected>
              <div class="design-system-picker-row-copy">
                <strong>oc-ui</strong>
                <span class="design-system-picker-row-path">/srv/opencode/projects/oc-ui</span>
              </div>
              <span class="design-system-picker-row-marker" aria-hidden="true">
                ✓
              </span>
            </div>
            <div class="design-system-picker-row design-system-picker-row-rich">
              <div class="design-system-picker-row-copy">
                <strong>desktop</strong>
                <span class="design-system-picker-row-path">/srv/opencode/apps/desktop</span>
              </div>
            </div>
          </div>
        </div>
      </CatalogCard>

      <CatalogCard
        title="Long option content"
        description="Primary text truncates; the selected marker and trigger affordance remain visible."
      >
        <div class="design-system-picker design-system-narrow-example">
          <div class="design-system-picker-row design-system-picker-row-rich" data-selected>
            <div class="design-system-picker-row-copy">
              <strong>A project with a deliberately long display name</strong>
              <span class="design-system-picker-row-path">
                /srv/opencode/projects/a-deeply-nested-and-deliberately-long-repository-path
              </span>
            </div>
            <span class="design-system-picker-row-marker" aria-hidden="true">
              ✓
            </span>
          </div>
        </div>
      </CatalogCard>
    </CatalogPage>
  );
}

export const Catalog = { render: () => <SelectionPage /> };
