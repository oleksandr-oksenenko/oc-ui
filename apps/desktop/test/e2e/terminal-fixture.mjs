import { SessionID } from "@opencode/schema/session-id";
import { isSessionNotFoundError } from "@opencode/client";

const request = () => ({ signal: AbortSignal.timeout(5_000) });

class TerminalFixtureError extends AggregateError {
  constructor(errors, stage, cleanupFailed) {
    super(errors, `Terminal fixture failed during ${stage}`);
    this.cleanupFailed = cleanupFailed;
  }
}

/** The sequential browser fixture is the exclusive PTY creator at this location. */
export async function withTerminalFixture(api, location, work) {
  const list = async () => (await api.pty.list({ location }, request())).data;
  const baseline = new Set((await list()).map((pty) => pty.id));
  const sessions = new Map();
  const cleanup = [];
  const restore = [];
  const failures = [];
  let cleanupFailed = false;
  let stage = "setup";
  let diagnose;
  const settle = async (action) => {
    try {
      await action();
    } catch (error) {
      cleanupFailed = true;
      failures.push(error);
    }
  };
  try {
    await work({
      checkpoint: (name) => {
        stage = name;
      },
      diagnostics: (inspect) => {
        diagnose = inspect;
      },
      cleanup: (action) => cleanup.push(action),
      restore: (action) => restore.push(action),
      list,
      get: async (id) => (await api.pty.get({ ptyID: id, location }, request())).data,
      createSession: async (input) => {
        // Retain identity even if creation is applied but its reply is lost.
        const id = SessionID.create();
        sessions.set(id, false);
        const session = await api.session.create({ ...input, id }, request());
        sessions.set(id, true);
        return session;
      },
    });
  } catch (cause) {
    failures.push(new Error(`Terminal scenario failed during ${stage}`, { cause }));
    if (diagnose) {
      try {
        await diagnose();
      } catch (error) {
        failures.push(error);
      }
    }
  } finally {
    // Restore injected faults before server reconciliation. Every cleanup runs,
    // even if one fails; component disposal alone does not delete remote PTYs.
    while (restore.length) await settle(restore.pop());
    while (cleanup.length) await settle(cleanup.pop());
    await settle(async () => {
      const owned = (await list()).filter((pty) => !baseline.has(pty.id));
      for (const pty of owned)
        await settle(() => api.pty.remove({ ptyID: pty.id, location }, request()));
      const surviving = (await list()).filter((pty) => !baseline.has(pty.id));
      if (surviving.length)
        throw new Error(
          `Terminal fixture PTYs survived cleanup: ${surviving.map((pty) => pty.id).join(", ")}`,
        );
    });
    for (const [sessionID, acknowledged] of sessions)
      await settle(async () => {
        // An aborted client request does not prove the server stopped creating.
        // Only existence followed by removal can reconcile an ambiguous create.
        if (!acknowledged) await api.session.get({ sessionID }, request());
        await api.session.remove({ sessionID }, request()).catch((error) => {
          if (!isSessionNotFoundError(error)) throw error;
        });
        const present = await api.session.get({ sessionID }, request()).catch((error) => {
          if (!isSessionNotFoundError(error)) throw error;
          return undefined;
        });
        if (present) throw new Error(`Terminal fixture session survived cleanup: ${sessionID}`);
      });
  }
  if (failures.length) throw new TerminalFixtureError(failures, stage, cleanupFailed);
}

/** Dispose the scenario's renderer records before fallback remote reconciliation. */
export function ownTerminalPage(fixture, page) {
  const pending = new Set();
  let uncertain = false;
  const started = (entry) => {
    if (entry.method() === "POST" && new URL(entry.url()).pathname === "/api/pty")
      pending.add(entry);
  };
  const finished = (entry) => {
    pending.delete(entry);
  };
  const failed = (entry) => {
    if (pending.delete(entry)) uncertain = true;
  };
  page.on("request", started);
  page.on("requestfinished", finished);
  page.on("requestfailed", failed);
  fixture.cleanup(async () => {
    // Closing a page cannot establish server mutation settlement. If creation
    // was still pending or its reply lost, stop dependent scenarios explicitly.
    try {
      await page.close();
    } finally {
      page.off("request", started);
      page.off("requestfinished", finished);
      page.off("requestfailed", failed);
    }
    if (pending.size > 0 || uncertain)
      throw new Error("Terminal creation settlement is unresolved after renderer disposal");
  });
}
