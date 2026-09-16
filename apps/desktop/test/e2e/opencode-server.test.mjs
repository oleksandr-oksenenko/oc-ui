import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { access, mkdir, realpath, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";

import { OpenCode } from "@opencode/client";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { ensureOpenCodeServerBundle } from "../../scripts/opencode-server-build.mjs";
import { OPENCODE_VERSION } from "../../src/shared/desktop-api.ts";
import { startServer } from "./browser-fixture.mjs";
import { createProfile } from "./profile.mjs";

const origin = "https://runner.example";
const startingLine = /^server starting$/u;
const listeningLine = /^server listening on (http:\/\/127\.0\.0\.1:\d+)$/u;
const passwordLine = /^server password (\S+)$/u;

function waitForLines(child, patterns, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    let pending = "";
    const matches = new Map();
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${patterns.join(", ")}`));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off("data", onData);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    const onData = (chunk) => {
      pending += chunk.toString();
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        patterns.forEach((pattern, index) => {
          if (!matches.has(index)) {
            const match = pattern.exec(trimmed);
            if (match) matches.set(index, match);
          }
        });
        if (matches.size === patterns.length) {
          cleanup();
          resolve(patterns.map((_, index) => matches.get(index)));
          return;
        }
      }
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`Runner exited before readiness (${code})`));
    };
    child.stdout.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

function exitOutcome(child, timeoutMs = 15_000) {
  let timer;
  const exited = new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  return Promise.race([exited, timeout]).finally(() => clearTimeout(timer));
}

async function configEntries(server) {
  const response = await fetch(`${server.url}/api/config`, { headers: server.headers });
  expect(response.ok).toBe(true);
  return response.json();
}

async function stopChild(child) {
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  const force = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }, 10_000);
  try {
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise((resolve) => child.once("exit", resolve));
    }
  } finally {
    clearTimeout(force);
  }
}

describe.sequential("standalone OpenCode server runner", () => {
  let profile;
  let serverScript;

  beforeAll(async () => {
    profile = await createProfile("ocui-server-runner-");
    serverScript = await ensureOpenCodeServerBundle();
  });

  afterAll(async () => {
    await profile?.remove();
  });

  it("serves authenticated health and CORS from a project path with spaces", async () => {
    const project = join(profile.paths.app, "server runner project");
    await mkdir(project, { recursive: true });
    const server = await startServer(profile, project, origin);
    try {
      const unauthorized = await fetch(`${server.url}/api/health`);
      expect(unauthorized.status).toBe(401);

      const health = await server.health();
      expect(health).toMatchObject({ healthy: true, version: OPENCODE_VERSION });
      expect(Number.isInteger(health.pid)).toBe(true);

      const allowed = await fetch(`${server.url}/api/health`, {
        headers: { ...server.headers, origin },
      });
      expect(allowed.headers.get("access-control-allow-origin")).toBe(origin);

      const denied = await fetch(`${server.url}/api/health`, {
        headers: { ...server.headers, origin: "https://denied.example" },
      });
      expect(denied.headers.get("access-control-allow-origin")).toBeNull();

      const location = await fetch(`${server.url}/api/location`, { headers: server.headers });
      expect((await location.json()).directory).toBe(await realpath(project));
    } finally {
      await server.close();
    }
  });

  it("persists sessions across a server restart", async () => {
    const project = join(profile.paths.app, "persistence-project");
    await mkdir(project, { recursive: true });

    const first = await startServer(profile, project, origin);
    let sessionID;
    try {
      const api = OpenCode.make({ baseUrl: first.url, headers: first.headers });
      sessionID = (await api.session.create({ title: "runner persistence" })).id;
    } finally {
      await first.close();
    }

    const second = await startServer(profile, project, origin);
    try {
      const api = OpenCode.make({ baseUrl: second.url, headers: second.headers });
      const sessions = await api.session.list({ limit: 100 });
      expect(sessions.data.map((session) => session.id)).toContain(sessionID);
    } finally {
      await second.close();
    }
  });

  it("resolves relative database paths under the data root", async () => {
    const project = join(profile.paths.app, "relative-db-project");
    await mkdir(project, { recursive: true });
    const server = await startServer(profile, project, origin, {
      OPENCODE_DB: "relative-runner.db",
    });
    try {
      await expect(
        access(join(profile.paths.data, "opencode", "relative-runner.db")),
      ).resolves.toBeUndefined();
    } finally {
      await server.close();
    }
  });

  it("accepts config directory, file, and content overrides", async () => {
    const project = join(profile.paths.app, "config-project");
    await mkdir(project, { recursive: true });
    const override = join(profile.paths.app, "config-override");
    await mkdir(override, { recursive: true });
    await writeFile(join(override, "opencode.json"), JSON.stringify({ username: "runner-config" }));
    const configFile = join(override, "override.json");
    await writeFile(configFile, JSON.stringify({ username: "runner-file" }));

    const fromDirectory = await startServer(profile, project, origin, {
      OPENCODE_CONFIG_DIR: override,
    });
    try {
      expect(await configEntries(fromDirectory)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "document",
            path: join(override, "opencode.json"),
            info: expect.objectContaining({ username: "runner-config" }),
          }),
        ]),
      );
    } finally {
      await fromDirectory.close();
    }

    const fromFile = await startServer(profile, project, origin, {
      OPENCODE_CONFIG: configFile,
    });
    try {
      expect(await configEntries(fromFile)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "document",
            path: configFile,
            info: expect.objectContaining({ username: "runner-file" }),
          }),
        ]),
      );
    } finally {
      await fromFile.close();
    }

    const fromContent = await startServer(profile, project, origin, {
      OPENCODE_CONFIG_CONTENT: JSON.stringify({ username: "runner-content" }),
    });
    try {
      expect(await configEntries(fromContent)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            info: expect.objectContaining({ username: "runner-content" }),
          }),
        ]),
      );
    } finally {
      await fromContent.close();
    }
  });

  it("stages native platform bindings beside the bundle", async () => {
    const bundle = await ensureOpenCodeServerBundle();
    const modules = join(dirname(bundle), "node_modules");
    const watchers = readdirSync(join(modules, "@parcel"));
    expect(
      watchers.some((name) => name.startsWith(`watcher-${process.platform}-${process.arch}`)),
    ).toBe(true);
    const nodePty = readdirSync(join(modules, "@lydell"));
    expect(
      nodePty.some((name) => name.startsWith(`node-pty-${process.platform}-${process.arch}`)),
    ).toBe(true);
  });

  it("stops after ready with an open event stream", async () => {
    const project = join(profile.paths.app, "stream-project");
    await mkdir(project, { recursive: true });
    const server = await startServer(profile, project, origin);
    const controller = new AbortController();
    try {
      const response = await fetch(`${server.url}/api/event`, {
        headers: server.headers,
        signal: controller.signal,
      });
      expect(response.status).toBe(200);
      await server.close();
      // A zero exit proves graceful shutdown; close() only escalates on hang.
      expect(await server.exited).toBe(0);
      await expect(
        fetch(`${server.url}/api/health`, { headers: server.headers }),
      ).rejects.toThrow();
    } finally {
      controller.abort();
      await server.close();
    }
  });

  it("exits nonzero when the port is already in use", async () => {
    const blocker = createServer();
    await new Promise((resolve) => blocker.listen(0, "127.0.0.1", resolve));
    const port = blocker.address().port;
    const child = spawn(process.execPath, [serverScript, "--port", String(port)], {
      cwd: profile.paths.app,
      env: { ...profile.env, OPENCODE_SERVER_PASSWORD: "port-pass" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      expect(await exitOutcome(child)).toEqual({ code: 1, signal: null });
    } finally {
      await stopChild(child);
      await new Promise((resolve) => blocker.close(resolve));
    }
  });

  it("generates and prints a password when none is provided", async () => {
    const child = spawn(process.execPath, [serverScript], {
      cwd: profile.paths.app,
      env: { ...profile.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      const [passwordMatch, urlMatch] = await waitForLines(child, [passwordLine, listeningLine]);
      const authorization = `Basic ${Buffer.from(`opencode:${passwordMatch[1]}`).toString("base64")}`;
      const health = await fetch(`${urlMatch[1]}/api/health`, { headers: { authorization } });
      expect(health.status).toBe(200);

      child.kill("SIGTERM");
      expect(await exitOutcome(child)).toEqual({ code: 0, signal: null });
    } finally {
      await stopChild(child);
    }
  });

  it.skipIf(process.platform === "win32")(
    "exits cleanly when terminated during startup",
    async () => {
      const child = spawn(process.execPath, [serverScript], {
        cwd: profile.paths.app,
        env: { ...profile.env, OPENCODE_SERVER_PASSWORD: "startup-pass" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      try {
        await waitForLines(child, [startingLine]);
        child.kill("SIGTERM");
        expect(await exitOutcome(child)).toEqual({ code: 0, signal: null });
      } finally {
        await stopChild(child);
      }
    },
  );
});
