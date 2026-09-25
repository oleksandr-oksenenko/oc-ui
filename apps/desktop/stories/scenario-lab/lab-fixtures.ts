import type { PermissionRequest, SessionInfo } from "@opencode/client";

import type { DiffFileData } from "../../src/renderer/components/App/ConnectedApp/Changes/ContextPanel/DiffView/DiffFile.tsx";
import { sessionFixture } from "../../src/renderer/test/session-fixture.ts";

/* Fixed story clock keeps the sidebar grouping deterministic. */
export const labNow = 1_756_000_000_000;

const minutes = (count: number) => labNow - count * 60 * 1000;
const hours = (count: number) => labNow - count * 60 * 60 * 1000;
const days = (count: number) => labNow - count * 24 * 60 * 60 * 1000;

function labSession(id: string, title: string, updated: number, parentID?: string): SessionInfo {
  return sessionFixture({
    id,
    title,
    parentID,
    projectID: "oc-ui",
    location: { directory: "/Users/alex/code/oc-ui" },
    time: { created: updated, updated },
  });
}

export const labSessions: readonly SessionInfo[] = [
  labSession("audit", "Release notes audit", minutes(1)),
  labSession("changelog", "Update changelog", minutes(6), "audit"),
  labSession("flaky", "Fix flaky scroll test", minutes(3)),
  labSession("worktree", "Worktree migration", minutes(52)),
  labSession("fixtures", "Fixtures", hours(5), "worktree"),
  labSession("typeramp", "Type ramp follow-ups", days(12)),
];

export const labDiffFiles: readonly DiffFileData[] = [
  {
    file: "apps/desktop/src/renderer/styles/foundations.css",
    additions: 2,
    deletions: 0,
    status: "modified",
    patch: `diff --git a/apps/desktop/src/renderer/styles/foundations.css b/apps/desktop/src/renderer/styles/foundations.css
--- a/apps/desktop/src/renderer/styles/foundations.css
+++ b/apps/desktop/src/renderer/styles/foundations.css
@@ -54,3 +54,5 @@
   --oc-radius: 6px;
   --oc-radius-card: 10px;
+  --oc-radius-panel: 12px;
   --oc-radius-full: 9999px;
+  --oc-motion-duration: 140ms;
`,
  },
  {
    file: "apps/desktop/src/renderer/components/App/ConnectedApp/Conversation/SessionPane/Composer/Composer.css",
    additions: 4,
    deletions: 3,
    status: "modified",
    patch: `diff --git a/apps/desktop/src/renderer/components/App/ConnectedApp/Conversation/SessionPane/Composer/Composer.css b/apps/desktop/src/renderer/components/App/ConnectedApp/Conversation/SessionPane/Composer/Composer.css
--- a/apps/desktop/src/renderer/components/App/ConnectedApp/Conversation/SessionPane/Composer/Composer.css
+++ b/apps/desktop/src/renderer/components/App/ConnectedApp/Conversation/SessionPane/Composer/Composer.css
@@ -8,5 +8,6 @@
   min-height: 76px;
   margin: 0 auto 16px;
-  border: 1px solid var(--oc-border-strong);
-  border-radius: var(--oc-radius);
-  background: var(--oc-surface-raised);
+  border: 1px solid var(--oc-border-base);
+  border-radius: var(--oc-radius-panel);
+  background: var(--oc-surface-canvas);
+  box-shadow: var(--oc-shadow-lift);
`,
  },
  {
    file: "apps/desktop/stories/scenario-lab/ScenarioLab.tsx",
    additions: 7,
    deletions: 0,
    status: "added",
    patch: `diff --git a/apps/desktop/stories/scenario-lab/ScenarioLab.tsx b/apps/desktop/stories/scenario-lab/ScenarioLab.tsx
new file mode 100644
--- /dev/null
+++ b/apps/desktop/stories/scenario-lab/ScenarioLab.tsx
@@ -0,0 +1,7 @@
+export function WorkbenchReturn() {
+  return <div class="lab-workbench">…</div>;
+}
+
+export function NotebookReturn() {
+  return <article class="lab-notebook-page">…</article>;
+}
`,
  },
  {
    file: "apps/desktop/test/e2e/browser.test.mjs",
    additions: 4,
    deletions: 2,
    status: "modified",
    patch: `diff --git a/apps/desktop/test/e2e/browser.test.mjs b/apps/desktop/test/e2e/browser.test.mjs
--- a/apps/desktop/test/e2e/browser.test.mjs
+++ b/apps/desktop/test/e2e/browser.test.mjs
@@ -494,3 +494,5 @@
   it("switches palettes without replacing the workspace", async () => {
-    await page.getByRole("button", { name: "Switch to dark theme" }).click();
-    await expect.poll(() => scheme()).toBe("dark");
+    await page.getByRole("button", { name: "Switch to dark theme" }).click();
+    await expect.poll(() => scheme()).toBe("dark");
+    await page.getByRole("button", { name: "Switch to light theme" }).click();
+    await expect.poll(() => scheme()).toBe("light");
`,
  },
];

export const labPermission = {
  id: "per_release_push",
  sessionID: "audit",
  action: "run command",
  resources: ["git push origin release"],
  save: ["git push origin release"],
  message: "The audit is finished. Publishing the release branch is the next step.",
  source: { type: "tool", messageID: "msg_audit", id: "tool_push" },
} satisfies PermissionRequest;

export const labFlakyPermission = {
  id: "per_flaky_run",
  sessionID: "flaky",
  action: "run command",
  resources: ["pnpm test -- --project storybook"],
  save: ["pnpm test*"],
  message: "The scroll test fix is ready; running the storybook project verifies it.",
  source: { type: "tool", messageID: "msg_flaky", id: "tool_test" },
} satisfies PermissionRequest;

export type LabRun = {
  readonly sessionID: string;
  readonly title: string;
  readonly location: string;
  readonly state: "running" | "attention" | "idle" | "finished";
  readonly lastEvent: string;
  readonly changed: string;
};

export const labRuns: readonly LabRun[] = [
  {
    sessionID: "audit",
    title: "Release notes audit",
    location: "oc-ui",
    state: "running",
    lastEvent: "pnpm check · re-running",
    changed: "4 files",
  },
  {
    sessionID: "flaky",
    title: "Fix flaky scroll test",
    location: "oc-ui · worktree flaky-scroll",
    state: "attention",
    lastEvent: "Waiting for permission",
    changed: "1 file",
  },
  {
    sessionID: "worktree",
    title: "Worktree migration",
    location: "oc-ui",
    state: "idle",
    lastEvent: "Ready for review",
    changed: "6 files",
  },
  {
    sessionID: "changelog",
    title: "Update changelog",
    location: "oc-ui",
    state: "finished",
    lastEvent: "Finished · 2 changed files",
    changed: "2 files",
  },
  {
    sessionID: "typeramp",
    title: "Type ramp follow-ups",
    location: "oc-ui",
    state: "finished",
    lastEvent: "Finished · 1 failed check",
    changed: "3 files",
  },
];

type LabActivityStatus = "completed" | "failed" | "running";

export type LabActivityItem = {
  readonly id: string;
  readonly name: string;
  readonly parameter?: string;
  readonly status: LabActivityStatus;
  /** Agent steps other than tool calls render as one-line reasoning notes. */
  readonly kind?: "tool" | "reasoning";
  /** Tool output shown under the row while the activity group is expanded. */
  readonly output?: string;
};

const checkFailureOutput = [
  "apps/desktop/stories/scenario-lab/ScenarioLab.tsx:46:7",
  "  error: Property 'lab' does not exist on type 'JSX.CSSProperties'.",
  "1 error, 0 warnings",
].join("\n");

export const labActivity: readonly LabActivityItem[] = [
  {
    id: "r1",
    kind: "reasoning",
    name: "reasoning",
    parameter: "compared the token layers before editing anything",
    status: "completed",
  },
  { id: "a1", name: "read", parameter: "styles/foundations.css", status: "completed" },
  { id: "a2", name: "read", parameter: "Composer/Composer.css", status: "completed" },
  { id: "a3", name: "grep", parameter: "oc-radius-card", status: "completed" },
  { id: "a4", name: "apply_patch", parameter: "foundations.css", status: "completed" },
  { id: "a5", name: "apply_patch", parameter: "Composer.css", status: "completed" },
  { id: "a6", name: "pnpm check", parameter: "", status: "failed", output: checkFailureOutput },
  {
    id: "r2",
    kind: "reasoning",
    name: "reasoning",
    parameter: "the failure is a missing story type, not a layout problem",
    status: "completed",
  },
  { id: "a7", name: "read", parameter: "Foundations.stories.tsx", status: "completed" },
  { id: "a8", name: "apply_patch", parameter: "ScenarioLab.tsx", status: "completed" },
  { id: "a9", name: "pnpm check", parameter: "", status: "completed" },
];

export const labStateSummary = {
  headline: "Implemented and verified",
  detail:
    "The layout pass is applied and the check passed on the re-run. One decision is left: publishing the release branch.",
  next: "Approve or reject git push origin release",
};

export const labInstruction =
  "Review the release notes, fix what the layout pass missed, and tell me what still needs a decision before we publish.";

export const labProseBefore =
  "I updated the token layer and the composer surface, then ran the check. Two files needed follow-up edits after the first run failed; the re-run is still in flight.";

export const labProseAfter =
  "The layout pass is applied. One decision is waiting: the audit wants to publish the release branch, and I have not touched the remote.";
