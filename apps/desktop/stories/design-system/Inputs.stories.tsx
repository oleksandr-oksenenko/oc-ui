import { createSignal } from "solid-js";
import type { Meta } from "storybook-solidjs-vite";

import { Field } from "@opencode-ai/ui/field";
import { TextInput } from "@opencode-ai/ui/text-input";

import { CatalogCard, CatalogPage } from "./StoryLayout";

const meta = {
  title: "Design System/Inputs",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

function InputsPage() {
  const [workspace, setWorkspace] = createSignal("workspace.oc");

  return (
    <CatalogPage
      title="Inputs"
      intro="Fields pair one label, one control, and optional help or validation text. The upstream primitive owns interaction and focus behavior."
    >
      <CatalogCard
        title="Field anatomy"
        description="Labels and supporting text keep one predictable rhythm."
      >
        <div class="design-system-control-column">
          <Field class="design-system-field">
            <Field.Label>Workspace name</Field.Label>
            <Field.Control>
              <TextInput
                value={workspace()}
                onInput={(event) => setWorkspace(event.currentTarget.value)}
                showClearButton
                clearLabel="Clear workspace name"
                onClearClick={() => setWorkspace("")}
              />
            </Field.Control>
            <Field.Suffix>Used in the local session list</Field.Suffix>
          </Field>
          <Field class="design-system-field">
            <Field.Label tooltip="The server resolves this path.">Working directory</Field.Label>
            <Field.Control>
              <TextInput value="/srv/opencode/projects/oc-ui" />
            </Field.Control>
          </Field>
        </div>
      </CatalogCard>

      <CatalogCard
        title="Validation"
        description="Field errors are text-only and stay directly below the failed control."
      >
        <Field class="design-system-field" invalid>
          <Field.Label>Server URL</Field.Label>
          <Field.Control>
            <TextInput value="not-a-server" invalid />
          </Field.Control>
          <Field.Suffix role="alert">Enter a valid server URL</Field.Suffix>
        </Field>
      </CatalogCard>

      <CatalogCard
        title="Control sizes and states"
        description="Large suits setup forms; disabled is visibly unavailable without changing layout."
      >
        <div class="design-system-control-column">
          <TextInput
            class="design-system-field"
            value="Compact filter"
            aria-label="Compact filter"
          />
          <TextInput
            class="design-system-field"
            size="large"
            value="https://opencode.example.test"
            aria-label="Server URL"
          />
          <TextInput
            class="design-system-field"
            value="Disabled field"
            disabled
            aria-label="Disabled field"
          />
        </div>
      </CatalogCard>

      <CatalogCard
        title="Long value"
        description="Filesystem and server values scroll inside the control; the field does not widen its container."
      >
        <div class="design-system-narrow-example">
          <Field class="design-system-field">
            <Field.Label>Repository path</Field.Label>
            <Field.Control>
              <TextInput value="/srv/opencode/projects/very-long-organization-name/very-long-repository-name" />
            </Field.Control>
          </Field>
        </div>
      </CatalogCard>
    </CatalogPage>
  );
}

export const Catalog = { render: () => <InputsPage /> };
