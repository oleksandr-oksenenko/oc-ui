/* oxlint-disable effecttsgo/async-function -- Storybook owns interaction tests. */
import { createSignal } from "solid-js";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { NewSessionScreen } from "../src/renderer/components/App/ConnectedApp/Conversation/NewSessionScreen.tsx";
import { Composer } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/Composer.tsx";
import {
  composerAgentSelection,
  composerModelSelection,
  composerPasteProps,
} from "./composer-fixtures.ts";

const projects = [
  { id: "oc-ui", label: "oc-ui", detail: "/srv/projects/oc-ui" },
  { id: "scout", label: "scout", detail: "/srv/projects/scout" },
];
const onSubmit = fn();
const meta = {
  title: "Conversation/NewSessionScreen",
  component: NewSessionScreen,
  parameters: { layout: "fullscreen" },
  args: {
    setup: {
      projects,
      projectID: "oc-ui",
      mode: "local",
      branches: ["main", "feature/composer"],
      branch: { kind: "existing", name: "main" },
      defaultBranch: "main",
      git: true,
      onProjectChange: fn(),
      onModeChange: fn(),
      onBranchChange: fn(),
      onAddProject: fn(),
    },
    composer: undefined,
    onRetry: fn(),
  },
  render: (args) => {
    const [value, setValue] = createSignal("Design the new session experience");
    const [files, setFiles] = createSignal<readonly File[]>([]);
    const [projectID, setProjectID] = createSignal(args.setup.projectID);
    const [mode, setMode] = createSignal(args.setup.mode);
    const [branch, setBranch] = createSignal(args.setup.branch);
    const [recovered, setRecovered] = createSignal(false);
    const preparing = () => args.status?.kind === "preparing";
    return (
      <div style={{ height: "100vh" }}>
        <NewSessionScreen
          {...args}
          setup={{
            ...args.setup,
            get projectID() {
              return projectID();
            },
            get mode() {
              return mode();
            },
            get branch() {
              return branch();
            },
            get projects() {
              return args.setup.projects.map((project) => ({
                ...project,
                disabled: project.disabled && !recovered(),
              }));
            },
            onProjectChange: setProjectID,
            onModeChange: setMode,
            onBranchChange: setBranch,
            onRetryProjects: () => setRecovered(true),
          }}
          composer={
            <Composer
              {...composerPasteProps}
              value={value()}
              onInput={setValue}
              files={files()}
              onAttachFiles={(incoming) => setFiles((current) => [...current, ...incoming])}
              onRemoveFile={(file) =>
                setFiles((current) => current.filter((item) => item !== file))
              }
              onAttachText={(text) =>
                setFiles((current) => [
                  ...current,
                  new File([text], "pasted-text.txt", { type: "text/plain" }),
                ])
              }
              disabled={args.setup.loading || args.setup.projects.length === 0 || preparing()}
              readOnly={preparing()}
              action={preparing() ? "sending" : "send"}
              modelSelection={{ ...composerModelSelection(), disabled: preparing() }}
              agentSelection={{ ...composerAgentSelection(), disabled: preparing() }}
              onSubmit={() =>
                onSubmit({
                  value: value(),
                  files: files(),
                  projectID: projectID(),
                  mode: mode(),
                  branch: branch(),
                })
              }
            />
          }
        />
      </div>
    );
  },
} satisfies Meta<typeof NewSessionScreen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Worktree: Story = { args: { setup: { ...meta.args.setup, mode: "worktree" } } };
export const NewBranch: Story = {
  args: { setup: { ...meta.args.setup, branch: { kind: "new", name: "feature/design" } } },
};
export const Preparing: Story = {
  args: { status: { kind: "preparing", message: "Preparing worktree…" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Project: oc-ui" })).toBeDisabled();
    await expect(canvas.getByRole("textbox", { name: "Prompt" })).toHaveAttribute(
      "contenteditable",
      "false",
    );
  },
};
export const Failure: Story = {
  args: { status: { kind: "error", message: "Worktree creation failed. Your draft is saved." } },
};
export const Interrupted: Story = {
  args: {
    status: { kind: "interrupted", message: "Preparation was interrupted. Your draft is saved." },
  },
};
export const NoProjects: Story = {
  args: { setup: { ...meta.args.setup, projects: [], projectID: undefined } },
};
export const Loading: Story = { args: { setup: { ...meta.args.setup, loading: true } } };
export const NonGit: Story = { args: { setup: { ...meta.args.setup, git: false } } };
export const Narrow: Story = { globals: { viewport: { value: "mobile", isRotated: false } } };
export const Dark: Story = { globals: { theme: "dark" } };
export const Interactions: Story = {
  play: async ({ canvasElement }) => {
    onSubmit.mockClear();
    const canvas = within(canvasElement);
    const prompt = canvas.getByRole("textbox", { name: "Prompt" });
    await userEvent.type(prompt, " with saved edits");
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "Pasted notes ".repeat(1500));
    prompt.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }),
    );
    await expect(canvas.getByText("pasted-text.txt")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Project: oc-ui" }));
    await userEvent.click(await screen.findByRole("button", { name: /scout/ }));
    await userEvent.click(canvas.getByRole("button", { name: "Branch: main" }));
    const currentBranch = await screen.findByRole("button", { name: "main" });
    await expect(currentBranch).toHaveAttribute("data-selected", "true");
    await expect(
      currentBranch.querySelector('[data-slot="list-item-selected-icon"]'),
    ).not.toBeNull();
    await userEvent.click(await screen.findByRole("button", { name: "Create new branch…" }));
    await userEvent.type(
      canvas.getByRole("textbox", { name: "New branch name" }),
      "feature/design",
    );
    await expect(prompt).toHaveTextContent("with saved edits");
    await expect(canvas.getByText("pasted-text.txt")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Send" }));
    await expect(onSubmit).toHaveBeenCalledWith({
      value: "Design the new session experience with saved edits",
      files: [expect.any(File)],
      projectID: "scout",
      mode: "local",
      branch: { kind: "new", name: "feature/design" },
    });
  },
};
export const UnavailableProject: Story = {
  args: {
    setup: {
      ...meta.args.setup,
      projects: [
        {
          id: "old-project",
          label: "old-project",
          detail: "/srv/projects/old-project",
          disabled: true,
        },
        ...projects,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", { name: "Project: oc-ui" });
    await userEvent.click(trigger);
    const unavailable = await screen.findByRole("button", { name: /old-project.*Unavailable/ });
    await expect(unavailable).toBeDisabled();
    const projectList = unavailable.closest('[data-component="list"]');
    const active = () => projectList?.querySelector('[data-active="true"]');
    await waitFor(() => expect(active()).toHaveTextContent("oc-ui"));
    await userEvent.keyboard("{ArrowUp}");
    await waitFor(() => expect(active()).toHaveTextContent("scout"));
    await userEvent.keyboard("{ArrowDown}");
    await waitFor(() => expect(active()).toHaveTextContent("oc-ui"));
    await userEvent.type(screen.getByPlaceholderText("Search project"), "old-project");
    await userEvent.keyboard("{Enter}");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    await userEvent.click(trigger);
    await userEvent.click(
      await screen.findByRole("button", { name: "Retry unavailable projects" }),
    );
    await userEvent.click(trigger);
    const restored = await screen.findByRole("button", { name: /old-project/ });
    await expect(restored).toBeEnabled();
    await userEvent.click(restored);
    await expect(canvas.getByRole("button", { name: "Project: old-project" })).toBeVisible();
    await expect(canvas.getByRole("textbox", { name: "Prompt" })).toHaveTextContent(
      "Design the new session experience",
    );
  },
};
