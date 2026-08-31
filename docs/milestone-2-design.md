# Milestone 2: managed local sidecar

Status: Integration contract.

This milestone adds a local-first connection path to the remote session client.
The desktop app supervises one OpenCode server process when local startup is
available and falls back to a user-configured remote server when it is not.
Both paths use the same OpenCode Promise client, Solid data layer, event
stream, session catalog, and transcript projection.

The supported OpenCode version remains exactly `0.0.0-beta-18155`.

## Dependency and resolution

The workspace catalog is the package-installation authority for the three
OpenCode packages:

```text
@opencode-ai/cli     0.0.0-beta-18155
@opencode-ai/client  0.0.0-beta-18155
@opencode-ai/ui      0.0.0-beta-18155
```

`@opencode-ai/cli` is a runtime dependency of `apps/desktop`, not a root-only
development dependency. This lets the Electron main process resolve the
platform CLI from the desktop package. The workspace scripts invoke that same
package-local executable through the desktop workspace filter:

```sh
pnpm --filter desktop exec opencode2 serve
pnpm --filter desktop exec opencode2 --version
```

The app must not rely on a globally installed `opencode` command or a
development-shell `PATH` entry. The CLI and generated client are kept on the
same exact pin so a local server cannot silently drift from the renderer's
protocol schema.

The sidecar is launched in OpenCode service mode (`serve --service`) with an
app-private registration file under the Electron user-data directory. The
service registration supplies the loopback URL and Basic-authentication
material to the main process. The preload passes those values to the existing
renderer client only for the lifetime of the connection; they are not a user
configuration surface and are never persisted for a local target.

## Connection policy

The connection policy is local-first:

1. Start the managed sidecar; the pinned service mode uses the user's home
   directory as its server-owned default.
2. Wait for its loopback endpoint to answer health and location checks.
3. Require server version `0.0.0-beta-18155`.
4. Connect the existing client/data runtime and hydrate sessions.
5. If local startup or validation fails, show the remote connection path.

Remote fallback is explicit. It accepts a plain HTTP origin and password,
reuses the existing secure saved-connection behavior, and performs the same
health, authentication, location, and exact-version checks. A failed local
attempt must not overwrite a previously saved remote connection.

The first integration has no directory picker. The pinned local service uses
the user's home directory; a remote connection uses that server's default. The
desktop app does not choose or persist a directory. The user cannot pass
arbitrary CLI arguments, select an untrusted process, or make the app send a
local directory to a remote server.

## Sidecar lifecycle

The Electron main process owns the sidecar lifecycle. It is responsible for:

- resolving the package-local `opencode2` executable;
- accepting the service's generated loopback endpoint;
- starting the child with the required service-mode overrides;
- waiting for a bounded startup/health/version check;
- reporting startup, health, exit, and incompatible-version failures;
- terminating the child when the local connection changes or the app exits.

The renderer treats a managed endpoint like any other verified OpenCode
server. It does not spawn processes, inspect the filesystem, or maintain a
second OpenCode state model. If the child exits after connection, the UI keeps
the existing remote-client semantics: it reports a connection failure and
offers the remote fallback rather than silently attaching to another process.

Shutdown is best-effort but must be awaited far enough to avoid leaving a
managed child running after the app has closed. A sidecar started by this app
must not be treated as a user-owned server or killed when the app is connected
to a remote server.

## Security

The local sidecar binds to loopback only. Its Basic-authentication material is
excluded from logs and URLs, passed transiently to the existing renderer
client, and never persisted in saved target settings. OpenCode service mode
keeps the generated password in its app-private registration file while the
child runs; the file has owner-only permissions and is removed on stop.

Remote plain HTTP remains supported for this milestone but can expose the
password on the network. The form warns for non-loopback HTTP origins. HTTPS,
custom certificates, and authentication methods other than Basic remain out of
scope.

The sidecar command, endpoint, credentials, and process identifiers are not
user-editable in this milestone. This keeps the local path bounded and makes
failure ownership clear.

The service inherits the Electron launch environment so OpenCode providers can
use the same user-configured credentials as a terminal launch. The app adds
only its private state root and client name; it does not log or copy inherited
environment values into target settings.

## Packaging boundary and acceptance

The repository now has a local macOS ARM64 electron-builder target. It embeds
the exact pinned CLI outside ASAR at
`Contents/Resources/opencode/opencode2`, resolves that executable from
`process.resourcesPath`, and produces an unpacked `.app` plus a DMG. Local
builds use ad-hoc signing by default and accept an Apple Development identity
through `CSC_NAME`. Notarization, publishing, other platforms, and updates are
not part of this milestone.

Acceptance requires:

- a local sidecar starts from the pinned desktop dependency and reports
  `0.0.0-beta-18155`;
- the existing session flow works through that loopback endpoint;
- startup timeout, early exit, and incompatible version produce a clear local
  failure;
- remote fallback can connect to a configured exact-version server;
- changing connection and closing the app do not leave the managed child
  running;
- no directory picker or arbitrary server configuration UI appears; and
- package-local CLI resolution works without a globally installed command.

Packaged-app acceptance additionally requires the ARM64 CLI to execute from the
signed app resources, the renderer to load from the packaged `oc://renderer`
origin, the DMG to pass integrity checks, and app quit not to strand a
windowless process when sidecar cleanup fails.
