import { Deferred, Effect, Schema } from "effect";
import { SessionID } from "@opencode/schema/session-id";
import { SessionMessage } from "@opencode/schema";
import type { LocationRef } from "@opencode/client";
import type { ConnectedRuntime } from "../opencode/runtime.ts";
import { WorkspaceRequestError } from "../workspace-owner.ts";
import {
  createSessionWorktree,
  SessionWorktreeError,
} from "../opencode/create-session-worktree.ts";
import { runServerShell, shellArgument } from "../opencode/server-shell.ts";
import { parseSessionCommand } from "../opencode/session-command.ts";
import { modelVariantAvailable, resolveModel } from "../opencode/model-choices.ts";
import { createSessionPrompt } from "../opencode/session-prompt.ts";
import { submitSessionInput, SessionAttachmentError } from "../opencode/submit-session-input.ts";
import { draftLockName, withBrowserLock } from "./locks.ts";
import type { DraftAttempt, DraftEntry, NewSessionDrafts } from "./drafts.ts";

export type DraftSubmissionRuntime = Pick<ConnectedRuntime, "effects"> & {
  data: Pick<ConnectedRuntime["data"], "on"> & {
    project: Pick<ConnectedRuntime["data"]["project"], "list">;
    location: Pick<
      ConnectedRuntime["data"]["location"],
      "model" | "agent" | "command" | "skill" | "vcs"
    >;
    session: Pick<ConnectedRuntime["data"]["session"], "create" | "prompt" | "remember">;
  };
  api: Pick<ConnectedRuntime["api"], "location" | "worktree"> & {
    config: Pick<ConnectedRuntime["api"]["config"], "shells">;
    shell: Pick<ConnectedRuntime["api"]["shell"], "create" | "get" | "output" | "remove">;
    plugin: Pick<ConnectedRuntime["api"]["plugin"], "awaitActivation">;
    vcs: Pick<ConnectedRuntime["api"]["vcs"], "get">;
    session: Pick<ConnectedRuntime["api"]["session"], "get" | "message" | "command">;
  };
};
class DraftSubmissionError extends Schema.TaggedError<DraftSubmissionError>()(
  "DraftSubmissionError",
  { message: Schema.String },
) {}
const requestLocation = (location: LocationRef) => ({
  directory: location.directory,
  workspace: location.workspaceID,
});
const errorMessage = (error: { readonly message: string }): string =>
  Schema.is(SessionAttachmentError)(error)
    ? `The attachment “${error.name}” could not be read. Copy the draft to replace it.`
    : Schema.is(WorkspaceRequestError)(error)
      ? "The server response could not be confirmed. Your saved draft and any server resources were retained."
      : error.message;

/** Workspace-owned Send; navigation never changes the captured destination. */
export function createDraftSubmission(
  runtime: DraftSubmissionRuntime,
  service: NewSessionDrafts["Service"],
  serverKey: string,
  complete: (draftID: string, sessionID: string) => void,
) {
  const { effects, api, data } = runtime;
  const active = new Set<string>();
  const validate = Effect.fn("DraftSubmission.validate")(function* (
    entry: DraftEntry,
    location: LocationRef,
  ) {
    yield* effects.request((signal) =>
      api.plugin.awaitActivation({ location: requestLocation(location) }, { signal }),
    );
    const catalogs = [
      data.location.model,
      data.location.agent,
      data.location.command,
      data.location.skill,
      data.location.vcs,
    ];
    for (const catalog of catalogs) catalog.invalidate(location);
    yield* Effect.all(
      catalogs.map((catalog) => effects.request(() => catalog.sync(location))),
      { concurrency: "unbounded" },
    );
    const choices = entry.value.choices;
    const model = resolveModel(data.location.model.list(location) ?? [], choices.model);
    if (!model || !modelVariantAvailable(model, choices.model?.variant)) {
      return yield* new DraftSubmissionError({
        message: "The saved model or variant is unavailable at this location.",
      });
    }
    if (
      !data.location.agent
        .list(location)
        ?.some((item) => item.id === choices.agent && !item.hidden && item.mode !== "subagent")
    )
      return yield* new DraftSubmissionError({
        message: "The saved agent is unavailable at this location.",
      });
    if (
      entry.value.skills.some(
        (skill) => !data.location.skill.list(location)?.some((item) => item.id === skill.id),
      )
    )
      return yield* new DraftSubmissionError({
        message: "A saved skill is unavailable at this location.",
      });
    const request = entry.value.attempt?.request;
    if (
      request?.kind === "command" &&
      !data.location.command.list(location)?.some((item) => item.name === request.name)
    )
      return yield* new DraftSubmissionError({
        message: "The selected command is unavailable at this location.",
      });
    return undefined;
  });
  const prepare = Effect.fn("DraftSubmission.prepare")(function* (entry: DraftEntry) {
    const choices = entry.value.choices;
    const target = choices.project;
    if (!target) return yield* new DraftSubmissionError({ message: "Choose a project." });
    const resolved = yield* effects.request((signal) =>
      api.location.get({ location: requestLocation(target.location) }, { signal }),
    );
    if (resolved.project.id !== target.id)
      return yield* new DraftSubmissionError({
        message: "This directory no longer belongs to the selected project.",
      });
    const location: LocationRef = {
      directory: resolved.directory,
      workspaceID: resolved.workspaceID,
    };
    const git = data.project.list().find((item) => item.id === target.id)?.vcs === "git";
    if (!git) {
      if (choices.mode === "worktree")
        return yield* new DraftSubmissionError({
          message: "This project does not support worktrees.",
        });
      return location;
    }
    const run = (command: string) => runServerShell(effects, api, location, command);
    const branch = choices.branch;
    if (!branch) {
      if (choices.mode === "worktree")
        return yield* new DraftSubmissionError({ message: "Choose a starting branch." });
      return location;
    }
    if (branch.kind === "new" && choices.mode !== "local")
      return yield* new DraftSubmissionError({
        message: "New branches are only available in Local mode.",
      });
    yield* run("git check-ref-format --branch " + shellArgument(branch.name));
    const vcs = yield* effects.request((signal) =>
      api.vcs.get({ location: requestLocation(location) }, { signal }),
    );
    const base = branch.kind === "new" ? vcs.data.branch.default : branch.name;
    if (!base)
      return yield* new DraftSubmissionError({
        message: "The server could not identify a default branch.",
      });
    const commit = (yield* run(
      "git rev-parse --verify --end-of-options " +
        shellArgument("refs/heads/" + base + "^{commit}"),
    )).trim();
    if (choices.mode === "worktree") {
      return (yield* createSessionWorktree({ effects, api }, location, commit)).location;
    }
    if (branch.kind === "existing" && vcs.data.branch.current === branch.name) return location;
    // Subscribe before Git. A changed config must cross the server's reload boundary.
    const changes = (yield* run(
      "git diff --name-only HEAD " + shellArgument(commit) + " --",
    )).split(/\r?\n/u);
    const needed = new Set<string>();
    if (changes.some((path) => /(^|\/)(opencode\.jsonc?|\.opencode\/[^/]*\.jsonc?)$/u.test(path))) {
      needed.add("config.updated");
      needed.add("agent.updated");
      needed.add("catalog.updated");
    }
    if (changes.some((path) => /(^|\/)\.opencode\/(agents?|modes?)\/.*\.md$/u.test(path)))
      needed.add("agent.updated");
    if (changes.some((path) => /(^|\/)\.(opencode|claude)\/commands?\//u.test(path)))
      needed.add("command.updated");
    if (changes.some((path) => /(^|\/)\.(agents|opencode|claude)\/skills\//u.test(path)))
      needed.add("skill.updated");
    const ready = yield* Deferred.make<void>();
    const stopConfig = data.on("config.updated", (event) => {
      if (event.location?.directory === location.directory) {
        needed.delete("config.updated");
        if (!needed.size) Deferred.doneUnsafe(ready, Effect.void);
      }
    });
    const stops = [
      stopConfig,
      ...(["agent.updated", "catalog.updated", "command.updated", "skill.updated"] as const).map(
        (type) =>
          data.on(type, (event) => {
            if (event.location?.directory === location.directory) {
              needed.delete(type);
              if (!needed.size) Deferred.doneUnsafe(ready, Effect.void);
            }
          }),
      ),
    ];
    yield* Effect.gen(function* () {
      yield* run(
        branch.kind === "new"
          ? "git switch --no-guess -c " + shellArgument(branch.name) + " " + shellArgument(commit)
          : "git switch --no-guess -- " + shellArgument(branch.name),
      );
      if (needed.size)
        yield* Deferred.await(ready).pipe(
          Effect.timeout("10 seconds"),
          Effect.mapError(
            () =>
              new DraftSubmissionError({
                message:
                  "The checkout changed, but its configuration refresh could not be confirmed. Nothing was sent.",
              }),
          ),
        );
    }).pipe(Effect.ensuring(Effect.sync(() => stops.forEach((unsubscribe) => unsubscribe()))));
    return location;
  });
  const accepted = (id: string, attempt: DraftAttempt) =>
    service
      .updateSubmission(id, attempt.sessionID, undefined)
      .pipe(Effect.tap(() => Effect.sync(() => complete(id, attempt.sessionID))));
  const send = Effect.fn("DraftSubmission.send")(function* (
    id: string,
    entry: DraftEntry,
    initial: DraftAttempt,
  ) {
    let attempt = initial;
    const persist = (next: DraftAttempt) =>
      service.updateSubmission(id, attempt.sessionID, next).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            attempt = next;
          }),
        ),
      );
    const work = Effect.gen(function* () {
      if (attempt.phase === "accepted") {
        yield* accepted(id, attempt);
        return undefined;
      }
      const project = entry.value.choices.project;
      if (!project) return yield* new DraftSubmissionError({ message: "Choose a project." });
      return yield* withBrowserLock(
        // oxlint-disable-next-line effecttsgo/prefer-schema-over-json -- An unambiguous opaque native lock name, not serialized domain data.
        JSON.stringify(["ocui-project", serverKey, project.id]),
        Effect.gen(function* () {
          if (attempt.phase === "preparing") {
            yield* persist({
              ...attempt,
              message:
                entry.value.choices.mode === "worktree"
                  ? "Preparing worktree…"
                  : "Preparing local checkout…",
            });
            yield* validate(entry, project.location);
            const location = yield* prepare(entry);
            yield* persist({ ...attempt, location });
            yield* validate(entry, location);
            yield* persist({
              ...attempt,
              location,
              phase: "creating",
              result: undefined,
              message: undefined,
            });
            const session = yield* effects.request(
              () =>
                data.session.create({
                  id: attempt.sessionID,
                  projectID: project.id,
                  location: { ...location },
                  agent: entry.value.choices.agent,
                  model: entry.value.choices.model ? { ...entry.value.choices.model } : undefined,
                }).request,
            );
            yield* persist({ ...attempt, confirmed: true, location: { ...session.location } });
          }
          if (!attempt.location)
            return yield* new DraftSubmissionError({
              message: "The session location is unavailable.",
            });
          if (attempt.phase === "sending") {
            if (attempt.request.kind === "command")
              return yield* new DraftSubmissionError({
                message:
                  "The command may have run. Open the session to inspect it; it will not be sent again.",
              });
            const message = yield* effects
              .request((signal) =>
                api.session.message(
                  {
                    sessionID: attempt.sessionID,
                    messageID: attempt.request.kind === "prompt" ? attempt.request.id : "",
                  },
                  { signal },
                ),
              )
              .pipe(Effect.result);
            if (
              message._tag === "Success" &&
              message.success.type === "user" &&
              message.success.id === attempt.request.id
            ) {
              yield* persist({ ...attempt, phase: "accepted" });
              yield* accepted(id, attempt);
              return undefined;
            }
            // A failed read is not proof of absence. Prompt retries keep the same server idempotency ID.
          }
          yield* validate(entry, attempt.location);
          const request = attempt.request;
          yield* submitSessionInput(
            effects,
            runtime,
            {
              sessionID: attempt.sessionID,
              files: entry.files?.map((item) => item.file) ?? [],
              delivery: "steer",
              ...(request.kind === "prompt"
                ? {
                    kind: "prompt" as const,
                    id: request.id,
                    prompt: createSessionPrompt({
                      instruction: entry.value.text,
                      skills: entry.value.skills,
                      reviewComments: [],
                      annotations: [],
                    }),
                  }
                : { ...request, skills: entry.value.skills }),
            },
            persist({ ...attempt, phase: "sending", result: undefined, message: undefined }),
          );
          attempt = { ...attempt, phase: "accepted" };
          yield* persist(attempt);
          yield* accepted(id, attempt);
          return undefined;
        }),
      );
    });
    yield* work.pipe(
      Effect.catch((error) =>
        service
          .updateSubmission(id, attempt.sessionID, {
            ...attempt,
            result: "failed",
            location: Schema.is(SessionWorktreeError)(error)
              ? (error.location ?? attempt.location)
              : attempt.location,
            message: errorMessage(error),
          })
          .pipe(
            Effect.catch((storageError) =>
              Effect.sync(() => service.reportError(id, errorMessage(storageError))),
            ),
          ),
      ),
      Effect.onInterrupt(() =>
        service
          .updateSubmission(id, attempt.sessionID, {
            ...attempt,
            result: "interrupted",
            message: "Submission was interrupted. Nothing will be sent automatically.",
          })
          .pipe(
            Effect.catch((error) =>
              Effect.sync(() => service.reportError(id, errorMessage(error))),
            ),
          ),
      ),
      Effect.ensuring(Effect.sync(() => service.setBusy(id, false))),
    );
  });
  const submit = (id: string) => {
    const entry = service.get(id);
    if (!entry || entry.busy || entry.loading || entry.conflict || !entry.files) return;
    if (entry.value.attempt?.phase === "creating" && !entry.value.attempt.confirmed) return;
    active.add(id);
    service.setBusy(id, true);
    effects.runFork(
      withBrowserLock(
        draftLockName(serverKey, id),
        Effect.gen(function* () {
          let current = service.get(id)!;
          if (current.value.attempt?.phase === "preparing" && current.value.attempt.result) {
            yield* service.resetSubmission(id);
            current = service.get(id)!;
          }
          let attempt = current.value.attempt;
          if (!attempt) {
            const target = current.value.choices.project?.location;
            if (!target) return yield* new DraftSubmissionError({ message: "Choose a project." });
            yield* effects.request(() => data.location.command.sync(target));
            if (!data.location.command.list(target))
              return yield* new DraftSubmissionError({ message: "Commands could not be loaded." });
            const command = parseSessionCommand(
              current.value.text,
              data.location.command.list(target)?.map((item) => item.name) ?? [],
            );
            attempt = {
              sessionID: SessionID.create(),
              phase: "preparing",
              message: "Waiting for project…",
              request: command
                ? { kind: "command", ...command }
                : { kind: "prompt", id: SessionMessage.ID.create() },
            };
            const captured = yield* service
              .beginSubmission(id, attempt)
              .pipe(Effect.uninterruptible);
            if (!captured) return undefined;
            current = captured;
          }
          return yield* send(id, current, attempt);
        }).pipe(
          Effect.onInterrupt(() =>
            Effect.suspend(() => {
              const interrupted = service.get(id)?.value.attempt;
              if (!interrupted || interrupted.result) return Effect.void;
              return service
                .updateSubmission(id, interrupted.sessionID, {
                  ...interrupted,
                  result: "interrupted",
                  message: "Submission was interrupted. Nothing will be sent automatically.",
                })
                .pipe(
                  Effect.catch((error) =>
                    Effect.sync(() => service.reportError(id, errorMessage(error))),
                  ),
                );
            }),
          ),
        ),
        true,
      ).pipe(
        Effect.catch((error) => Effect.sync(() => service.reportError(id, errorMessage(error)))),
        Effect.ensuring(
          Effect.sync(() => {
            active.delete(id);
            service.setBusy(id, false);
          }),
        ),
      ),
    );
  };
  const checkSession = (id: string) => {
    const entry = service.get(id);
    const attempt = entry?.value.attempt;
    if (!attempt || entry.busy) return;
    service.setBusy(id, true);
    effects.runFork(
      withBrowserLock(
        draftLockName(serverKey, id),
        Effect.gen(function* () {
          const session = yield* effects.request((signal) =>
            api.session.get({ sessionID: attempt.sessionID }, { signal }),
          );
          data.session.remember(session);
          yield* service.updateSubmission(id, attempt.sessionID, {
            ...attempt,
            confirmed: true,
            location: { ...session.location },
            result: attempt.result ?? "interrupted",
            message: "Session found. Open it, or send the saved message to this session.",
          });
        }),
        true,
      ).pipe(
        Effect.catch(() =>
          Effect.sync(() =>
            service.reportError(
              id,
              "The session could not be confirmed. No creation or Send was retried.",
            ),
          ),
        ),
        Effect.ensuring(Effect.sync(() => service.setBusy(id, false))),
      ),
    );
  };
  return { submit, checkSession, active: (id: string) => active.has(id) };
}
