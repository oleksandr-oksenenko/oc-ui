import { For } from "solid-js";
import type { Meta } from "storybook-solidjs-vite";

import { Icon } from "@opencode-ai/ui/icon";

import { CatalogCard, CatalogPage } from "./StoryLayout";

const meta = {
  title: "Design System/Content",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

function ContentPage() {
  return (
    <CatalogPage
      title="Content"
      intro="Transcript prose, code, tool output, attachments, and scroll regions use distinct typography for distinct jobs while sharing the same surfaces and borders."
    >
      <CatalogCard
        title="Transcript prose"
        description="Readable assistant content uses the relaxed body rhythm and a controlled line length."
      >
        <article class="design-system-prose">
          <h3>Design system result</h3>
          <p>
            The interface now has one visual rule for each recurring role. Product-specific layouts
            remain local where they carry real meaning.
          </p>
          <ul>
            <li>Buttons use role-based variants.</li>
            <li>Fields keep labels and errors in one rhythm.</li>
            <li>Statuses distinguish activity from attention.</li>
          </ul>
          <blockquote>Keep one design decision in one place.</blockquote>
        </article>
      </CatalogCard>

      <CatalogCard
        title="Code and command output"
        description="Source code scrolls horizontally; logs and command output wrap long lines."
      >
        <div class="design-system-control-column">
          <pre class="design-system-code design-system-code-source">
            <code>{`const selected = projects.find(
  (project) => project.id === selectedProjectID,
)`}</code>
          </pre>
          <pre class="design-system-code design-system-code-output">
            <code>{`$ pnpm check
Checked 953 nodes across 89 renderer files.
This deliberately long log line wraps because command output favors continuity over preserving source columns.`}</code>
          </pre>
        </div>
      </CatalogCard>

      <CatalogCard
        title="Attachments and metadata"
        description="Passive chips preserve file type and a readable filename."
      >
        <div class="design-system-attachment-row">
          <span class="design-system-attachment">
            <Icon name="code" />
            <span class="design-system-ellipsis">design-system-audit-with-a-long-name.md</span>
            <span class="design-system-chip">Markdown</span>
          </span>
          <span class="design-system-attachment">
            <Icon name="photo" />
            <span>workspace.png</span>
            <span class="design-system-chip">PNG</span>
          </span>
        </div>
      </CatalogCard>

      <CatalogCard
        title="Scrollbar sample"
        description="Product scroll regions share a quiet track and visible thumb; nested code keeps its own local axis."
      >
        <div class="design-system-scroll-sample" aria-label="Scrollable transcript sample">
          <For each={Array.from({ length: 10 })}>
            {(_, index) => (
              <p>
                Transcript item {index() + 1}: deterministic content keeps the scrollbar visible for
                review.
              </p>
            )}
          </For>
        </div>
      </CatalogCard>
    </CatalogPage>
  );
}

export const Catalog = { render: () => <ContentPage /> };
