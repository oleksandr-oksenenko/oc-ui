# OpenCode tools

An OpenCode V2 server plugin for oc-ui's local `2.0.3` build, using Effect `4.0.0-rc.112`.
oc-ui bundles this plugin and loads it automatically on its built-in server.

## Tool surface

The plugin keeps `read`, `shell`, and the model's editing tools (`patch`, or
`edit` and `write`) directly available. It moves all other tools registered before
this plugin, including `glob`, `grep`, `webfetch`, `websearch`, `question`, `skill`,
and `subagent`, into Code Mode. `execute` remains directly available and supplies
catalog discovery through `search`. Tools retain their original schemas,
executors, namespaces, and permission checks. The transform is replayed after
registry refreshes, including MCP changes. Tools added by later plugins retain
those plugins' exposure options.

Session tools use the Code Mode-only `session` namespace. Discover them using
`search({ namespace: "session" })`. `list` finds sessions in the caller's project,
and `messages` reads persisted conversation history. Both return opaque cursors
for pagination. oc-ui supplies these plugin capabilities through its
[local OpenCode build](../../docs/local-opencode-build.md).

```ts
const page = await tools.session.list({ search: "recovery", limit: 10 });
return await tools.session.messages({ sessionID: page.data[0].id, limit: 20 });
```

The complete namespace is:

| Tool        | Behavior                                                                          |
| ----------- | --------------------------------------------------------------------------------- |
| `create`    | Create and start an independent session in another worktree.                      |
| `list`      | Find sessions in the caller's project, with cursor pagination.                    |
| `get`       | Inspect session metadata; defaults to the caller.                                 |
| `messages`  | Read persisted messages, with cursor pagination; defaults to the caller.          |
| `send`      | Admit a user message; queue by default, or explicitly steer.                      |
| `wait`      | Wait for another session to become idle; defaults to 30 seconds, maximum 300.     |
| `interrupt` | Request interruption of another session.                                          |
| `delete`    | Stop and recursively delete a session and its children; preserve files/worktrees. |
| `rename`    | Rename a session using the existing upstream tool.                                |
| `move`      | Move a session using the existing upstream tool.                                  |

```ts
const admission = await tools.session.send({ sessionID, text: "Continue the implementation." });
const result = await tools.session.wait({ sessionID, timeoutSeconds: 30 });
return { admission, result };
```

Send returns `{ sessionID, messageID, accepted: true }` after durable
admission, not completion. Reusing `messageID` retries the same admission; the
first accepted text and delivery mode win. Failed admissions report the retry ID
in both the visible error message and error metadata, so it remains available
through Code Mode. Send, interrupt, and delete remain owned by the plugin scope if
the calling tool is interrupted, serialize within that plugin, and are never
automatically retried.
The server owns admitted work. Plugin shutdown interrupts and awaits owned fibers;
failed or interrupted mutations may have partial effects, so inspect before retrying.

Wait returns `{ sessionID, settled, session }`. `settled: false` means the timeout
expired; cancelling or timing out a wait cancels its observer without interrupting
the target. Idle is not necessarily success: inspect `session.outcome`.
Interrupt acknowledges the stop request before cleanup finishes and retains queued
prompts; use wait to observe settlement. Delete awaits native cleanup and recursively
removes descendants. Wait, interrupt, and delete reject the caller and its ancestors
because those sessions can depend on the current invocation completing.

Invoke creation through `execute`:

```ts
return await tools.session.create({ prompt: "Implement connection recovery." });
```

Creates a new Git worktree from the calling checkout's `HEAD`, creates an
independent session there, and submits the prompt. OpenCode chooses the worktree
name and storage directory and generates the session title. Only committed files
are included. The new session has no parent and no copied conversation.

Each omitted selection inherits independently from the calling session. For
example, changing the agent does not change the inherited model or variant:

```ts
return await tools.session.create({
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
return await tools.session.create({
  prompt: "Continue implementation here.",
  worktree: { existing: { directory: "/server/worktrees/feature" } },
});
```

The directory must resolve to another Git worktree of the same project. Logical
workspaces and non-Git projects are unsupported. Creation has no fork, title, or
parent option. Use `wait`, `messages`, and `send` separately to monitor or continue
the new session.

Success returns `{ sessionID, location, promptAccepted: true }`. This confirms
prompt acceptance, not completion of the new agent's work. The new session appears
through OpenCode's normal session events. Results are not sent to the caller.

The plugin owns creation until it settles, even if the caller is interrupted.
OpenCode owns the created session's execution. Closing the server still stops
server-owned work; independence from the caller is not an always-running service.

Failures include the stage, any known session ID/location and initial prompt ID,
and whether the mutation outcome is uncertain in both visible error text and
tool-error metadata. Created resources are retained. A
reported candidate session ID may not yet exist if creation could not be confirmed.
Inspect the session and project's worktree inventory before retrying; a new call
creates a new operation and is not an idempotent retry.
If initial prompt admission failed, inspect the retained session's messages before
retrying with `send` and the reported `messageID`. Shutdown can cancel prompt
preparation; the native API protects the durable admission commit.

## Install on a remote server

Run these commands from this repository to build and create an installable archive:

```sh
pnpm install --frozen-lockfile
pnpm --filter @oc-ui/opencode-tools build
pnpm --filter @oc-ui/opencode-tools pack
```

Copy the resulting archive to the server and install it into a directory dedicated
to server plugins, using that server's package manager. For example, from that
directory:

```sh
npm install /absolute/path/to/oc-ui-opencode-tools-0.1.0.tgz
```

Add the installed plugin directory to the server's OpenCode configuration, preserving any
existing plugin entries:

```json
{
  "plugins": [
    {
      "package": "/absolute/plugin-directory/node_modules/@oc-ui/opencode-tools/dist"
    }
  ]
}
```

Restart the server after installing or replacing the package. Confirm it appears
in the server's plugin inventory, then try a prompt-only call in a disposable Git
project and inspect the returned session and worktree. The server must use the
local OpenCode build linked above to support session listing and message reads;
the published `2.0.3` plugin context lacks those methods. Recheck its API contracts
before upgrading OpenCode.
Installing it in oc-ui does not install it on a remote server.

The plugin uses the host's tool availability rules for its session tools. It adds
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
OpenCode packages are build dependencies; the server must supply the recorded
local plugin capabilities for list and message reads. Root checks type-check the
source; no declaration build is needed for the executable plugin.

Package tests exercise defaults, validation, partial failures, and ownership.
Root `pnpm test` includes these tests, alongside the desktop suites. Browser and
packaged acceptance use a scripted local provider and disposable Git repositories.
See [the implementation plan](../../docs/session-create-plugin-plan.md) and
[app verification](../../docs/app-verification.md).
