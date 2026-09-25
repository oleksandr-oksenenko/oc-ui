import type { SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client";

import { assistant } from "../transcript-catalog-fixtures.ts";

// Give the workspace showcase a long, varied activity list for inspecting its
// bounded scroll area. The opening prose remains the annotation source.
const original = assistant("assistant-1");

const toolRuns = [
  ["glob", { pattern: "docs/releases/*.md" }, "Found 3 release notes."],
  ["read", { path: "/workspace/docs/releases/current.md" }, "Loaded release notes."],
  ["grep", { pattern: "breaking|migration", path: "docs/releases" }, "2 migration notes."],
  ["bash", { command: "git status --short" }, "Working tree has 4 changed files."],
  ["bash", { command: "git diff --stat" }, "4 files changed, 48 insertions, 44 deletions."],
  ["read", { path: "/workspace/lazygit/config.yml" }, "Checked pager configuration."],
  ["grep", { pattern: "diffRenderers", path: "lazygit" }, "Found the renamed setting."],
  ["read", { path: "/workspace/nix/hosts/personal/flake.lock" }, "Checked lockfile inputs."],
  ["bash", { command: "pnpm check" }, "Type checking and lint passed."],
  ["glob", { pattern: "src/**/*.test.tsx" }, "Found component test coverage."],
  ["read", { path: "/workspace/src/components/SessionList.test.tsx" }, "Reviewed session tests."],
  ["read", { path: "/workspace/src/components/Composer.test.tsx" }, "Reviewed composer tests."],
  ["grep", { pattern: "release", path: "src/components" }, "No release blockers found."],
  ["bash", { command: "pnpm build" }, "Build completed."],
  ["bash", { command: "git diff --check" }, "No whitespace errors."],
] as const;

export const showcaseActivityAssistant: SessionMessageInfo =
  original.type === "assistant"
    ? {
        ...original,
        content: [
          ...original.content.slice(0, 2),
          ...toolRuns.map(([name, input, output], index): SessionMessageAssistantTool => ({
            type: "tool",
            id: `assistant-1-showcase-tool-${index + 1}`,
            name,
            time: { created: 2 + index / 100, ran: 2 + index / 100, completed: 2 + index / 100 },
            state: {
              status: "completed",
              input,
              content: [{ type: "text", text: output }],
            },
          })),
          ...original.content.slice(2),
        ],
      }
    : original;
