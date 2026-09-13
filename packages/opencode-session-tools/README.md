# OpenCode session tools

An OpenCode V2 server plugin for `0.0.0-beta-19271`, using Effect `4.0.0-rc.112`.
oc-ui bundles this plugin and loads it automatically on its built-in server.

## Tool

```ts
session_create({ prompt: "Implement connection recovery." });
```

Creates a new Git worktree from the calling checkout's `HEAD`, creates an
independent session there, and submits the prompt. OpenCode chooses the worktree
name and storage directory and generates the session title. Only committed files
are included. The new session has no parent and no copied conversation.

Each omitted selection inherits independently from the calling session. For
example, changing the agent does not change the inherited model or variant:

```ts
session_create({
  prompt: "Review the alternative implementation.",
  agent: "plan",
  model: { providerID: "your-provider", modelID: "your-model" },
  variant: "high",
  worktree: { create: { baseRef: "feature-branch" } },
});
```

OpenCode resolves the starting ref when it creates the worktree; the tool does
not fetch remotes or accept a new branch name. The ref must exist on that server.
An incompatible inherited or explicit variant fails validation without replacing
it with a different variant.

To use an existing worktree, specify its absolute path on the connected server:

```ts
session_create({
  prompt: "Continue implementation here.",
  worktree: { existing: { directory: "/server/worktrees/feature" } },
});
```

The directory must resolve to another Git worktree of the same project. Logical
workspaces and non-Git projects are unsupported. There is no fork, title, parent,
completion-monitoring, or follow-up-message option.

Success returns `{ sessionID, location, promptAccepted: true }`. This confirms
prompt acceptance, not completion of the new agent's work. The new session appears
through OpenCode's normal session events. Results are not sent to the caller.

The plugin owns creation until it settles, even if the caller is interrupted.
OpenCode owns the created session's execution. Closing the server still stops
server-owned work; independence from the caller is not an always-running service.

Failures include the stage, any known session ID/location, and whether the mutation
outcome is uncertain in tool-error metadata. Created resources are retained. A
reported candidate session ID may not yet exist if creation could not be confirmed.
Inspect the session and project's worktree inventory before retrying; a new call
creates a new operation and is not an idempotent retry.

## Install on a remote server

Run these commands from this repository to build and create an installable archive:

```sh
pnpm install --frozen-lockfile
pnpm --filter @oc-ui/opencode-session-tools build
pnpm --filter @oc-ui/opencode-session-tools pack
```

Copy the resulting archive to the server and install it into a directory dedicated
to server plugins, using that server's package manager. For example, from that
directory:

```sh
npm install /absolute/path/to/oc-ui-opencode-session-tools-0.1.0.tgz
```

Add the installed plugin directory to the server's OpenCode configuration, preserving any
existing plugin entries:

```json
{
  "plugins": [
    {
      "package": "/absolute/plugin-directory/node_modules/@oc-ui/opencode-session-tools/dist"
    }
  ]
}
```

Restart the server after installing or replacing the package. Confirm it appears
in the server's plugin inventory, then try a prompt-only call in a disposable Git
project and inspect the returned session and worktree. The plugin is compatible
with the pinned beta above; recheck its API contracts before upgrading OpenCode.
Installing it in oc-ui does not install it on a remote server.

The plugin uses the host's tool availability rules for `session_create`. It adds
no custom permission dialog or approval mechanism.

## Development

The source uses the supported Effect plugin API. A single `build.ts` recipe serves
standalone installation and desktop packaging. It bundles OpenCode's
extensionless ESM imports and retains the exact Effect runtime dependency.
Standard Schema wrappers keep tool input and output parsing inside this plugin
instead of the host's own Effect copy, which the standalone CLI embeds. Because
the host decodes outputs and records result metadata as JSON, the tool returns
the encoded (JSON) location shape. The desktop build produces the same
standalone plugin beside its server worker, outside ASAR, and passes its absolute
file URL through the built-in launch configuration.
OpenCode packages are build dependencies; remote installations need only Effect
at runtime. Root checks type-check the source; no declaration build is needed
for the executable plugin.

Package tests exercise defaults, validation, partial failures, and ownership.
Root `pnpm test` includes these tests, alongside the desktop suites. Browser and
packaged acceptance use a scripted local provider and disposable Git repositories.
See [the implementation plan](../../docs/session-create-plugin-plan.md) and
[app verification](../../docs/app-verification.md).
