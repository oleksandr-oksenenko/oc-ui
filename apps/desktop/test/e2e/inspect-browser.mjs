import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer as createHttpServer } from "node:http";
import { promisify } from "node:util";
import { createServer } from "vite-plus";
import { createProfile } from "./profile.mjs";
import { prepareProjectFixture } from "./project-fixture.ts";
import { startScriptedProvider } from "./scripted-provider.mjs";
import { startServer } from "./browser-fixture.mjs";

// This process owns the inspection session. Signals request shutdown, but startup
// must settle before cleanup so a resource cannot arrive after its owner closes.
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--smoke")) {
  console.error("Usage: pnpm verify:browser [--smoke]");
  process.exit(1);
}
let stopping = false;
let requestStop;
const startedAt = performance.now();
const phase = (name, state) =>
  console.info(
    JSON.stringify({
      status: "phase",
      phase: name,
      state,
      elapsedMs: Math.round(performance.now() - startedAt),
    }),
  );
const acquire = async (name, start) => {
  phase(name, "start");
  const resource = await start();
  phase(name, "complete");
  return resource;
};
const stopped = new Promise((resolve) => {
  requestStop = () => {
    stopping = true;
    phase("stop", "requested");
    resolve();
  };
});
process.on("SIGINT", requestStop);
process.on("SIGTERM", requestStop);

let profile;
let provider;
let ui;
let http;
let server;
let failed = false;
try {
  profile = await acquire("profile", () => createProfile("ocui-inspect-"));
  const project = join(profile.paths.app, "acceptance-project");
  await acquire("project", () => prepareProjectFixture(project));
  provider = await acquire("provider", () => startScriptedProvider());
  await writeFile(join(project, "opencode.json"), JSON.stringify(provider.config));
  http = createHttpServer();
  ui = await acquire("vite", () =>
    createServer({
      configFile: "vite.web.config.ts",
      // Middleware mode leaves signals and the listener lifetime with this owner.
      server: { middlewareMode: true, ws: { server: http } },
      clearScreen: false,
    }),
  );
  http.on("request", ui.middlewares);
  await acquire(
    "listen",
    () =>
      new Promise((resolve, reject) => {
        http.once("error", reject);
        http.listen(0, "127.0.0.1", resolve);
      }),
  );
  const url = `http://127.0.0.1:${http.address().port}/`;
  server = await acquire("server", async () => {
    // Initiate acquisition and observe rejection immediately. The IPC fixture
    // holds publication of its late result while a stop signal is processed.
    const acquiring = startServer(profile, project, new URL(url).origin).then(
      (resource) => ({ resource }),
      (error) => ({ error }),
    );
    if (process.send !== undefined) {
      await new Promise((resolve) => {
        process.once("message", resolve);
        process.send({ status: "held", profile: profile.root, phase: "server" });
      });
      process.disconnect();
    }
    const result = await acquiring;
    if ("error" in result) throw result.error;
    return result.resource;
  });
  const health = await acquire("health", () =>
    fetch(`${server.url}/api/health`, {
      headers: server.headers,
      signal: AbortSignal.timeout(10_000),
    }),
  );
  if (!health.ok || !(await health.json()).healthy) throw new Error("Server health failed");
  const page = await acquire("entry", () => fetch(url, { signal: AbortSignal.timeout(10_000) }));
  if (!page.ok || !(await page.text()).includes("/browser.ts")) {
    throw new Error("Browser entry readiness failed");
  }
  if (!stopping) {
    console.log(
      JSON.stringify(
        {
          status: "ready",
          ui: url,
          server: server.url,
          username: "opencode",
          password: server.password,
          project,
          profile: profile.root,
          provider: "local scripted acceptance provider; no live model calls",
        },
        null,
        2,
      ),
    );
    console.log(
      "Open the UI, connect with these disposable credentials, and select the project. Ctrl-C stops this session.",
    );
    if (!args.includes("--smoke")) {
      await Promise.race([
        stopped,
        server.exited.then(() => {
          throw new Error("Inspection server exited unexpectedly");
        }),
      ]);
    }
  }
} catch (error) {
  failed = true;
  process.exitCode = 1;
  console.error(error);
} finally {
  // Stop the server before its provider; retain state if any resource fails to close.
  for (const [name, resource] of [
    ["server", server],
    ["provider", provider],
    ["vite", ui],
  ]) {
    try {
      if (resource) await acquire(`close:${name}`, () => resource.close());
    } catch (error) {
      failed = true;
      process.exitCode = 1;
      console.error("Inspection cleanup failed", error);
    }
  }
  if (http?.listening) {
    try {
      http.closeAllConnections();
      await acquire("close:listen", promisify(http.close.bind(http)));
    } catch (error) {
      failed = true;
      process.exitCode = 1;
      console.error("Inspection HTTP cleanup failed", error);
    }
  }
  if (failed) console.error(`Inspection failed; profile retained at ${profile?.root}`);
  else {
    if (profile) await acquire("remove:profile", () => profile.remove());
    console.log("Inspection stopped; owned resources closed and disposable profile removed.");
  }
  process.off("SIGINT", requestStop);
  process.off("SIGTERM", requestStop);
  // Do not keep the process alive or force exit: expose resource types only if
  // something survives completed cleanup, without dumping paths or credentials.
  setTimeout(() => {
    console.error(
      JSON.stringify({ status: "exit-pending", resources: process.getActiveResourcesInfo() }),
    );
  }, 1_000).unref();
}
