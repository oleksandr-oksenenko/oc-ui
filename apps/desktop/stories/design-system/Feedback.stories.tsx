import type { Meta } from "storybook-solidjs-vite";

import { Button } from "@opencode-ai/ui/button";
import { Icon } from "@opencode-ai/ui/icon";
import { Loader } from "@opencode-ai/ui/loader";

import { CatalogCard, CatalogPage } from "./StoryLayout";

const meta = {
  title: "Design System/Feedback",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

function FeedbackPage() {
  return (
    <CatalogPage
      title="Feedback"
      intro="Feedback strength follows its scope: field validation is quiet, status rows are compact, panel states are centered, and blocking failures use a banner."
    >
      <CatalogCard
        title="Status indicators"
        description="A status dot means activity. An attention marker means the user must act."
      >
        <div class="design-system-status-grid">
          <div class="design-system-status-line">
            <span class="design-system-status-dot" />
            <span>Session running</span>
          </div>
          <div class="design-system-status-line">
            <span class="design-system-attention-dot" />
            <span>Input required</span>
          </div>
          <div class="design-system-status-line">
            <Icon name="circle-check" />
            <span>Tool completed</span>
          </div>
          <div class="design-system-status-line design-system-status-danger">
            <Icon name="warning" />
            <span>Connection failed</span>
          </div>
        </div>
      </CatalogCard>

      <CatalogCard
        title="Loader scale"
        description="14 compact status, 16 control, 18 prominent state."
      >
        <div class="design-system-loader-row">
          <output class="design-system-loader-item" aria-live="polite">
            <Loader width={14} height={14} />
            <span>Compact status · 14</span>
          </output>
          <output class="design-system-loader-item" aria-live="polite">
            <Loader width={16} height={16} />
            <span>Control · 16</span>
          </output>
          <output class="design-system-loader-item" aria-live="polite">
            <Loader width={18} height={18} />
            <span>Prominent state · 18</span>
          </output>
        </div>
      </CatalogCard>

      <CatalogCard
        title="Compact and panel states"
        description="Use the same type rhythm; placement follows the size of the affected region."
      >
        <div class="design-system-feedback-pair">
          <div class="design-system-inline-state">
            <Loader width={14} height={14} />
            <span>Refreshing changes</span>
          </div>
          <div class="design-system-panel-state">
            <Icon name="folder" />
            <strong>No sessions yet</strong>
            <span>Create a session to start working in this project.</span>
          </div>
        </div>
      </CatalogCard>

      <CatalogCard
        title="Blocking operation banner"
        description="A failed dialog operation remains visible and keeps its recovery action nearby."
      >
        <div class="design-system-banner" role="alert">
          <Icon name="warning" />
          <div>
            <strong>Project could not be added</strong>
            <span class="design-system-banner-message">
              The connected server did not accept this directory.
            </span>
          </div>
          <Button size="normal" variant="outline">
            Retry
          </Button>
        </div>
      </CatalogCard>

      <CatalogCard
        title="Long failure content"
        description="Messages wrap; the icon and recovery action keep their place."
      >
        <div class="design-system-banner design-system-narrow-example" role="alert">
          <Icon name="warning" />
          <div>
            <strong>Connection failed</strong>
            <span class="design-system-banner-message">
              The server returned a deliberately long explanation that needs to wrap without pushing
              the retry action outside the available width.
            </span>
          </div>
          <Button size="normal" variant="outline">
            Retry
          </Button>
        </div>
      </CatalogCard>
    </CatalogPage>
  );
}

export const Catalog = { render: () => <FeedbackPage /> };
