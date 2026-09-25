import type { PermissionRequest, SessionInfo } from "@opencode/client";

import { sessionFixture } from "../../src/renderer/test/session-fixture.ts";
import type { LabActivityItem } from "./lab-fixtures.ts";

/* Moment A — "Back after two hours": many sessions, mixed attention kinds. */

export type SupervisionAttentionKind = "permission" | "question" | "success" | "failed";

export const labSupervisionNow = 1_756_000_000_000;

const minutesAgo = (count: number) => labSupervisionNow - count * 60 * 1000;
const hoursAgo = (count: number) => labSupervisionNow - count * 60 * 60 * 1000;
const daysAgo = (count: number) => labSupervisionNow - count * 24 * 60 * 60 * 1000;

const OC_UI = "/Users/alex/code/oc-ui";
const FLAKY_WORKTREE = `${OC_UI}/.worktrees/flaky-scroll`;
const RELEASE_WORKTREE = `${OC_UI}/.worktrees/release-audit`;
const DOCS = "/Users/alex/sites/docs";

function supervisionSession(
  id: string,
  title: string,
  updated: number,
  directory: string,
  parentID?: string,
): SessionInfo {
  return sessionFixture({
    id,
    title,
    parentID,
    projectID: directory === DOCS ? "docs" : "oc-ui",
    location: { directory },
    time: { created: updated, updated },
  });
}

export const labSupervisionSessions: readonly SessionInfo[] = [
  supervisionSession("audit", "Release notes audit", minutesAgo(1), OC_UI),
  supervisionSession("changelog", "Update changelog", minutesAgo(6), OC_UI, "releases"),
  supervisionSession("flaky", "Fix flaky scroll test", minutesAgo(3), FLAKY_WORKTREE),
  supervisionSession("onboarding", "Onboarding docs", minutesAgo(12), DOCS),
  supervisionSession("e2e-fix", "Stabilize e2e suite", minutesAgo(25), OC_UI),
  supervisionSession("typeramp", "Type ramp follow-ups", minutesAgo(40), OC_UI),
  supervisionSession("audit-wt", "Release notes audit", minutesAgo(8), RELEASE_WORKTREE),
  supervisionSession("docs-sweep", "Docs sweep", minutesAgo(50), DOCS),
  supervisionSession("composer-cleanup", "Composer cleanup", hoursAgo(1), OC_UI),
  supervisionSession("dialog-focus", "Dialog focus review", hoursAgo(1.3), OC_UI),
  supervisionSession("browser-pane", "Browser pane polish", hoursAgo(1.7), OC_UI),
  supervisionSession("releases", "Release prep", hoursAgo(2), OC_UI),
  supervisionSession("worktree", "Worktree migration", daysAgo(1), OC_UI),
  supervisionSession("theme-review", "Theme review", daysAgo(2), OC_UI),
  supervisionSession("server-flows", "Server flow dialogs", daysAgo(3), OC_UI),
  supervisionSession("markdown-tables", "Markdown tables", daysAgo(4), OC_UI),
  supervisionSession("permissions-copy", "Permissions copy", daysAgo(5), OC_UI),
  supervisionSession("m1-shell", "Shell layout", daysAgo(12), OC_UI),
  supervisionSession("m2-sidecar", "Sidecar lifecycle", daysAgo(20), OC_UI),
  supervisionSession("requirements", "Product requirements", daysAgo(30), DOCS),
];

export const labSupervisionAttention: ReadonlyMap<string, SupervisionAttentionKind> = new Map([
  ["audit", "permission"],
  ["flaky", "permission"],
  ["onboarding", "question"],
  ["changelog", "success"],
  ["typeramp", "success"],
  ["e2e-fix", "failed"],
]);

export const labSupervisionPermissions: ReadonlyMap<string, PermissionRequest> = new Map([
  [
    "audit",
    {
      id: "per_release_push",
      sessionID: "audit",
      action: "run command",
      resources: ["git push origin release"],
      save: ["git push origin release"],
      message: "The audit is finished. Publishing the release branch is the next step.",
      source: { type: "tool", messageID: "msg_audit", id: "tool_push" },
    },
  ],
  [
    "flaky",
    {
      id: "per_flaky_run",
      sessionID: "flaky",
      action: "run command",
      resources: ["pnpm test -- --project storybook"],
      save: ["pnpm test*"],
      message: "The scroll test fix is ready; running the storybook project verifies it.",
      source: { type: "tool", messageID: "msg_flaky", id: "tool_test" },
    },
  ],
]);

export const labSupervisionQuestion = {
  sessionID: "onboarding",
  title: "Which package manager should the docs site use?",
  detail:
    "The new site is scaffolded; the install step needs a decision before the agent continues.",
  options: ["pnpm (matches oc-ui)", "npm (matches the old docs repo)", "Let the agent choose"],
};

const auditActivity: readonly LabActivityItem[] = [
  {
    id: "sr1",
    kind: "reasoning",
    name: "reasoning",
    parameter: "the notes are current; only the layout section is stale",
    status: "completed",
  },
  { id: "s1", name: "read", parameter: "RELEASE.md", status: "completed" },
  { id: "s2", name: "apply_patch", parameter: "RELEASE.md", status: "completed" },
  { id: "s3", name: "pnpm check", parameter: "", status: "completed" },
];

const flakyActivity: readonly LabActivityItem[] = [
  {
    id: "fr1",
    kind: "reasoning",
    name: "reasoning",
    parameter: "the flake is in the scroll anchor test, not the runner",
    status: "completed",
  },
  { id: "f1", name: "read", parameter: "scroll-preservation.test.ts", status: "completed" },
  { id: "f2", name: "apply_patch", parameter: "scroll-preservation.test.ts", status: "completed" },
  { id: "f3", name: "pnpm test", parameter: "--project unit", status: "completed" },
];

const docsActivity: readonly LabActivityItem[] = [
  {
    id: "dr1",
    kind: "reasoning",
    name: "reasoning",
    parameter: "the install step is the only unresolved piece",
    status: "completed",
  },
  { id: "d1", name: "read", parameter: "docs/index.md", status: "completed" },
  { id: "d2", name: "grep", parameter: "install", status: "completed" },
];

const e2eActivity: readonly LabActivityItem[] = [
  {
    id: "er1",
    kind: "reasoning",
    name: "reasoning",
    parameter: "the selectors are likely stale after the rewrite",
    status: "completed",
  },
  { id: "e1", name: "read", parameter: "browser.test.mjs", status: "completed" },
  { id: "e2", name: "apply_patch", parameter: "browser.test.mjs", status: "completed" },
  {
    id: "e3",
    name: "pnpm test",
    parameter: "--project web",
    status: "failed",
    output: [
      "test/e2e/browser.test.mjs > submits annotations and reviews",
      "  Error: locator.fill: Timeout 30000ms exceeded",
      '    waiting for getByLabel("Comment on working.txt")',
      "1 failed, 25 passed",
    ].join("\n"),
  },
];

const plainActivity: readonly LabActivityItem[] = [
  { id: "p1", name: "read", parameter: "src/renderer", status: "completed" },
  { id: "p2", name: "apply_patch", parameter: "Composer.css", status: "completed" },
];

export type SupervisionRecord = {
  readonly instruction: string;
  readonly prose: string;
  readonly activity: readonly LabActivityItem[];
  readonly summary: {
    readonly headline: string;
    readonly detail: string;
    readonly next: string;
    readonly tone?: "default" | "danger";
  };
};

const fallbackRecord: SupervisionRecord = {
  instruction: "Continue the current task.",
  prose: "The last turn finished cleanly. Nothing here needs your attention right now.",
  activity: plainActivity,
  summary: {
    headline: "Idle",
    detail: "No pending requests and no unread output in this session.",
    next: "Nothing to do",
  },
};

const labSupervisionRecords: ReadonlyMap<string, SupervisionRecord> = new Map([
  [
    "audit",
    {
      instruction:
        "Review the release notes, fix what the layout pass missed, and tell me what still needs a decision before we publish.",
      prose:
        "The layout pass is applied and the check passed on the re-run. Publishing the release branch is the only thing left.",
      activity: auditActivity,
      summary: {
        headline: "Implemented and verified",
        detail: "The layout pass is applied and the check passed on the re-run.",
        next: "Approve or reject git push origin release",
      },
    },
  ],
  [
    "flaky",
    {
      instruction: "Fix the flaky scroll test and verify it with the storybook project.",
      prose:
        "The scroll test fix is in and the unit project is green. The storybook run needs your approval because it touches the shared test database.",
      activity: flakyActivity,
      summary: {
        headline: "Fix applied, verification waiting",
        detail: "Unit tests pass; the storybook run is blocked on the permission below.",
        next: "Approve or reject pnpm test -- --project storybook",
      },
    },
  ],
  [
    "onboarding",
    {
      instruction: "Scaffold the new docs site and wire up the install step.",
      prose:
        "The site is scaffolded. I stopped before installing dependencies because the repo history points at two different package managers.",
      activity: docsActivity,
      summary: {
        headline: "Blocked on a question",
        detail: "The install step needs a package manager before work can continue.",
        next: "Answer the question below",
      },
    },
  ],
  [
    "changelog",
    {
      instruction: "Update the changelog for the release branch.",
      prose: "The changelog now covers the layout pass and the review mode. No blockers.",
      activity: plainActivity,
      summary: {
        headline: "Changelog updated",
        detail: "Entries added for the layout pass and the review mode.",
        next: "Read the changelog when convenient",
      },
    },
  ],
  [
    "typeramp",
    {
      instruction: "Follow up on the type ramp review notes.",
      prose:
        "All follow-ups are applied: the label role replaced the last kickers, and the catalog documents the new scale.",
      activity: plainActivity,
      summary: {
        headline: "Follow-ups complete",
        detail: "The label role replaced the remaining kickers and the catalog is updated.",
        next: "Review when convenient",
      },
    },
  ],
  [
    "e2e-fix",
    {
      instruction: "Stabilize the e2e suite after the browser test rewrite.",
      prose:
        "I fixed two selectors, but the web project still fails on the annotation flow. I stopped rather than guess at the cause.",
      activity: e2eActivity,
      summary: {
        headline: "Still failing",
        tone: "danger",
        detail:
          "Two selectors are fixed; the annotation flow still times out and was not resolved.",
        next: "Decide whether to retry or inspect the failing flow",
      },
    },
  ],
]);

export function supervisionRecord(id: string): SupervisionRecord {
  return labSupervisionRecords.get(id) ?? fallbackRecord;
}
