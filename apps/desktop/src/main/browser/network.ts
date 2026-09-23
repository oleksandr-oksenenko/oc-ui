import { app, session, type WebContents } from "electron";
import { Browser } from "@opencode/plugin-browser/rpc";
import { BrowserProxy } from "@opencode/plugin-browser/proxy";
import type { RpcClient } from "@opencode/client/effect";
import { Effect, Encoding } from "effect";

export type BrowserNetwork = Effect.Success<ReturnType<typeof createBrowserNetwork>>;

/** Erases a retired profile's storage. Connections are closed separately by the owner. */
export async function clearBrowserPartition(partitionID: string): Promise<void> {
  await session.fromPartition(partitionID).clearStorageData();
}

export const createBrowserNetwork = Effect.fn("BrowserNetwork.create")(function* <E>(
  rpc: Pick<
    RpcClient<typeof Browser.Definition, E>,
    "tunnel.open" | "tunnel.read" | "tunnel.write" | "tunnel.close"
  >,
  attachment: { sessionID: string; connectionID: string },
  location: { directory: string; workspace?: string },
  partitionID: string,
) {
  const options = { location };
  const run = Effect.runPromiseWith(yield* Effect.context());
  const proxy = yield* Effect.acquireRelease(
    Effect.tryPromise(() =>
      BrowserProxy.make({
        open: (target, signal) =>
          run(rpc["tunnel.open"]({ ...attachment, target }, options), { signal }),
        read: (tunnelID, signal) =>
          run(rpc["tunnel.read"]({ ...attachment, tunnelID }, options), { signal }),
        write: (tunnelID, data, end, signal) =>
          run(
            rpc["tunnel.write"](
              { ...attachment, tunnelID, data: Encoding.encodeBase64(data), end },
              options,
            ),
            { signal },
          ),
        close: (tunnelID) =>
          run(
            rpc["tunnel.close"]({ ...attachment, tunnelID }, options).pipe(
              Effect.timeout("5 seconds"),
            ),
          ),
      }),
    ),
    (acquired) => Effect.promise(() => acquired.close()),
  );
  const partition = session.fromPartition(partitionID);
  yield* Effect.addFinalizer(() => Effect.promise(() => partition.closeAllConnections()));
  yield* Effect.tryPromise(() =>
    partition.setProxy({
      mode: "fixed_servers",
      proxyRules: proxy.url,
      proxyBypassRules: "<-loopback>",
    }),
  );
  yield* Effect.tryPromise(() => partition.closeAllConnections());
  return {
    attach(contents: WebContents) {
      const login = (
        event: Electron.Event,
        source: WebContents,
        _details: Electron.AuthenticationResponseDetails,
        auth: Electron.AuthInfo,
        callback: (username?: string, password?: string) => void,
      ) => {
        if (
          source !== contents ||
          !auth.isProxy ||
          auth.scheme !== "basic" ||
          auth.host !== proxy.host ||
          auth.port !== proxy.port ||
          auth.realm !== "OpenCode Browser Proxy"
        )
          return;
        event.preventDefault();
        callback(proxy.credentials.username, proxy.credentials.password);
      };
      app.on("login", login);
      contents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
      return () => app.off("login", login);
    },
  };
});
