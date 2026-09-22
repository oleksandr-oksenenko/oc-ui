import type { WebContents } from "electron";
import type { ProtocolMapping } from "devtools-protocol/types/protocol-mapping.js";
import { protocolError } from "./errors.ts";

export type Cdp = ReturnType<typeof createCdp>;

/**
 * The debugger adapter owns every application-facing command promise. Chromium
 * cannot cancel a `sendCommand`, so terminal closure rejects the wrappers
 * instead of waiting for the renderer to answer: callers settle, the target is
 * retired, and a late raw response cannot reach a newer operation.
 */
export function createCdp(contents: WebContents) {
  const listeners = new Map<string, Set<(params: unknown, sessionID?: string) => void>>();
  const sessions = new Set([""]);
  const pending = new Set<PromiseWithResolvers<unknown>>();
  let terminal: Error | undefined;
  const receive = (_event: Electron.Event, name: string, params: unknown, sessionID?: string) => {
    if (!sessions.has(sessionID ?? "")) return;
    if (name === "Target.attachedToTarget") {
      const event = params as ProtocolMapping.Events["Target.attachedToTarget"][0];
      if (event.targetInfo.type === "iframe") sessions.add(event.sessionId);
    }
    if (name === "Target.detachedFromTarget")
      sessions.delete((params as ProtocolMapping.Events["Target.detachedFromTarget"][0]).sessionId);
    listeners.get(name)?.forEach((callback) => callback(params, sessionID || undefined));
  };
  contents.debugger.on("message", receive);
  const close = (reason: Error) => {
    if (terminal) return;
    terminal = reason;
    for (const entry of pending) entry.reject(reason);
    pending.clear();
    contents.debugger.off("message", receive);
    listeners.clear();
    if (!contents.isDestroyed() && contents.debugger.isAttached()) contents.debugger.detach();
  };
  return {
    send<Method extends keyof ProtocolMapping.Commands>(
      method: Method,
      params: object = {},
      sessionID?: string,
    ): Promise<ProtocolMapping.Commands[Method]["returnType"]> {
      if (terminal) return Promise.reject(terminal);
      if (contents.isDestroyed())
        return Promise.reject(
          new Error(
            "Browser tab was closed. Call browser.tabs.list({}) and choose an existing tabID, or browser.tabs.open({}) if no tabs remain.",
          ),
        );
      const outcome = Promise.withResolvers<ProtocolMapping.Commands[Method]["returnType"]>();
      const entry = outcome as PromiseWithResolvers<unknown>;
      pending.add(entry);
      void (async () => {
        // attach can throw synchronously; sendCommand can reject asynchronously.
        try {
          if (!contents.debugger.isAttached()) contents.debugger.attach("1.3");
          const value = await contents.debugger.sendCommand(method, params, sessionID);
          pending.delete(entry);
          outcome.resolve(value);
        } catch (error) {
          pending.delete(entry);
          outcome.reject(terminal ?? protocolError(method, error));
        }
      })();
      return outcome.promise;
    },
    on<Method extends keyof ProtocolMapping.Events>(
      method: Method,
      callback: (params: ProtocolMapping.Events[Method][0], sessionID?: string) => void,
    ) {
      const handler = (params: unknown, sessionID?: string) =>
        callback(params as ProtocolMapping.Events[Method][0], sessionID);
      const handlers = listeners.get(method) ?? new Set();
      handlers.add(handler);
      listeners.set(method, handlers);
      return () => {
        handlers.delete(handler);
        if (!handlers.size) listeners.delete(method);
      };
    },
    /** Fence the connection: reject every pending and future application-facing command. */
    close,
  };
}

export function abortError(signal: AbortSignal) {
  if (signal.aborted)
    throw new Error(
      "Browser operation was cancelled. Inspect the tab before deciding to repeat an action; cancellation does not undo changes already made.",
    );
}

export async function waitFor(
  check: () => boolean | Promise<boolean>,
  signal: AbortSignal,
  timeoutMs = 10_000,
) {
  const deadline = Date.now() + timeoutMs;
  const timeout = () => new Error(`Condition was not met within ${timeoutMs} ms.`);
  // A busy renderer can hold one check past the deadline, so each check races the remaining time.
  while (true) {
    abortError(signal);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw timeout();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(timeout()), remaining);
    });
    if (await Promise.race([check(), expired]).finally(() => clearTimeout(timer))) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
