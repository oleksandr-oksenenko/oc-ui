/* oxlint-disable effecttsgo/async-function */

import { RegistryContext } from "@effect/atom-solid";
import { Effect, Exit, Scope } from "effect";
import { AtomRegistry } from "effect/unstable/reactivity";
import { onCleanup } from "solid-js";
import { makeWorkspaceOwner } from "../src/renderer/workspace-owner.ts";
import type { FileListOutput, LocationRef, OpenCodeClient } from "@opencode/client";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

import {
  AddProjectDialog,
  type AddProjectDialogError,
} from "../src/renderer/components/App/ConnectedApp/Sessions/SessionSidebar/NewSessionFlow/AddProjectDialog.tsx";
import { deferred } from "../src/renderer/test/deferred.ts";
import { DialogStory } from "./DialogStory.tsx";

function response(
  directory: string,
  entries: readonly string[],
  workspaceID?: string,
): FileListOutput {
  return {
    location: {
      directory,
      workspaceID,
      project: { id: "project", directory, canonical: directory },
    },
    data: entries.map((path) => ({ path, type: "directory" })),
  };
}

const listDirectory: OpenCodeClient["file"]["list"] = (input) => {
  const directory = input?.path ?? input?.location?.directory ?? "/";
  const entries =
    directory === "/srv/projects"
      ? ["oc-ui", "opencode", "api"]
      : directory === "/srv"
        ? ["projects", "worktrees"]
        : [];
  return Promise.resolve(
    response(input?.location?.directory ?? "/", entries, input?.location?.workspace),
  );
};

// Keep the loading fixture pending until its view closes.
const loadingListDirectory: OpenCodeClient["file"]["list"] = (_input, options) =>
  Effect.runPromise(Effect.never, { signal: options?.signal });

const meta = {
  title: "Projects/AddProjectDialog",
  component: AddProjectDialog,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof AddProjectDialog>;

export default meta;
type Story = StoryObj;
const browseOnAddProject = fn<(location: LocationRef) => void>();
const browseStoryState = new WeakMap<Element, ReturnType<typeof deferred<FileListOutput>>>();

function dialog(
  options: {
    readonly initialLocation?: LocationRef;
    readonly listDirectory?: OpenCodeClient["file"]["list"];
    readonly error?: AddProjectDialogError;
    readonly adding?: boolean;
    readonly onAddProject?: (location: LocationRef) => void;
  } = {},
) {
  const registry = AtomRegistry.make();
  const scope = Scope.makeUnsafe();
  const effects = Effect.runSync(
    makeWorkspaceOwner(registry).pipe(Effect.provideService(Scope.Scope, scope)),
  );
  onCleanup(() => {
    void Effect.runPromise(Scope.close(scope, Exit.void)).then(() => registry.dispose());
  });
  return (
    <RegistryContext.Provider value={registry}>
      <DialogStory>
        {(onDismissBlockedChange) => (
          <AddProjectDialog
            effects={effects}
            listDirectory={options.listDirectory ?? listDirectory}
            initialLocation={options.initialLocation ?? { directory: "/srv/projects" }}
            requestLocation={options.initialLocation ?? { directory: "/srv/projects" }}
            error={options.error}
            adding={options.adding}
            onDismissBlockedChange={onDismissBlockedChange}
            onAddProject={options.onAddProject ?? (() => undefined)}
          />
        )}
      </DialogStory>
    </RegistryContext.Provider>
  );
}

export const BrowseServerProjects: Story = {
  render: () => {
    const childNavigation = deferred<FileListOutput>();
    return (
      <div
        data-story-fixture="browse-server-projects"
        ref={(element) => browseStoryState.set(element, childNavigation)}
      >
        {dialog({
          initialLocation: { directory: "/srv/projects", workspaceID: "workspace-1" },
          listDirectory: (input) => {
            if (input?.path === "/srv/projects/oc-ui") {
              return childNavigation.promise;
            }
            return listDirectory(input);
          },
          onAddProject: browseOnAddProject,
        })}
      </div>
    );
  },
  play: async ({ canvasElement, step }) => {
    browseOnAddProject.mockClear();
    const fixture = canvasElement.querySelector('[data-story-fixture="browse-server-projects"]');
    if (!fixture) throw new Error("Browse story fixture did not render");
    const currentDialog = await screen.findByRole("dialog", { name: "Add project" });
    const dialogCanvas = within(currentDialog);
    await expect(canvasElement.contains(currentDialog)).toBe(false);

    await step("Keep the previous directory from being submitted while browsing", async () => {
      const childDirectory = await dialogCanvas.findByRole("button", {
        name: "Browse directory oc-ui",
      });
      await userEvent.click(childDirectory);

      const browserShell = dialogCanvas.getByRole("region", { name: "Project directory" });
      const browser = browserShell.querySelector<HTMLElement>(".server-directory-browser");
      if (!browser) throw new Error("Project directory browser did not render");
      const addProject = dialogCanvas.getByRole("button", { name: "Add project" });
      await expect(dialogCanvas.getByText("/srv/projects/oc-ui")).toBeVisible();
      await expect(browser).toHaveAttribute("aria-busy", "true");
      await expect(addProject).toBeDisabled();
      await expect(
        dialogCanvas.getByRole("button", { name: "Go to parent directory" }),
      ).toBeDisabled();

      const form = currentDialog.querySelector<HTMLFormElement>("form");
      if (!form) throw new Error("Add project form did not render");
      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
      await expect(browseOnAddProject).not.toHaveBeenCalled();
    });

    await step("Add the resolved directory with its workspace identity", async () => {
      const childNavigation = browseStoryState.get(fixture);
      if (!childNavigation) throw new Error("Browse story did not create child navigation");
      childNavigation.resolve(response("/srv/projects", [], "workspace-1"));

      await expect(await dialogCanvas.findByText("/srv/projects/oc-ui")).toBeVisible();
      const browserShell = dialogCanvas.getByRole("region", { name: "Project directory" });
      const browser = browserShell.querySelector<HTMLElement>(".server-directory-browser");
      if (!browser) throw new Error("Project directory browser did not render");
      const addProject = dialogCanvas.getByRole("button", { name: "Add project" });
      await expect(browser).not.toHaveAttribute("aria-busy", "true");
      await expect(addProject).not.toBeDisabled();
      await userEvent.click(addProject);
      await expect(browseOnAddProject).toHaveBeenCalledOnce();
      await expect(browseOnAddProject).toHaveBeenCalledWith({
        directory: "/srv/projects/oc-ui",
        workspaceID: "workspace-1",
      });
    });
  },
};

export const DeepServerDirectory = {
  render: () => dialog({ initialLocation: { directory: "/mnt/team/experimental/service" } }),
};

export const LoadingDirectory = {
  render: () => dialog({ listDirectory: loadingListDirectory }),
};

export const DirectoryListingFailure: Story = {
  render: () =>
    dialog({
      listDirectory: () => Promise.reject(new Error("The directory could not be loaded.")),
    }),
  play: async () => {
    const currentDialog = await screen.findByRole("dialog", { name: "Add project" });
    const canvas = within(currentDialog);
    const retry = await canvas.findByRole("button", { name: "Retry" });
    await expect(canvas.getByText("/srv/projects", { exact: true })).toBeVisible();
    await expect(canvas.getByText("Not listed")).toBeVisible();
    await expect(canvas.getByRole("alert")).toHaveTextContent("Could not list /srv/projects.");
    await expect(canvas.getByRole("button", { name: "Add project" })).toBeDisabled();
    await expect(
      canvas.queryByRole("button", { name: "Back to previous successfully listed directory" }),
    ).toBeNull();
    await userEvent.tab();
    await expect(canvas.getByRole("button", { name: "Go to parent directory" })).toHaveFocus();
    await userEvent.tab();
    await expect(retry).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await canvas.findByText("Not listed");
    await expect(canvas.getByRole("button", { name: "Add project" })).toBeDisabled();
  },
};

const recoveryOnAddProject = fn<(location: LocationRef) => void>();

export const NavigationFailureRecovery: Story = {
  render: () => {
    let childAttempts = 0;
    return dialog({
      initialLocation: { directory: "/srv/projects", workspaceID: "workspace-1" },
      listDirectory: (input) => {
        if (input?.path === "/srv/projects/oc-ui" && ++childAttempts <= 2) {
          return Promise.reject(new Error("Directory unavailable."));
        }
        return listDirectory(input);
      },
      onAddProject: recoveryOnAddProject,
    });
  },
  play: async ({ step }) => {
    recoveryOnAddProject.mockClear();
    const currentDialog = await screen.findByRole("dialog", { name: "Add project" });
    const canvas = within(currentDialog);
    const parent = canvas.getByRole("button", { name: "Go to parent directory" });
    await step("Identify the failed child and retry it with keyboard focus", async () => {
      await userEvent.click(await canvas.findByRole("button", { name: "Browse directory oc-ui" }));
      const retry = await canvas.findByRole("button", { name: "Retry" });
      await expect(canvas.getByText("/srv/projects/oc-ui", { exact: true })).toBeVisible();
      await expect(canvas.getByRole("alert")).toHaveTextContent(
        "Could not list /srv/projects/oc-ui.",
      );
      await expect(canvas.getByRole("button", { name: "Add project" })).toBeDisabled();
      await expect(parent).toBeEnabled();
      await waitFor(() => expect(retry).toHaveFocus());
      await userEvent.keyboard("{Enter}");
      await canvas.findByText("Not listed");
    });
    await step("Back re-lists the previous directory and restores browsing", async () => {
      const back = canvas.getByRole("button", {
        name: "Back to previous successfully listed directory",
      });
      await userEvent.tab({ shift: true });
      await expect(back).toHaveFocus();
      await userEvent.keyboard("{Enter}");
      await canvas.findByRole("button", { name: "Browse directory oc-ui" });
      await expect(canvas.getByText("/srv/projects", { exact: true })).toBeVisible();
      await expect(canvas.queryByRole("alert")).toBeNull();
      await waitFor(() => expect(parent).toHaveFocus());
    });
    await step("A subsequent child listing succeeds and submits its full location", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Browse directory oc-ui" }));
      await canvas.findByText("No child directories.");
      await userEvent.click(canvas.getByRole("button", { name: "Add project" }));
      await expect(recoveryOnAddProject).toHaveBeenCalledWith({
        directory: "/srv/projects/oc-ui",
        workspaceID: "workspace-1",
      });
    });
  },
};

export const NavigationFailure: Story = {
  render: NavigationFailureRecovery.render,
  play: async () => {
    const currentDialog = await screen.findByRole("dialog", { name: "Add project" });
    const canvas = within(currentDialog);
    await userEvent.click(await canvas.findByRole("button", { name: "Browse directory oc-ui" }));
    await canvas.findByText("Not listed");
  },
};

const longFailedDirectory = `/srv/${Array.from({ length: 24 }, () => "remote_workspace_segment").join("/")}`;
const longListingDiagnostic =
  "Directory unavailable. " +
  "The remote workspace could not be listed; check access before retrying. ".repeat(24) +
  "End of directory listing diagnostic.";
const longDirectoryList = fn<OpenCodeClient["file"]["list"]>(() =>
  Promise.reject(new Error(longListingDiagnostic)),
);
const longDirectoryOnAddProject = fn<(location: LocationRef) => void>();

export const LongDirectoryListingFailure: Story = {
  parameters: {
    viewport: {
      options: {
        short360x480: {
          name: "Short 360 × 480",
          styles: { width: "360px", height: "480px" },
        },
      },
    },
  },
  globals: { theme: "light", viewport: { value: "short360x480", isRotated: false } },
  render: () => {
    longDirectoryList.mockClear();
    longDirectoryOnAddProject.mockClear();
    return dialog({
      initialLocation: { directory: longFailedDirectory, workspaceID: "workspace-1" },
      listDirectory: longDirectoryList,
      onAddProject: longDirectoryOnAddProject,
    });
  },
  play: async ({ step }) => {
    const currentDialog = await screen.findByRole("dialog", { name: "Add project" });
    const canvas = within(currentDialog);
    const retry = await canvas.findByRole("button", { name: "Retry" });
    const browser = canvas
      .getByRole("region", { name: "Project directory" })
      .querySelector<HTMLElement>(".server-directory-browser");
    if (!browser) throw new Error("Project directory browser did not render");
    const alert = canvas.getByRole("alert");
    const diagnostic = alert.querySelector<HTMLSpanElement>("span");
    const header = browser.querySelector<HTMLElement>(".server-directory-browser-header");
    const path = canvas.getByText(longFailedDirectory, { exact: true });
    const body = currentDialog.querySelector<HTMLElement>('[data-slot="dialog-body"]');
    const container = currentDialog.closest<HTMLElement>('[data-slot="dialog-container"]');
    if (!diagnostic || !header || !body || !container) {
      throw new Error("Directory listing diagnostic did not render");
    }
    const range = alert.ownerDocument.createRange();
    range.selectNodeContents(diagnostic);
    const visibleBounds = (scroller = alert) => {
      const regions = [scroller, browser, body, currentDialog, container].map((element) =>
        element.getBoundingClientRect(),
      );
      return {
        top: Math.max(0, ...regions.map((bounds) => bounds.top)),
        bottom: Math.min(window.innerHeight, ...regions.map((bounds) => bounds.bottom)),
        left: Math.max(0, ...regions.map((bounds) => bounds.left)),
        right: Math.min(window.innerWidth, ...regions.map((bounds) => bounds.right)),
      };
    };

    await step("Read the full header path within its allocated browser-height budget", async () => {
      const pathRange = header.ownerDocument.createRange();
      pathRange.selectNodeContents(path);
      const statePosition = alert.scrollTop;
      await expect(header.scrollHeight).toBeGreaterThan(header.clientHeight);
      header.scrollTop = 0;
      await waitFor(async () => {
        const bounds = visibleBounds(header);
        const first = pathRange.getClientRects()[0]!;
        const budget = Math.max(36, Math.min(browser.clientHeight * 0.35, 120));
        await expect(header.getBoundingClientRect().height).toBeLessThanOrEqual(budget + 1);
        await expect(alert.clientHeight).toBeGreaterThan(32);
        await expect(header.scrollTop).toBe(0);
        await expect(first.top).toBeGreaterThanOrEqual(bounds.top);
        await expect(first.bottom).toBeLessThanOrEqual(bounds.bottom);
        await expect(first.left).toBeGreaterThanOrEqual(bounds.left);
        await expect(first.right).toBeLessThanOrEqual(bounds.right);
      });
      header.scrollTop = header.scrollHeight;
      await waitFor(async () => {
        const bounds = visibleBounds(header);
        const lines = pathRange.getClientRects();
        const last = lines[lines.length - 1]!;
        await expect(header.scrollTop).toBeGreaterThan(0);
        await expect(last.top).toBeGreaterThanOrEqual(bounds.top);
        await expect(last.bottom).toBeLessThanOrEqual(bounds.bottom);
        await expect(last.left).toBeGreaterThanOrEqual(bounds.left);
        await expect(last.right).toBeLessThanOrEqual(bounds.right);
        await expect(alert.scrollTop).toBe(statePosition);
      });
    });

    await step("Read the complete diagnostic from its first fragment to its last", async () => {
      await expect(window.innerWidth).toBe(360);
      await expect(window.innerHeight).toBe(480);
      await expect(canvas.getByText(longFailedDirectory, { exact: true })).toBeVisible();
      await expect(alert).toHaveTextContent(
        `Could not list ${longFailedDirectory}. ${longListingDiagnostic}`,
      );
      await expect(alert.scrollHeight).toBeGreaterThan(alert.clientHeight);
      const headerPosition = header.scrollTop;
      alert.scrollTop = 0;
      await waitFor(async () => {
        const bounds = visibleBounds();
        const first = range.getClientRects()[0]!;
        await expect(alert.clientHeight).toBeGreaterThan(32);
        await expect(alert.scrollTop).toBe(0);
        await expect(first.top).toBeGreaterThanOrEqual(bounds.top);
        await expect(first.bottom).toBeLessThanOrEqual(bounds.bottom);
        await expect(first.left).toBeGreaterThanOrEqual(bounds.left);
        await expect(first.right).toBeLessThanOrEqual(bounds.right);
      });
      alert.scrollTop = alert.scrollHeight;
      await waitFor(async () => {
        const bounds = visibleBounds();
        const lines = range.getClientRects();
        const last = lines[lines.length - 1]!;
        await expect(alert.scrollTop).toBeGreaterThan(0);
        await expect(last.top).toBeGreaterThanOrEqual(bounds.top);
        await expect(last.bottom).toBeLessThanOrEqual(bounds.bottom);
        await expect(last.left).toBeGreaterThanOrEqual(bounds.left);
        await expect(last.right).toBeLessThanOrEqual(bounds.right);
        await expect(header.scrollTop).toBe(headerPosition);
      });
    });

    await step(
      "Keyboard focus reveals the header control without moving the diagnostic",
      async () => {
        const statePosition = alert.scrollTop;
        retry.focus({ preventScroll: true });
        await userEvent.tab({ shift: true });
        const parent = canvas.getByRole("button", { name: "Go to parent directory" });
        await expect(parent).toHaveFocus();
        await waitFor(async () => {
          const bounds = visibleBounds(header);
          const control = parent.getBoundingClientRect();
          await expect(control.top).toBeGreaterThanOrEqual(bounds.top);
          await expect(control.bottom).toBeLessThanOrEqual(bounds.bottom);
          await expect(control.left).toBeGreaterThanOrEqual(bounds.left);
          await expect(control.right).toBeLessThanOrEqual(bounds.right);
          await expect(
            parent.contains(
              document.elementFromPoint(
                control.left + control.width / 2,
                control.top + control.height / 2,
              ),
            ),
          ).toBe(true);
          await expect(alert.scrollTop).toBe(statePosition);
        });
      },
    );

    await step("Keyboard focus reveals Retry inside the visible listing bounds", async () => {
      await expect(canvas.getByRole("button", { name: "Add project" })).toBeDisabled();
      await expect(
        canvas.queryByRole("button", { name: "Back to previous successfully listed directory" }),
      ).toBeNull();
      canvas.getByRole("button", { name: "Go to parent directory" }).focus({ preventScroll: true });
      await userEvent.tab();
      await expect(retry).toHaveFocus();
      await waitFor(async () => {
        const bounds = visibleBounds();
        const control = retry.getBoundingClientRect();
        await expect(browser.scrollWidth).toBeLessThanOrEqual(browser.clientWidth);
        await expect(control.left).toBeGreaterThanOrEqual(bounds.left);
        await expect(control.right).toBeLessThanOrEqual(bounds.right);
        await expect(control.top).toBeGreaterThanOrEqual(bounds.top);
        await expect(control.bottom).toBeLessThanOrEqual(bounds.bottom);
        await expect(
          retry.contains(
            document.elementFromPoint(
              control.left + control.width / 2,
              control.top + control.height / 2,
            ),
          ),
        ).toBe(true);
      });
    });

    await step("Retry the same unlisted location with pointer and keyboard", async () => {
      await userEvent.click(retry);
      const pointerRetry = await canvas.findByRole("button", { name: "Retry" });
      await expect(pointerRetry).not.toBe(retry);
      await waitFor(() => expect(pointerRetry).toHaveFocus());
      await userEvent.keyboard("{Enter}");
      await canvas.findByText("Not listed");
      await expect(longDirectoryList).toHaveBeenCalledTimes(3);
      await expect(longDirectoryList).toHaveBeenLastCalledWith(
        {
          location: { directory: longFailedDirectory, workspace: "workspace-1" },
          path: longFailedDirectory,
        },
        { signal: expect.any(AbortSignal) },
      );
      await expect(canvas.getByRole("button", { name: "Add project" })).toBeDisabled();
    });

    await step("Header scrolling preserves the recovered directory list position", async () => {
      longDirectoryList.mockResolvedValueOnce(
        response(
          longFailedDirectory,
          Array.from({ length: 24 }, (_, index) => `project-${index}`),
          "workspace-1",
        ),
      );
      await userEvent.click(canvas.getByRole("button", { name: "Retry" }));
      await canvas.findByRole("button", { name: "Browse directory project-23" });
      const entries = canvas.getByRole("list", { name: "Directories" });
      await expect(entries.scrollHeight).toBeGreaterThan(entries.clientHeight);
      entries.scrollTop = entries.scrollHeight;
      const listPosition = entries.scrollTop;
      await expect(listPosition).toBeGreaterThan(0);
      header.scrollTop = 0;
      await expect(entries.scrollTop).toBe(listPosition);
      header.scrollTop = header.scrollHeight;
      await waitFor(async () => {
        await expect(header.scrollTop).toBeGreaterThan(0);
        await expect(entries.scrollTop).toBe(listPosition);
      });
      const parent = canvas.getByRole("button", { name: "Go to parent directory" });
      parent.focus();
      await expect(parent).toHaveFocus();
      await expect(entries.scrollTop).toBe(listPosition);
      await userEvent.click(canvas.getByRole("button", { name: "Add project" }));
      await expect(longDirectoryOnAddProject).toHaveBeenCalledWith({
        directory: longFailedDirectory,
        workspaceID: "workspace-1",
      });
    });
  },
};

export const LongDirectoryListingFailureDark: Story = {
  ...LongDirectoryListingFailure,
  globals: { theme: "dark", viewport: { value: "short360x480", isRotated: false } },
};

export const ValidationFailure = {
  render: () =>
    dialog({
      error: { kind: "validation", message: "This directory cannot be added as a project." },
    }),
};

export const AddProjectFailure = {
  render: () =>
    dialog({
      error: { kind: "add-project", message: "The server could not add this project." },
    }),
};

export const AddingProject = {
  render: () => dialog({ adding: true }),
};

export const NarrowDirectoryBrowser = {
  globals: { viewport: { value: "mobile", isRotated: false } },
  render: () =>
    dialog({
      initialLocation: {
        directory: "/mnt/team/experimental/services/renderer-infrastructure",
      },
    }),
};

export const FocusedOperationError = {
  render: () =>
    dialog({
      error: {
        kind: "add-project",
        message:
          "The server could not add the selected project directory. Check access and try again.",
      },
    }),
};
