import { useAtomValue } from "@effect/atom-solid";
import { Effect, Schema } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { ProjectID } from "@opencode/schema/project-id";
import { getFilename } from "@opencode/util/path";
import type { LocationRef } from "@opencode/client";
import { createEffect, createMemo, on, onCleanup } from "solid-js";
import type { ConnectedRuntime } from "../../../../opencode/runtime.ts";
import { modelChoiceID } from "../../../../opencode/model-selection.ts";
import {
  createDraftSubmission,
  type DraftSubmissionRuntime,
} from "../../../../new-session/submit.ts";
import { readLocalBranches } from "../../../../opencode/local-branches.ts";
import {
  draftTitle,
  lockedDraft,
  meaningfulDraft,
  type DraftChoices,
  type NewSessionDrafts,
} from "../../../../new-session/drafts.ts";
import type { SessionWorkspace } from "../Sessions/createSessionWorkspace.ts";
import { createComposerCatalog } from "./createComposerCatalog.ts";
import type { NewSessionSetupProps } from "./NewSessionScreen/NewSessionSetup.tsx";
import type { ComposerProps } from "./SessionPane/Composer.tsx";

type DraftRuntime = DraftSubmissionRuntime & {
  defaultLocation: ConnectedRuntime["defaultLocation"];
  stream: Pick<ConnectedRuntime["stream"], "status">;
  data: { project: Pick<ConnectedRuntime["data"]["project"], "list" | "sync" | "invalidate"> };
  api: {
    file: Pick<ConnectedRuntime["api"]["file"], "list">;
    model: Pick<ConnectedRuntime["api"]["model"], "default">;
    project: Pick<ConnectedRuntime["api"]["project"], "current">;
  };
};

class ProjectDirectoryError extends Schema.TaggedError<ProjectDirectoryError>()(
  "ProjectDirectoryError",
  { message: Schema.String },
) {}

/** Workspace adapts server catalogs and navigation; renderer owns durable content. */
export function createNewSessionDrafts(
  runtime: DraftRuntime,
  sessions: Pick<
    SessionWorkspace,
    "selectedDraftID" | "selectDraft" | "selectedSession" | "sessions" | "select"
  >,
  service: NewSessionDrafts["Service"],
  serverKey: string,
) {
  const effects = runtime.effects;
  const entries = useAtomValue(() => service.state);
  const storage = useAtomValue(() => service.status);
  const state = Atom.make<{
    projects: "loading" | "ready" | "failed";
    catalogs: "loading" | "ready" | "failed";
    branches: readonly string[];
    currentBranch?: string;
    defaultBranch?: string;
    defaultModel?: DraftChoices["model"];
    catalogLocationKey?: string;
    error?: string;
    adding?: boolean;
    addError?: string;
    addDraftID?: string;
  }>({ projects: "loading", catalogs: "loading", branches: [] });
  effects.mount(state);
  const current = useAtomValue(() => state);
  const projectsState = createMemo(() => current().projects);
  const update = (patch: Partial<Atom.Type<typeof state>>) =>
    effects.registry.update(state, (value) => ({ ...value, ...patch }));
  const selectedID = sessions.selectedDraftID;
  const submission = createDraftSubmission(runtime, service, serverKey, (id, sessionID) => {
    if (selectedID() === id) {
      sessions.selectDraft(undefined);
      sessions.select(sessionID);
    }
  });
  const selected = createMemo(() => {
    const id = selectedID();
    return id ? entries().get(id) : undefined;
  });
  const location = createMemo(() => selected()?.value.choices.project?.location);
  const projects = () =>
    runtime.data.project
      .list()
      .filter((item) => item.id !== ProjectID.global)
      .map((item) => {
        const projectLocation: LocationRef = { directory: item.canonical };
        if (runtime.defaultLocation.workspaceID)
          projectLocation.workspaceID = runtime.defaultLocation.workspaceID;
        return {
          id: item.id,
          label:
            item.name?.trim() && item.name !== item.canonical
              ? item.name
              : getFilename(item.canonical) || item.canonical,
          detail: item.canonical,
          vcs: item.vcs,
          location: projectLocation,
        };
      });
  const project = () =>
    projects().find((item) => item.id === selected()?.value.choices.project?.id);
  const catalog = createComposerCatalog({
    effects,
    sources: { commands: runtime.data.location.command, skills: runtime.data.location.skill },
    location,
    connected: () => runtime.stream.status() === "connected",
  });
  const read = effects.latest();
  const opening = effects.latest();
  const run = <A, E>(effect: Effect.Effect<A, E>) =>
    effects.runFork(effect.pipe(Effect.catch(() => Effect.void)));
  const edit = (id: string, patch: Parameters<NewSessionDrafts["Service"]["edit"]>[1]) =>
    effects.runSync(service.edit(id, patch));
  const flushSelected = () => {
    const id = selectedID();
    if (id) run(service.flush(id));
  };
  const choicesForProject = (chosen: DraftChoices["project"]): DraftChoices => ({
    ...service.choices(serverKey, chosen),
    project: chosen,
    mode: service.choices(serverKey, chosen).mode ?? "local",
  });
  const create = () => {
    if (current().projects === "loading" || storage().get(serverKey)?.loading) return;
    const old = selected();
    if (old && !old.saved && !meaningfulDraft(old.value)) return;
    const remembered = service.choices(serverKey);
    const previous = sessions
      .sessions()
      .filter((session) => !session.parentID)
      .toSorted((left, right) => right.time.created - left.time.created)[0];
    const fallback =
      projects().find((item) => item.id === sessions.selectedSession()?.projectID) ??
      projects().find((item) => item.id === previous?.projectID) ??
      projects().find((item) => item.location.directory === runtime.defaultLocation.directory);
    const choices = choicesForProject(
      remembered.project ??
        (fallback ? { id: fallback.id, location: fallback.location } : undefined),
    );
    const id = effects.runSync(
      service.create(serverKey, {
        ...choices,
        agent: previous?.agent,
        // SDK session fields can be Solid store proxies; persist plain model data.
        model: previous?.model
          ? {
              id: previous.model.id,
              providerID: previous.model.providerID,
              variant: previous.model.variant,
            }
          : undefined,
      }),
    );
    sessions.selectDraft(id);
  };
  const loadProjects = () =>
    run(
      service.hydrate(serverKey).pipe(
        Effect.andThen(effects.request(() => runtime.data.project.sync())),
        Effect.match({
          onSuccess: () => update({ projects: "ready" }),
          onFailure: () =>
            update({
              projects: "failed",
              error: "Projects could not be loaded. Retry to continue.",
            }),
        }),
      ),
    );
  loadProjects();
  createEffect(
    on(selectedID, (_id, previous) => {
      if (previous) {
        run(service.flush(previous));
        service.release(previous);
      }
    }),
  );
  const openKey = createMemo(() => JSON.stringify([selectedID(), selected()?.saved?.revision]));
  createEffect(
    on(openKey, () => {
      const id = selectedID();
      if (id) opening.run(service.open(id));
      else opening.cancel();
    }),
  );
  createEffect(() => {
    const id = selectedID();
    if (id && !entries().has(id) && !submission.active(id)) sessions.selectDraft(undefined);
  });
  const locationKey = createMemo(() => {
    const value = location();
    return value ? JSON.stringify([value.directory, value.workspaceID]) : undefined;
  });
  const refreshCatalogs = () => {
    const target = location();
    const id = selectedID();
    const git = project()?.vcs === "git";
    update({
      catalogs: "loading",
      branches: [],
      error: undefined,
      currentBranch: undefined,
      defaultBranch: undefined,
      defaultModel: undefined,
      catalogLocationKey: undefined,
    });
    if (!target || !id || !project()) {
      read.run(Effect.void);
      update({ catalogs: "failed" });
      return;
    }
    read.run(
      Effect.gen(function* () {
        yield* effects
          .request((signal) =>
            runtime.api.file.list(
              {
                location: { directory: target.directory, workspace: target.workspaceID },
                path: ".",
              },
              { signal },
            ),
          )
          .pipe(
            Effect.mapError(
              () =>
                new ProjectDirectoryError({
                  message: `The project directory could not be opened: ${target.directory}. Choose another project or retry.`,
                }),
            ),
          );
        const [, , vcs, branches, model] = yield* Effect.all(
          [
            effects.request(() => runtime.data.location.model.sync(target)),
            effects.request(() => runtime.data.location.agent.sync(target)),
            git
              ? effects.request((signal) =>
                  runtime.api.vcs.get(
                    { location: { directory: target.directory, workspace: target.workspaceID } },
                    { signal },
                  ),
                )
              : Effect.void,
            git
              ? readLocalBranches(effects, runtime.api, target)
              : Effect.succeed<readonly string[]>([]),
            effects.request((signal) =>
              runtime.api.model.default(
                { location: { directory: target.directory, workspace: target.workspaceID } },
                { signal },
              ),
            ),
          ],
          { concurrency: "unbounded" },
        );
        update({
          catalogs: "ready",
          branches,
          currentBranch: vcs?.data.branch.current,
          defaultBranch: vcs?.data.branch.default,
          defaultModel: model.data?.enabled
            ? { id: model.data.id, providerID: model.data.providerID }
            : undefined,
          catalogLocationKey: locationKey(),
        });
      }).pipe(
        Effect.catch((error) =>
          Effect.logWarning("New-session project choices could not be loaded", {
            directory: target.directory,
            error,
          }).pipe(
            Effect.andThen(
              Effect.sync(() =>
                update({
                  catalogs: "failed",
                  error: Schema.is(ProjectDirectoryError)(error)
                    ? error.message
                    : "Project choices could not be loaded. Retry to continue.",
                }),
              ),
            ),
          ),
        ),
      ),
    );
  };
  createEffect(
    on(
      () => [locationKey(), selectedID(), projectsState(), runtime.stream.status()],
      refreshCatalogs,
    ),
  );
  createEffect(() => {
    const entry = selected();
    const catalogs = current();
    const target = location();
    const item = project();
    if (
      !entry ||
      !target ||
      !item ||
      !entry.files ||
      entry.loading ||
      lockedDraft(entry) ||
      entry.conflict ||
      catalogs.catalogs !== "ready" ||
      catalogs.catalogLocationKey !== locationKey()
    )
      return;
    const choices = entry.value.choices;
    const next = { ...choices };
    if (!choices.branch && item.vcs === "git") {
      const name = choices.mode === "worktree" ? catalogs.defaultBranch : catalogs.currentBranch;
      if (name) next.branch = { kind: "existing", name };
      next.branchSource = "default";
    }
    if (item.vcs !== "git") {
      next.mode = "local";
      next.branch = undefined;
      next.branchSource = undefined;
    }
    if (!choices.agent)
      next.agent = runtime.data.location.agent
        .list(target)
        ?.find((agent) => agent.mode !== "subagent" && !agent.hidden)?.id;
    if (!choices.model) next.model = catalogs.defaultModel;
    if (
      (["mode", "branch", "branchSource", "agent", "model"] as const).some(
        (field) => next[field] !== choices[field],
      )
    )
      effects.runSync(service.edit(entry.value.id, { choices: next }, { remember: false }));
  });
  onCleanup(() => {
    read.cancel();
    opening.cancel();
    const id = selectedID();
    if (id) service.release(id);
  });
  const changeProject = (id: string, chosen: NonNullable<DraftChoices["project"]>) =>
    edit(id, { choices: choicesForProject(chosen) });
  const changeChoices = (patch: Partial<DraftChoices>) => {
    const entry = selected();
    if (entry) edit(entry.value.id, { choices: { ...entry.value.choices, ...patch } });
  };
  const setup = (): NewSessionSetupProps => ({
    projects: projects(),
    projectID: selected()?.value.choices.project?.id,
    mode: selected()?.value.choices.mode ?? "local",
    branches: current().branches,
    branch: selected()?.value.choices.branch,
    defaultBranch: current().defaultBranch ?? "default branch",
    git: project()?.vcs === "git",
    disabled: lockedDraft(selected()) || selected()?.loading || selected()?.conflict,
    loading: current().projects === "loading",
    onProjectChange: (id) => {
      const item = projects().find((candidate) => candidate.id === id);
      const draft = selected();
      if (item && draft) changeProject(draft.value.id, { id, location: item.location });
    },
    onModeChange: (mode) => {
      const choices = selected()?.value.choices;
      if (!choices || mode === choices.mode) return;
      if (
        choices.branchSource === "default" ||
        !choices.branch ||
        (mode === "worktree" && choices.branch.kind === "new")
      ) {
        const name = mode === "worktree" ? current().defaultBranch : current().currentBranch;
        changeChoices({
          mode,
          branch: name ? { kind: "existing", name } : undefined,
          branchSource: "default",
        });
      } else changeChoices({ mode });
    },
    onBranchChange: (branch) => changeChoices({ branch, branchSource: undefined }),
    onAddProject: () => {
      const id = selectedID();
      if (id) update({ addDraftID: id, addError: undefined });
    },
  });
  const models = () =>
    (location() ? runtime.data.location.model.list(location()) : [])?.filter(
      (model) => model.enabled,
    ) ?? [];

  const agents = () =>
    (location() ? runtime.data.location.agent.list(location()) : [])?.filter(
      (agent) => !agent.hidden && agent.mode !== "subagent",
    ) ?? [];
  const savedChoiceError = () => {
    if (selected()?.value.attempt) return undefined;
    const choices = selected()?.value.choices;
    if (!choices) return undefined;
    if (choices.project && !project()) return "The saved project is unavailable. Choose a project.";
    if (current().catalogs !== "ready") return undefined;
    if (choices.branch?.kind === "new" && !choices.branch.name.trim())
      return "Enter a branch name.";
    if (choices.branch?.kind === "existing" && !current().branches.includes(choices.branch.name))
      return "The saved branch is unavailable. Choose a branch.";
    const reference = choices.model;
    if (reference) {
      const model = models().find((item) => modelChoiceID(item) === modelChoiceID(reference));
      if (!model) return "The saved model is unavailable. Choose a model.";
      if (reference.variant && !model.variants.some((variant) => variant.id === reference.variant))
        return "The saved model variant is unavailable. Choose a variant.";
    }
    if (choices.agent && !agents().some((agent) => agent.id === choices.agent))
      return "The saved agent is unavailable. Choose an agent.";
    return undefined;
  };
  const editChoices = (id: string, patch: Partial<DraftChoices>) => {
    const entry = service.get(id);
    if (entry) edit(id, { choices: { ...entry.value.choices, ...patch } });
  };
  const modelSelection = (id: string): ComposerProps["modelSelection"] => {
    const entry = entries().get(id);
    const reference = entry?.value.choices.model;
    const selectedModel = models().find(
      (option) => reference && modelChoiceID(option) === modelChoiceID(reference),
    );
    return {
      state: current().catalogs,
      switching: false,
      disabled: lockedDraft(entry) || entry?.loading === true,
      models: models().map((option) => ({
        id: modelChoiceID(option),
        label: option.name,
        group: option.providerID,
      })),
      selectedModelID: reference ? modelChoiceID(reference) : undefined,
      variants:
        selectedModel?.variants.map((variant) => ({ id: variant.id, label: variant.id })) ?? [],
      selectedVariantID: reference?.variant,
      onSelectModel: (choiceID) => {
        const chosen = models().find((option) => modelChoiceID(option) === choiceID);
        if (chosen) editChoices(id, { model: { id: chosen.id, providerID: chosen.providerID } });
      },
      onSelectVariant: (variant) => {
        if (reference) editChoices(id, { model: { ...reference, variant } });
      },
    };
  };
  const agentSelection = (id: string): ComposerProps["agentSelection"] => {
    const entry = entries().get(id);
    return {
      state: current().catalogs,
      switching: false,
      disabled: lockedDraft(entry) || entry?.loading === true,
      agents: agents().map((option) => ({ id: option.id, label: option.name })),
      selectedAgentID: entry?.value.choices.agent,
      onSelectAgent: (agent) => editChoices(id, { agent }),
    };
  };
  const submissionDisabled = (entry: ReturnType<typeof service.get>) => {
    if (
      !entry ||
      !meaningfulDraft(entry.value) ||
      entry.busy ||
      !entry.files ||
      entry.loading ||
      entry.conflict ||
      runtime.stream.status() !== "connected"
    )
      return true;
    const attempt = entry.value.attempt;
    if (!attempt) return current().catalogs !== "ready" || !!savedChoiceError();
    return (
      (attempt.phase === "creating" && !attempt.confirmed) ||
      (attempt.phase === "sending" && attempt.request.kind === "command")
    );
  };
  const composer = (id: string): ComposerProps => {
    const entry = entries().get(id);
    return {
      value: entry?.value.text ?? "",
      skills: entry?.value.skills,
      catalog,
      files: entry?.files?.map((item) => item.file),
      readOnly: !!(lockedDraft(entry) || entry?.loading || (entry?.saved && !entry.files)),
      action: entry?.busy ? "sending" : "send",
      disabled: submissionDisabled(entry),
      error:
        entry?.error ??
        entry?.notice ??
        savedChoiceError() ??
        current().error ??
        storage().get(serverKey)?.error,
      onInput: (text, skills = []) => edit(id, { text, skills }),
      onSubmit: () => submission.submit(id),
      onAttachFiles: (files) => effects.runSync(service.attachFiles(id, files)),
      onRemoveFile: (file) => effects.runSync(service.removeFile(id, file)),
      onAttachText: (text) =>
        effects.runSync(
          service.attachFiles(id, [new File([text], "pasted-text.txt", { type: "text/plain" })]),
        ),
      modelSelection: modelSelection(id),
      agentSelection: agentSelection(id),
    };
  };
  const addProject = (target: LocationRef) => {
    const id = current().addDraftID;
    if (!id || current().adding) return;
    update({ adding: true, addError: undefined });
    run(
      effects
        .request((signal) =>
          runtime.api.project.current(
            { location: { directory: target.directory, workspace: target.workspaceID } },
            { signal },
          ),
        )
        .pipe(
          Effect.tap(() => {
            runtime.data.project.invalidate();
            return effects.request(() => runtime.data.project.sync());
          }),
          Effect.match({
            onSuccess: (addedProject) => {
              changeProject(id, { id: addedProject.id, location: target });
              update({ adding: false, addDraftID: undefined, projects: "ready" });
            },
            onFailure: () => update({ adding: false, addError: "The project could not be added." }),
          }),
        ),
    );
  };
  return {
    selectedID,
    selected,
    submit: submission.submit,
    checkSession: submission.checkSession,
    editFailedDraft: (id: string) => run(service.resetSubmission(id)),
    openSession: (id: string) => {
      const attempt = service.get(id)?.value.attempt;
      if (attempt?.confirmed) sessions.select(attempt.sessionID);
    },
    operationStatus: () => {
      const entry = selected();
      const attempt = entry?.value.attempt;
      if (!attempt)
        return entry?.busy ? { kind: "preparing" as const, message: "Saving message…" } : undefined;
      return {
        kind:
          entry?.busy || !attempt.result
            ? ("preparing" as const)
            : attempt.result === "interrupted"
              ? ("interrupted" as const)
              : ("error" as const),
        message:
          (!entry?.busy || !attempt.result ? attempt.message : undefined) ??
          (attempt.phase === "preparing"
            ? "Preparing checkout or worktree…"
            : attempt.phase === "creating"
              ? "Creating session…"
              : attempt.phase === "accepted"
                ? "Removing saved draft…"
                : "Sending message…"),
      };
    },
    create,
    setup,
    composer,
    flushSelected,
    addProject,
    current,
    canCreate: () => current().projects !== "loading" && !storage().get(serverKey)?.loading,
    retry: () => {
      const id = selectedID();
      if (id) {
        run(service.open(id));
        run(service.flush(id));
      }
      if (current().projects === "failed" || storage().get(serverKey)?.error) loadProjects();
      refreshCatalogs();
    },
    dismissAddProject: () => {
      if (!current().adding) update({ addDraftID: undefined });
    },
    list: () =>
      [...entries().values()]
        .filter(
          (entry) =>
            entry.value.serverKey === serverKey && (entry.saved || meaningfulDraft(entry.value)),
        )
        .map((entry) => ({
          id: entry.value.id,
          title: draftTitle(entry.value),
          status:
            entry.busy || (entry.value.attempt && !entry.value.attempt.result)
              ? ("preparing" as const)
              : entry.error || entry.conflict || entry.value.attempt?.result
                ? ("error" as const)
                : undefined,
          statusMessage: entry.value.attempt?.message ?? entry.error,
          deleting: entry.busy,
        })),
    select: (id: string) => sessions.selectDraft(id),
    delete: (id: string) => run(service.delete(id)),
    keepCopy: (id: string) =>
      run(
        service.keepCopy(id).pipe(
          Effect.tap((copyID) =>
            Effect.sync(() => {
              if (!copyID) return;
              if (selectedID() === id) sessions.selectDraft(copyID);
              else service.release(copyID);
            }),
          ),
        ),
      ),
    loadSavedVersion: (id: string) => run(service.useSavedVersion(id)),
  };
}
