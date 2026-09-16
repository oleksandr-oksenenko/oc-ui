import type { Meta } from "storybook-solidjs-vite";

import { DiffChanges } from "@opencode/ui/diff-changes";
import { Icon } from "@opencode/ui/icon";

import { CatalogCard, CatalogPage } from "./StoryLayout";

const meta = {
  title: "Design System/Data Display",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

function DataDisplayPage() {
  return (
    <CatalogPage
      title="Data Display"
      intro="Cards, metadata, diff statistics, and chips describe product state without behaving like controls. Their density follows the information they contain."
    >
      <CatalogCard
        title="Diff summaries"
        description="Use compact statistics in file headers and standard statistics in summary content."
      >
        <div class="design-system-control-column">
          <div class="design-system-diff-header">
            <span class="design-system-ellipsis">
              apps/desktop/src/renderer/components/SessionPane/TranscriptView.tsx
            </span>
            <DiffChanges changes={{ additions: 18, deletions: 4 }} />
          </div>
          <div class="design-system-diff-block">
            <span class="design-system-caption">Workspace summary</span>
            <DiffChanges
              changes={[
                { additions: 12, deletions: 2 },
                { additions: 6, deletions: 2 },
              ]}
              appearance="standard"
            />
          </div>
          <div class="design-system-diff-block">
            <span class="design-system-caption">No line changes</span>
            <DiffChanges changes={{ additions: 0, deletions: 0 }} />
          </div>
        </div>
      </CatalogCard>

      <CatalogCard
        title="Metadata rows"
        description="Primary content stays readable; supporting values use the mono family where shape matters."
      >
        <div class="design-system-metadata-card">
          <div class="design-system-metadata-heading">
            <Icon name="code" />
            <strong>design-system.css</strong>
            <span class="design-system-chip">Modified</span>
          </div>
          <dl class="design-system-metadata-list">
            <div>
              <dt>Project</dt>
              <dd>oc-ui</dd>
            </div>
            <div>
              <dt>Directory</dt>
              <dd>/srv/opencode/projects/oc-ui</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>2 minutes ago</dd>
            </div>
          </dl>
        </div>
      </CatalogCard>

      <CatalogCard
        title="Cards and chips"
        description="Cards group related facts. Chips are passive labels, not small buttons."
      >
        <div class="design-system-card-row">
          <article class="design-system-data-card">
            <span class="design-system-chip">Git</span>
            <strong>Separate worktree</strong>
            <p>Changes stay isolated from the project checkout.</p>
          </article>
          <article class="design-system-data-card">
            <span class="design-system-chip design-system-chip-success">Connected</span>
            <strong>Local server</strong>
            <p>http://127.0.0.1:4096</p>
          </article>
        </div>
      </CatalogCard>
    </CatalogPage>
  );
}

export const Catalog = { render: () => <DataDisplayPage /> };
