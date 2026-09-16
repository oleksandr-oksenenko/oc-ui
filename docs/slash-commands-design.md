# Slash commands

Slash commands extend the composer using the OpenCode `2.0.3`
`location.command` and `session.command` contracts.

## Behavior

- The `/` suggestion menu shows two groups: **Commands** first, then **Skills**.
  Commands come from the connected location and include the built-in `init` and
  `review` commands, MCP prompts, and custom commands from config or
  `.opencode/{command,commands}/**/*.md`.
- Commands are only suggested at the start of a message; the client recognizes
  a command from a leading `/name` and posts name and arguments as separate
  fields. Skills remain available after any whitespace.
  Selecting a command inserts plain `/name ` text; selecting a skill inserts an
  inline chip. Command names may contain slashes (`nested/name`) or colons
  (`server:prompt`).
- Submission recognizes a command only when the draft starts with `/name` and
  the selected session's command inventory is loaded and contains `name`. The
  client parses the leading token and posts the command name and remaining text
  as separate fields; the server does not parse the draft. Unknown leading names
  stay ordinary prompt text.
- A message that starts with a command token and is submitted while the
  inventory is loading or failed is blocked with a notice instead of being sent
  as a prompt. Sending it as prompt text would change its meaning and consume
  comments that the command path preserves.
- Commands call `api.session.command` with the arguments, pasted files, the
  selected skills, and the requested `delivery`. Skill mention offsets are
  dropped because the server replaces the text with an expanded template. The
  server implementation, including subagent commands, decides how delivery and
  attachments ultimately apply.
- Review comments and transcript annotations are not representable on the
  command endpoint. They stay attached and are sent with the next prompt; the
  composer shows a notice while a command is recognized.
- On success the draft, skills, and sent files clear as they do for a prompt. On
  failure the draft is unchanged; an unread attachment reports that the command
  was not sent, while an uncertain dispatch reports that it could not be
  confirmed and asks the user to check the conversation before retrying. Commands
  have no client message ID, so there is no automatic or ID-matched retry.

## Ownership

- The SDK data store owns both inventories and refresh events (`command.updated`,
  `skill.updated`). `createComposerCatalog` owns one read lifetime for the
  selected location and session, with independent `commands` and `skills`
  statuses so a failed read does not hide the other. `onRetry` resynchronizes
  the unavailable sections only.
- `createSessionComposer` owns recognition, admission, cancellation, draft
  restore/clear, and errors. `PromptEditor` owns grouping, filtering, and text
  insertion. `createWorkspace` wires the selected session's location.
- Command submission shares the single active-admission slot with prompts but
  keeps its own failure surface and no failed-retry record. A command submission
  supersedes a failed prompt for the same session.

## Verification

Unit tests cover the parser, catalog sources (including partial failure and
stale reads), command recognition and blocking, argument/file/skill payloads,
draft preservation, review/annotation preservation, superseding a failed prompt,
and error messages. Storybook covers grouped suggestions, insertion, dismissal,
keyboard navigation, and per-section loading/failure. A real pinned-server
browser test runs the built-in `init` command from the composer and checks the
command endpoint, draft clearing, and the resulting user message.
