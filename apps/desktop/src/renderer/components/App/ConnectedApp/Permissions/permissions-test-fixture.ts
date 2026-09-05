/* oxlint-disable effecttsgo/async-function */

import type {
  PermissionRequest,
  PermissionSavedInfo,
  Project,
  SessionInfo,
} from "@opencode-ai/client";
import { createSignal } from "solid-js";
import { vi } from "vite-plus/test";

import { sessionFixture } from "../../../../test/session-fixture.ts";
import type { PermissionInboxEntry, PermissionsController } from "./createPermissions.ts";

export const project = (overrides: Partial<Project> = {}): Project => ({
  id: "project-one",
  canonical: "/srv/projects/one",
  name: "Project One",
  time: { created: 1, updated: 2 },
  sandboxes: [],
  ...overrides,
});

export const session = (overrides: Partial<SessionInfo> = {}): SessionInfo =>
  sessionFixture({
    id: "session-one",
    title: "Release work",
    location: { directory: "/srv/projects/one", workspaceID: "workspace-one" },
    ...overrides,
  });

export const request = (overrides: Partial<PermissionRequest> = {}): PermissionRequest => ({
  id: "permission-one",
  sessionID: "session-one",
  action: "read files",
  resources: ["/srv/projects/one/src/index.ts"],
  ...overrides,
});

export const rule = (overrides: Partial<PermissionSavedInfo> = {}): PermissionSavedInfo => ({
  id: "rule-one",
  projectID: "project-one",
  action: "read files",
  resource: "/srv/projects/one/**",
  ...overrides,
});

type State = "loading" | "ready" | "failed";

export function permissionsFixture(
  options: {
    readonly entries?: readonly PermissionInboxEntry[];
    readonly projects?: readonly Project[];
    readonly rules?: readonly PermissionSavedInfo[];
  } = {},
) {
  const [entries, setEntries] = createSignal<readonly PermissionInboxEntry[]>(
    options.entries ?? [{ session: session(), requests: [request()] }],
  );
  const [projects, setProjects] = createSignal<readonly Project[]>(options.projects ?? [project()]);
  const [rules, setRules] = createSignal<readonly PermissionSavedInfo[]>(options.rules ?? [rule()]);
  const [inboxState, setInboxState] = createSignal<State>("ready");
  const [inboxError, setInboxError] = createSignal<string>();
  const [savedState, setSavedState] = createSignal<State>("ready");
  const [savedError, setSavedError] = createSignal<string>();
  const [recoveryError, setRecoveryError] = createSignal<string>();
  const [pending, setPending] = createSignal(false);
  const [removing, setRemoving] = createSignal<string>();
  const [rowErrors, setRowErrors] = createSignal<ReadonlyMap<string, string>>(new Map());
  const inboxSync = vi.fn(async () => undefined);
  const savedSync = vi.fn(async () => undefined);
  const remove = vi.fn<PermissionsController["saved"]["remove"]>(async (ruleID) => {
    setRules((current) => current.filter((candidate) => candidate.id !== ruleID));
  });
  const value: PermissionsController = {
    requests: () => entries()[0]?.requests ?? [],
    state: inboxState,
    error: inboxError,
    recoveryError,
    pending,
    submitting: () => false,
    errorFor: () => undefined,
    sync: inboxSync,
    reply: vi.fn(async () => undefined),
    inbox: { entries, state: inboxState, error: inboxError, sync: inboxSync },
    saved: {
      rules,
      projects,
      state: savedState,
      error: savedError,
      removing: (ruleID) => removing() === ruleID,
      errorFor: (ruleID) => rowErrors().get(ruleID),
      sync: savedSync,
      remove,
    },
  };
  return {
    value,
    entries,
    projects,
    rules,
    inboxSync,
    savedSync,
    remove,
    setEntries,
    setProjects,
    setRules,
    setInboxState,
    setInboxError,
    setSavedState,
    setSavedError,
    setRecoveryError,
    setPending,
    setRemoving,
    setRowErrors,
  };
}
