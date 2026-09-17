/* oxlint-disable effecttsgo/async-function -- Standalone comparison CLI awaits filesystem reads without an application runtime. */

// Compare two apps/desktop/scripts/profile-transcripts.mjs result files. Both must come from
// the same browser version and viewport, and each run group must have rendered
// the same number of messages, or the comparison refuses to report deltas.
//
// Usage: node apps/desktop/scripts/compare-transcript-profiles.mjs BEFORE.json AFTER.json

import { readFile } from "node:fs/promises";

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) {
  throw new Error(
    "Usage: node apps/desktop/scripts/compare-transcript-profiles.mjs BEFORE.json AFTER.json",
  );
}
const before = JSON.parse(await readFile(beforePath, "utf8"));
const after = JSON.parse(await readFile(afterPath, "utf8"));
if (
  before.browser !== after.browser ||
  JSON.stringify(before.viewport) !== JSON.stringify(after.viewport)
) {
  throw new Error("Browser version or viewport differs; these runs are not directly comparable");
}

function median(values) {
  const sorted = [...values].toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function summarize(result) {
  const groups = new Map();
  for (const run of result.runs) {
    const key = run.label.replace(/-\d+$/, "");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(run);
  }
  return Object.fromEntries(
    [...groups].map(([key, runs]) => [
      key,
      {
        samples: runs.length,
        firstFrameMs: median(runs.map((run) => run.firstFrameMs)),
        loadedFrameMs: median(runs.map((run) => run.loadedFrameMs)),
        settledMs: median(runs.map((run) => run.settledMs)),
        maxFrameGapMs: median(runs.map((run) => run.maxFrameGapMs)),
        maxLongTaskMs: median(
          runs.map((run) => Math.max(0, ...run.longTasks.map((task) => task.duration))),
        ),
        messageCounts: [...new Set(runs.map((run) => run.messageElements))],
        messageRequests: [
          ...new Set(
            runs.map(
              (run) =>
                run.resources.filter((resource) => resource.url.includes("/message?")).length,
            ),
          ),
        ],
      },
    ]),
  );
}

const a = summarize(before);
const b = summarize(after);
const comparison = {};
for (const key of Object.keys(a)) {
  if (!b[key]) throw new Error(`Missing after group: ${key}`);
  if (JSON.stringify(a[key].messageCounts) !== JSON.stringify(b[key].messageCounts)) {
    throw new Error(
      `Rendered message counts differ for ${key}; inspect transcript coverage before comparing timings`,
    );
  }
  comparison[key] = {
    before: a[key],
    after: b[key],
    improvementPercent: Object.fromEntries(
      ["firstFrameMs", "loadedFrameMs", "settledMs", "maxFrameGapMs"].map((metric) => [
        metric,
        Math.round((1 - b[key][metric] / a[key][metric]) * 1000) / 10,
      ]),
    ),
  };
}
console.log(
  JSON.stringify({ browser: before.browser, viewport: before.viewport, comparison }, null, 2),
);
