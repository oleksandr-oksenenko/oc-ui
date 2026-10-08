// @vitest-environment node
/* oxlint-disable effecttsgo/any-unknown-in-error-context, effecttsgo/missing-effect-context, effecttsgo/layer-merge-all-with-dependencies -- Pinned core exposes JavaScript public entrypoints without declarations; its node replacements explicitly supply dependencies before this graph is merged. */
/* oxlint-disable effecttsgo/strict-effect-provide -- This test is the scoped entrypoint for its isolated service graph. */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Effect, Exit, Layer, Queue, Scope, Stream } from "effect";
import { TestClock } from "effect/testing";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { describe, expect, it } from "vite-plus/test";
import { Directory } from "@opencode/schema/config";
import { AbsolutePath } from "@opencode/schema/schema";
import { findPackage } from "../../../tools/opencode-runtime-packages.mjs";
import { createProfile } from "./e2e/profile.mjs";

// Exercise the exact core consumed by the pinned server, through public exports.
const desktop = fileURLToPath(new URL("../", import.meta.url));
const server = findPackage("@opencode/server", desktop);
const core = findPackage("@opencode/core", server);
const util = findPackage("@opencode/util", core);
const load = (root, path) => import(pathToFileURL(join(root, "dist", `${path}.js`)).href);
const [
  { Config },
  { ConfigAgentPlugin },
  { Agent },
  { Bus },
  { LayerNode },
  { FSUtil },
  { Global },
] = await Promise.all([
  load(core, "config"),
  load(core, "config/plugin/agent"),
  load(core, "agent"),
  load(core, "bus"),
  load(util, "effect/layer-node"),
  load(util, "fs-util"),
  load(util, "global"),
]);
const markdown = (hidden) => `---\nhidden: ${hidden}\n---\nFixture agent\n`;

describe("pinned Markdown-agent root invalidation", () => {
  it.each(["agent", "agents", "mode", "modes"])(
    "reloads %s on a root-only change and removes scoped listeners",
    async (spelling) => {
      const profile = await createProfile("ocui-config-agent-");
      const root = join(profile.paths.app, ".opencode");
      const file = join(root, spelling, "build.md");
      const globalLayer = Layer.succeed(
        Global.Service,
        Object.fromEntries(
          ["home", "data", "cache", "config", "state", "tmp", "bin", "log", "repos"].map((name) => [
            name,
            join(profile.root, name),
          ]),
        ),
      );
      let scans = 0;
      const filesystem = Layer.effect(
        FSUtil.Service,
        Effect.gen(function* () {
          const fs = yield* FSUtil.Service;
          return {
            ...fs,
            scan: (...args) => {
              scans++;
              return fs.scan(...args);
            },
          };
        }),
      ).pipe(Layer.provide(FSUtil.layer.pipe(Layer.provide(NodeFileSystem.layer))));
      const layer = Layer.mergeAll(
        globalLayer,
        LayerNode.compile(Agent.node, {
          replacements: [
            Global.node.replace(globalLayer),
            Bus.node.replace(Layer.succeed(Bus.Service, { publish: () => Effect.void })),
          ],
        }),
        Config.testLayer([new Directory({ type: "directory", path: AbsolutePath.make(root) })]),
        filesystem,
        TestClock.layer(),
      );
      try {
        await mkdir(join(root, spelling), { recursive: true });
        await writeFile(file, markdown(false));
        await Effect.runPromise(
          Effect.gen(function* () {
            const agent = yield* Agent.Service;
            const config = yield* Config.Test;
            const reloads = yield* Queue.unbounded();
            yield* agent.transform((editor) => {
              editor.update(Agent.ID.make("build"), () => {});
            });
            const scope = yield* Scope.make();
            yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
            yield* ConfigAgentPlugin.Plugin.effect({
              agent: {
                transform: agent.transform,
                reload: () => agent.reload().pipe(Effect.andThen(Queue.offer(reloads, undefined))),
              },
              // No config.updated notification can rescue a missed root invalidation.
              event: { subscribe: () => Stream.never },
            }).pipe(Effect.provideService(Scope.Scope, scope));
            expect((yield* agent.get(Agent.ID.make("build"))).hidden).toBe(false);

            yield* Effect.promise(() => writeFile(file, markdown(true)));
            for (const unrelated of [
              join(profile.paths.app, ".opencode-other"),
              join(root, "unrelated.txt"),
            ]) {
              const before = scans;
              yield* config.emitChange({ path: unrelated, type: "update" });
              yield* TestClock.adjust("101 millis");
              expect(scans).toBe(before);
              expect(yield* Queue.size(reloads)).toBe(0);
              expect((yield* agent.get(Agent.ID.make("build"))).hidden).toBe(false);
            }
            yield* config.emitChange({ path: root, type: "update" });
            yield* TestClock.adjust("101 millis");
            yield* TestClock.withLive(Queue.take(reloads).pipe(Effect.timeout("1 second")));
            expect((yield* agent.get(Agent.ID.make("build"))).hidden).toBe(true);

            // Preserve descendant notifications, then replace the entire root while
            // keeping the same Config entries and emitting only its parent-entry path.
            yield* Effect.promise(() => writeFile(file, markdown(false)));
            yield* config.emitChange({ path: file, type: "update" });
            yield* TestClock.adjust("101 millis");
            yield* TestClock.withLive(Queue.take(reloads).pipe(Effect.timeout("1 second")));
            expect((yield* agent.get(Agent.ID.make("build"))).hidden).toBe(false);
            yield* Effect.promise(async () => {
              await rm(root, { recursive: true });
              await mkdir(join(root, spelling), { recursive: true });
              await writeFile(file, markdown(true));
            });
            yield* config.emitChange({ path: root, type: "update" });
            yield* TestClock.adjust("101 millis");
            yield* TestClock.withLive(Queue.take(reloads).pipe(Effect.timeout("1 second")));
            expect((yield* agent.get(Agent.ID.make("build"))).hidden).toBe(true);

            yield* Scope.close(scope, Exit.void);
            expect((yield* agent.get(Agent.ID.make("build"))).hidden).toBe(false);
            yield* config.emitChange({ path: root, type: "update" });
            yield* TestClock.adjust("101 millis");
            expect(yield* Queue.size(reloads)).toBe(0);
          }).pipe(Effect.provide(layer), Effect.scoped),
        );
      } finally {
        await profile.remove();
      }
    },
  );
});
