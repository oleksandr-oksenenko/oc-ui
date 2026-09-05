/* oxlint-disable effecttsgo/async-function */

import type {
  PermissionRequest,
  PermissionSavedInfo,
  Project,
  SessionInfo,
} from "@opencode-ai/client";
import { createSignal, type JSX } from "solid-js";
import { expect, fn, userEvent, within } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { PermissionsDialog } from "../src/renderer/components/App/ConnectedApp/Permissions/PermissionsDialog.tsx";
import { PermissionsRegion } from "../src/renderer/components/App/ConnectedApp/Permissions/PermissionsRegion.tsx";
import type {
  PermissionInboxEntry,
  PermissionsController,
} from "../src/renderer/components/App/ConnectedApp/Permissions/createPermissions.ts";
import { sessionFixture } from "../src/renderer/test/session-fixture.ts";
import { DialogStory } from "./DialogStory.tsx";

const project = (id: string, canonical: string, name?: string): Project => ({
  id,
  canonical,
  name,
  time: { created: 1, updated: 2 },
  sandboxes: [],
});

const session = (id: string, title: string, directory: string, workspaceID?: string): SessionInfo =>
  sessionFixture({ id, title, projectID: `project-${id}`, location: { directory, workspaceID } });

const request = (
  id: string,
  sessionID: string,
  action: string,
  resources: readonly string[],
): PermissionRequest => ({ id, sessionID, action, resources: [...resources] });

type FixtureOptions = {
  readonly connected?: boolean;
  readonly inboxState?: "loading" | "ready" | "failed";
  readonly inboxError?: string;
  readonly savedState?: "loading" | "ready" | "failed";
  readonly savedError?: string;
  readonly recoveryError?: string;
  readonly entries?: readonly PermissionInboxEntry[];
  readonly projects?: readonly Project[];
  readonly rules?: readonly PermissionSavedInfo[];
};

function fixture(options: FixtureOptions = {}) {
  const [entries] = createSignal<readonly PermissionInboxEntry[]>(options.entries ?? []);
  const [projects] = createSignal<readonly Project[]>(options.projects ?? []);
  const [rules, setRules] = createSignal<readonly PermissionSavedInfo[]>(options.rules ?? []);
  const inboxSync = fn(async () => undefined);
  const savedSync = fn(async () => undefined);
  const remove = fn(async (ruleID: string) => {
    setRules((current) => current.filter((rule) => rule.id !== ruleID));
  });
  const controller: PermissionsController = {
    requests: () => [],
    state: () => options.inboxState ?? "ready",
    error: () => options.inboxError,
    recoveryError: () => options.recoveryError,
    pending: () => false,
    submitting: () => false,
    errorFor: () => undefined,
    sync: inboxSync,
    reply: fn(async () => undefined),
    inbox: {
      entries,
      state: () => options.inboxState ?? "ready",
      error: () => options.inboxError,
      sync: inboxSync,
    },
    saved: {
      rules,
      projects,
      state: () => options.savedState ?? "ready",
      error: () => options.savedError,
      removing: () => false,
      errorFor: () => undefined,
      sync: savedSync,
      remove,
    },
  };
  return {
    controller,
    connected: () => options.connected ?? true,
    remove,
  };
}

const firstSession = session("one", "Release verification", "/srv/projects/one", "workspace-one");
const secondSession = session("two", "", "C:\\worktrees\\two", "workspace-two");
const baseEntries: readonly PermissionInboxEntry[] = [
  {
    session: firstSession,
    requests: [
      request("request-one", firstSession.id, "read files", [
        "/srv/projects/one/src/main.ts",
        "/srv/projects/one/package.json",
      ]),
    ],
  },
  {
    session: secondSession,
    requests: [
      request("request-two", secondSession.id, "run command", ["pnpm check"]),
      request("request-three", secondSession.id, "write files", ["C:\\worktrees\\two\\src"]),
    ],
  },
];
const baseProjects = [
  project("project-one", "/srv/projects/one", "Project One"),
  project("project-two", "C:\\projects\\two"),
];
const baseRules: readonly PermissionSavedInfo[] = [
  {
    id: "rule-one",
    projectID: "project-one",
    action: "read files",
    resource: "/srv/projects/one/**",
  },
  {
    id: "rule-two",
    projectID: "project-two",
    action: "run command",
    resource: "pnpm *",
  },
];
const narrowEntries: readonly PermissionInboxEntry[] = Array.from(
  { length: 4 },
  (_entry, index) => {
    const item = session(
      `session-with-an-intentionally-long-identifier-${index + 1}`,
      `A long session title ${index + 1} that remains readable at the supported narrow viewport`,
      `/srv/a-very-long-directory-name/with/nested/worktrees/project-${index + 1}`,
      `workspace-with-an-intentionally-long-identifier-${index + 1}`,
    );
    return {
      session: item,
      requests: [
        request(`long-${index + 1}`, item.id, index === 0 ? "" : "read files", [
          ...(index === 0 ? [""] : []),
          ...Array.from(
            { length: 10 },
            (_resource, resourceIndex) =>
              `/srv/a-very-long-directory-name/generated/resource-${index + 1}-${resourceIndex + 1}.typescript.tsx`,
          ),
        ]),
      ],
    };
  },
);

const frame: JSX.CSSProperties = {
  width: "100vw",
  height: "100vh",
  background: "var(--oc-surface-canvas)",
};

function dialogStory(options: FixtureOptions) {
  const state = fixture(options);
  return (
    <main style={frame}>
      <DialogStory>
        {() => (
          <PermissionsDialog
            controller={state.controller}
            connected={state.connected}
            onOpenSession={fn()}
          />
        )}
      </DialogStory>
    </main>
  );
}

function launcherStory(options: FixtureOptions) {
  const state = fixture(options);
  return (
    <main style={{ ...frame, padding: "24px" }}>
      <PermissionsRegion
        controller={state.controller}
        connected={state.connected}
        onOpenSession={fn()}
      />
    </main>
  );
}

function dialogContainer(canvasElement: HTMLElement): HTMLElement {
  const dialog = within(canvasElement.ownerDocument.body).getByRole("dialog", {
    name: "Permissions",
  });
  const container = dialog.closest<HTMLElement>('[data-slot="dialog-container"]');
  if (!container) throw new Error("Permissions dialog container not found");
  return container;
}

async function expectCompactContentHeight(canvasElement: HTMLElement): Promise<void> {
  const container = dialogContainer(canvasElement);
  await expect(container.getBoundingClientRect().width).toBeGreaterThanOrEqual(639);
  await expect(container.getBoundingClientRect().width).toBeLessThanOrEqual(681);
  await expect(container.getBoundingClientRect().height).toBeLessThan(360);
  await expect(getComputedStyle(container).height).not.toBe("600px");
}

const meta = {
  title: "Permissions/ManagementDialog",
  component: PermissionsDialog,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof PermissionsDialog>;

export default meta;
type PlayContext = Parameters<NonNullable<StoryObj<typeof meta>["play"]>>[0];

export const MultipleSessionsAndProjects = {
  render: () => dialogStory({ entries: baseEntries, projects: baseProjects, rules: baseRules }),
};

export const EmptyReady = {
  render: () => dialogStory({ entries: [], projects: [], rules: [] }),
  play: async ({ canvasElement }: PlayContext) => expectCompactContentHeight(canvasElement),
};

export const FailedEmpty = {
  render: () =>
    dialogStory({
      inboxState: "failed",
      inboxError: "Pending permissions could not be refreshed.",
      savedState: "failed",
      savedError: "Saved approvals could not be refreshed.",
    }),
  play: async ({ canvasElement }: PlayContext) => expectCompactContentHeight(canvasElement),
};

export const Loading = {
  render: () =>
    dialogStory({
      inboxState: "loading",
      savedState: "loading",
      entries: baseEntries.slice(0, 1),
      projects: baseProjects,
      rules: baseRules,
    }),
};

export const CachedPartialFailureDisconnected = {
  render: () =>
    dialogStory({
      connected: false,
      inboxState: "failed",
      inboxError: "One server location could not be inspected. Cached results may be incomplete.",
      savedState: "failed",
      savedError: "Saved approvals could not be refreshed.",
      entries: baseEntries,
      projects: baseProjects,
      rules: baseRules,
    }),
};

export const RecoveryBlocked = {
  render: () =>
    dialogStory({
      recoveryError: "The previous permission change could not be reconciled with the server.",
      entries: baseEntries,
      projects: baseProjects,
      rules: baseRules,
    }),
};

export const NarrowLongAndEmptyValues = {
  parameters: { viewport: { defaultViewport: "mobile" } },
  render: () =>
    dialogStory({
      entries: narrowEntries,
      projects: [project("empty-project-id", "", "")],
      rules: [{ id: "empty-rule", projectID: "empty-project-id", action: "", resource: "" }],
    }),
  play: async ({ canvasElement }: PlayContext) => {
    const page = within(canvasElement.ownerDocument.body);
    const container = dialogContainer(canvasElement);
    const content = page.getByRole("tabpanel");
    const maxHeight = Number.parseFloat(getComputedStyle(container).maxHeight);
    await expect(container.getBoundingClientRect().height).toBeLessThanOrEqual(maxHeight + 1);
    await expect(content.scrollHeight).toBeGreaterThan(content.clientHeight);
  },
};

export const InlineRevokeAndFocus = {
  render: () => dialogStory({ projects: baseProjects, rules: baseRules }),
  play: async ({ canvasElement, step }: PlayContext) => {
    const page = within(canvasElement.ownerDocument.body);
    await step("Confirm revocation and focus the next saved rule", async () => {
      await userEvent.click(page.getByRole("tab", { name: "Saved approvals" }));
      await userEvent.click(
        page.getByRole("button", {
          name: "Revoke saved approval for read files and /srv/projects/one/**",
        }),
      );
      await expect(page.getByText(/This affects future permission checks/)).toBeVisible();
      await userEvent.click(page.getByRole("button", { name: "Confirm revoke" }));
      await expect(
        page.getByRole("button", {
          name: "Revoke saved approval for run command and pnpm *",
        }),
      ).toHaveFocus();
    });
  },
};

export const CancelAndEscape = {
  render: () => dialogStory({ projects: baseProjects, rules: baseRules }),
  play: async ({ canvasElement, step }: PlayContext) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(page.getByRole("tab", { name: "Saved approvals" }));
    await step("Cancel sends no revocation", async () => {
      await userEvent.click(page.getAllByRole("button", { name: /Revoke saved approval/ })[0]!);
      await userEvent.click(page.getByRole("button", { name: "Cancel" }));
      await expect(page.queryByRole("button", { name: "Confirm revoke" })).toBeNull();
    });
    await step("Escape closes only inline confirmation", async () => {
      await userEvent.click(page.getAllByRole("button", { name: /Revoke saved approval/ })[0]!);
      await userEvent.keyboard("{Escape}");
      await expect(page.queryByRole("button", { name: "Confirm revoke" })).toBeNull();
      await expect(page.getByRole("dialog", { name: "Permissions" })).toBeVisible();
    });
  },
};

export const LauncherCountAndState = {
  render: () => launcherStory({ entries: baseEntries, projects: baseProjects, rules: baseRules }),
};

export const LauncherLoading = {
  render: () => launcherStory({ inboxState: "loading" }),
};

export const LauncherUnavailable = {
  render: () => launcherStory({ inboxState: "failed", inboxError: "Discovery failed." }),
};

export const LauncherCachedDisconnected = {
  render: () => launcherStory({ connected: false, entries: baseEntries }),
};
