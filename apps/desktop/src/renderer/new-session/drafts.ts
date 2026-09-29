import { Clock, Context, Deferred, Effect, Queue, Schema, Scope } from "effect";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import type { PromptSkillAttachment } from "@opencode/client";
import { draftLockName, withBrowserLock } from "./locks.ts";
import { Storage, StorageError } from "../storage.ts";
import { admitAttachments } from "../opencode/attachments.ts";

const Location = Schema.Struct({
  directory: Schema.String,
  workspaceID: Schema.optional(Schema.String),
});
const Branch = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("existing"), name: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("new"), name: Schema.String }),
]);
const Choices = Schema.Struct({
  project: Schema.optional(Schema.Struct({ id: Schema.String, location: Location })),
  mode: Schema.Literals(["local", "worktree"]),
  branch: Schema.optional(Branch),
  branchSource: Schema.optional(Schema.Literal("default")),
  agent: Schema.optional(Schema.String),
  model: Schema.optional(
    Schema.Struct({
      id: Schema.String,
      providerID: Schema.String,
      variant: Schema.optional(Schema.String),
    }),
  ),
});
const Skill = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  text: Schema.optional(Schema.String),
  mention: Schema.optional(
    Schema.Struct({ start: Schema.Finite, end: Schema.Finite, text: Schema.String }),
  ),
});
const Descriptor = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  type: Schema.String,
  lastModified: Schema.Finite,
});
const describeFile = ({ id, file }: { readonly id: string; readonly file: File }) => ({
  id,
  name: file.name,
  type: file.type,
  lastModified: file.lastModified,
});
const Attempt = Schema.Struct({
  sessionID: Schema.String,
  phase: Schema.Literals(["preparing", "creating", "sending", "accepted"]),
  location: Schema.optional(Location),
  confirmed: Schema.optional(Schema.Boolean),
  request: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("prompt"), id: Schema.String }),
    Schema.Struct({
      kind: Schema.Literal("command"),
      name: Schema.String,
      arguments: Schema.String,
    }),
  ]),
  result: Schema.optional(Schema.Literals(["failed", "interrupted"])),
  message: Schema.optional(Schema.String),
});
export type DraftAttempt = typeof Attempt.Type;
export const lockedDraft = (entry: DraftEntry | undefined) =>
  !!(entry?.busy || entry?.value.attempt);
const Record = Schema.Struct({
  id: Schema.String,
  serverKey: Schema.String,
  revision: Schema.Finite,
  created: Schema.Finite,
  updated: Schema.Finite,
  choices: Choices,
  text: Schema.String,
  skills: Schema.Array(Skill),
  attachments: Schema.Array(Descriptor),
  attempt: Schema.optional(Attempt),
});
export type DraftChoices = typeof Choices.Type;
export type DraftRecord = typeof Record.Type;
export type DraftEntry = {
  readonly value: DraftRecord;
  readonly saved?: DraftRecord;
  readonly files?: readonly { readonly id: string; readonly file: File }[];
  readonly error?: string;
  readonly notice?: string;
  readonly conflict?: boolean;
  readonly busy?: boolean;
  readonly loading?: boolean;
};
type Preference = {
  readonly key: string;
  readonly project?: DraftChoices["project"];
  mode?: DraftChoices["mode"];
  branch?: DraftChoices["branch"];
};
const PreferenceSchema = Schema.Struct({
  key: Schema.String,
  project: Schema.optional(Choices.fields.project.schema),
  mode: Schema.optional(Choices.fields.mode),
  branch: Schema.optional(Branch),
});
const decodeRecord = Schema.decodeUnknownSync(Record);
const decodePreference = Schema.decodeUnknownSync(PreferenceSchema);
const FileRecord = Schema.Struct({
  id: Schema.String,
  draftID: Schema.String,
  blob: Schema.instanceOf(Blob),
  name: Schema.String,
  type: Schema.String,
  lastModified: Schema.Finite,
});
const decodeFile = Schema.decodeUnknownSync(FileRecord);
export const draftDatabase = {
  name: "ocui",
  version: 1,
  upgrade: (db: IDBDatabase) => {
    db.createObjectStore("drafts", { keyPath: "id" }).createIndex("serverKey", "serverKey");
    db.createObjectStore("attachments", { keyPath: "id" }).createIndex("draftID", "draftID");
    db.createObjectStore("preferences", { keyPath: "key" });
  },
};
export const draftTitle = (draft: DraftRecord) =>
  draft.text
    .split(/\r?\n/u)
    .find((line) => line.trim())
    ?.trim() ||
  draft.attachments[0]?.name ||
  draft.skills[0]?.name ||
  "Untitled draft";
export const meaningfulDraft = (draft: DraftRecord) =>
  !!(draft.text.trim() || draft.skills.length || draft.attachments.length);
const projectKey = (serverKey: string, project: NonNullable<DraftChoices["project"]>) =>
  JSON.stringify([serverKey, project.location.directory, project.location.workspaceID ?? null]);

function mergePreference(
  saved: Preference,
  pending: Preference | undefined,
  before: Preference | undefined,
): Preference {
  if (!pending || pending === before) return saved;
  const value = { ...saved };
  if (pending.project !== before?.project) value.project = pending.project;
  if (pending.mode !== before?.mode) value.mode = pending.mode;
  if (pending.branch !== before?.branch) value.branch = pending.branch;
  return value;
}

const preferenceChanges = (
  serverKey: string,
  previous: DraftChoices = { mode: "local" },
  choices: DraftChoices,
): readonly Preference[] => {
  const project = choices.project;
  if (!project) return [];
  const changedProject =
    project.id !== previous.project?.id ||
    projectKey(serverKey, project) !==
      (previous.project ? projectKey(serverKey, previous.project) : undefined);
  const changes: Preference[] = changedProject ? [{ key: serverKey, project }] : [];
  const preference: Preference = { key: projectKey(serverKey, project) };
  if (changedProject || choices.mode !== previous.mode) preference.mode = choices.mode;
  if (
    choices.branch?.kind === "existing" &&
    (changedProject ||
      choices.branchSource !== previous.branchSource ||
      choices.branch.kind !== previous.branch?.kind ||
      choices.branch.name !== previous.branch?.name)
  )
    preference.branch = choices.branch;
  if (preference.mode !== undefined || preference.branch !== undefined) changes.push(preference);
  return changes;
};

export const makeNewSessionDrafts = Effect.fn("NewSessionDrafts.make")(function* (
  registry: AtomRegistry.AtomRegistry,
) {
  const storage = yield* Storage;
  const scope = yield* Effect.scope;
  const state = Atom.make<ReadonlyMap<string, DraftEntry>>(new Map());
  const preferences = Atom.make<ReadonlyMap<string, Preference>>(new Map());
  const status = Atom.make<
    ReadonlyMap<string, { readonly loading: boolean; readonly error?: string }>
  >(new Map());
  const releases = [registry.mount(state), registry.mount(preferences), registry.mount(status)];
  yield* Effect.addFinalizer(() => Effect.sync(() => releases.forEach((release) => release())));
  const inactive = new Set<string>();
  const get = (id: string) => registry.get(state).get(id);
  const put = (id: string, entry: DraftEntry | undefined) =>
    registry.update(state, (current) => {
      const next = new Map(current);
      if (entry) next.set(id, entry);
      else {
        next.delete(id);
        inactive.delete(id);
      }
      return next;
    });
  const update = (id: string, patch: Partial<DraftEntry>) => {
    const entry = get(id);
    if (entry) put(id, { ...entry, ...patch });
  };
  const queue = yield* Queue.make<Effect.Effect<void>>();
  const accept = <A, E>(work: Effect.Effect<A, E>): Effect.Effect<A, E> =>
    Effect.gen(function* () {
      const result = yield* Deferred.make<A, E>();
      Queue.offerUnsafe(
        queue,
        work.pipe(
          Effect.exit,
          Effect.flatMap((exit) => Deferred.done(result, exit)),
          Effect.asVoid,
        ),
      );
      return yield* Deferred.await(result);
    });
  // One worker owns every accepted mutation. A caller only waits for its result.
  yield* Effect.forkScoped(Effect.forever(Queue.take(queue).pipe(Effect.flatten)));

  let channel: BroadcastChannel | undefined = new BroadcastChannel("ocui-drafts");
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel is origin-scoped and takes one argument.
  const notify = (serverKey: string) => channel?.postMessage(serverKey);
  const setStatus = (serverKey: string, value: { loading: boolean; error?: string }) =>
    registry.update(status, (current) => new Map(current).set(serverKey, value));
  const inspectSubmission = Effect.fn("NewSessionDrafts.inspectSubmission")(function* (
    record: DraftRecord,
  ) {
    if (record.attempt && !record.attempt.result) {
      const inspected = yield* withBrowserLock(
        draftLockName(record.serverKey, record.id),
        storage.transaction<DraftRecord>(["drafts"], "readwrite", (tx) => {
          tx.read(tx.store("drafts").get(record.id), (raw) => {
            const stored = decodeRecord(raw);
            if (!stored.attempt || stored.attempt.result) {
              tx.result(stored);
              return;
            }
            const interrupted = {
              ...stored,
              revision: stored.revision + 1,
              attempt: {
                ...stored.attempt,
                result: "interrupted" as const,
                message: "Submission was interrupted. Nothing will be sent automatically.",
              },
            };
            tx.store("drafts").put(interrupted);
            tx.result(interrupted);
          });
        }),
        true,
      ).pipe(Effect.result);
      if (inspected._tag === "Success") record = inspected.success;
    }
    return record;
  });
  const hydrate = Effect.fn("NewSessionDrafts.hydrate")(function* (serverKey: string) {
    setStatus(serverKey, { loading: true });
    const beforePreferences = registry.get(preferences);
    const loaded = yield* storage
      .transaction<{ records: unknown[]; prefs: unknown[] }>(
        ["drafts", "preferences"],
        "readonly",
        (tx) => {
          tx.read(tx.store("drafts").index("serverKey").getAll(serverKey), (records: unknown[]) => {
            tx.read(tx.store("preferences").getAll(), (prefs: unknown[]) =>
              tx.result({ records, prefs }),
            );
          });
        },
      )
      .pipe(Effect.result);
    if (loaded._tag === "Failure") {
      setStatus(serverKey, { loading: false, error: loaded.failure.message });
      return;
    }
    const ids = new Set<string>();
    let unreadable = false;
    for (const raw of loaded.success.records) {
      const decoded = yield* Effect.try(() => decodeRecord(raw)).pipe(Effect.result);
      if (decoded._tag === "Failure") {
        unreadable = true;
        continue;
      }
      let record = decoded.success;
      record = yield* inspectSubmission(record);
      ids.add(record.id);
      const entry = get(record.id);
      if (!entry) put(record.id, { value: record, saved: record });
      else if (entry.saved?.revision !== record.revision) {
        if (entry.value !== entry.saved || entry.busy)
          update(record.id, { conflict: true, error: "This draft changed in another window." });
        else put(record.id, { value: record, saved: record });
      }
    }
    for (const [id, entry] of registry.get(state)) {
      if (entry.value.serverKey !== serverKey || !entry.saved || ids.has(id) || unreadable)
        continue;
      if (entry.value !== entry.saved || entry.busy)
        update(id, { conflict: true, error: "This draft was deleted in another window." });
      else put(id, undefined);
    }
    const prefs = new Map(registry.get(preferences));
    for (const raw of loaded.success.prefs) {
      const decoded = yield* Effect.try(() => decodePreference(raw)).pipe(Effect.result);
      if (decoded._tag === "Failure") unreadable = true;
      else {
        const key = decoded.success.key;
        // Explicit choices made during the read are queued to persist afterward.
        prefs.set(
          key,
          mergePreference(decoded.success, prefs.get(key), beforePreferences.get(key)),
        );
      }
    }
    registry.set(preferences, prefs);
    setStatus(serverKey, {
      loading: false,
      error: unreadable
        ? "Some saved drafts or choices could not be read. They were left untouched."
        : undefined,
    });
  });
  const load = (id: string) =>
    storage.transaction<
      { value: DraftRecord; files: NonNullable<DraftEntry["files"]> } | undefined
    >(["drafts", "attachments"], "readonly", (tx) => {
      tx.read(tx.store("drafts").get(id), (raw) => {
        if (raw === undefined) {
          tx.result(undefined);
          return;
        }
        const value = decodeRecord(raw);
        const files: { id: string; file: File }[] = [];
        const next = (index: number) => {
          const descriptor = value.attachments[index];
          if (!descriptor) {
            tx.result({ value, files });
            return;
          }
          tx.read(tx.store("attachments").get(descriptor.id), (bytes) => {
            const stored = decodeFile(bytes);
            if (stored.draftID !== id) throw new Error("Attachment belongs to a different draft.");
            files.push({
              id: stored.id,
              file: new File([stored.blob], stored.name, {
                type: stored.type,
                lastModified: stored.lastModified,
              }),
            });
            next(index + 1);
          });
        };
        next(0);
      });
    });
  const open = Effect.fn("NewSessionDrafts.open")(function* (id: string) {
    inactive.delete(id);
    const before = get(id);
    if (!before || before.files || !before.saved || before.loading) return;
    update(id, { loading: true });
    yield* Effect.gen(function* () {
      const loaded = yield* load(id).pipe(Effect.result);
      const current = get(id);
      if (!current) return;
      if (loaded._tag === "Failure") {
        update(id, { loading: false, error: "This draft could not be loaded. Retry to open it." });
        return;
      }
      if (current.value !== before.value || current.busy) {
        update(id, { loading: false });
        return;
      }
      if (!loaded.success) {
        put(id, undefined);
        return;
      }
      put(id, {
        value: loaded.success.value,
        saved: loaded.success.value,
        files: inactive.has(id) ? undefined : loaded.success.files,
      });
    }).pipe(Effect.ensuring(Effect.sync(() => update(id, { loading: false }))));
  });
  const save = Effect.fn("NewSessionDrafts.save")(function* (id: string, persistEmpty = false) {
    const entry = get(id);
    if (
      !entry ||
      entry.conflict ||
      entry.value === entry.saved ||
      (!persistEmpty && !entry.saved && !meaningfulDraft(entry.value))
    )
      return;
    const snapshot = entry.value;
    const value = {
      ...snapshot,
      revision: (entry.saved?.revision ?? 0) + 1,
      updated: yield* Clock.currentTimeMillis,
    };
    const result = yield* storage
      .transaction<boolean>(["drafts", "attachments"], "readwrite", (tx) => {
        tx.read(tx.store("drafts").get(id), (raw) => {
          const previous = raw === undefined ? undefined : decodeRecord(raw);
          if (
            entry.saved
              ? previous?.revision !== entry.saved.revision || previous.attempt !== undefined
              : previous !== undefined
          ) {
            tx.result(false);
            return;
          }
          if (entry.saved) tx.store("drafts").put(value);
          else tx.store("drafts").add(value);
          for (const attachment of snapshot.attachments) {
            if (entry.saved?.attachments.some((saved) => saved.id === attachment.id)) continue;
            const file = entry.files?.find((candidate) => candidate.id === attachment.id)?.file;
            if (!file) throw new Error("Draft attachment is not loaded.");
            tx.store("attachments").add({ ...attachment, draftID: id, blob: file });
          }
          for (const attachment of entry.saved?.attachments ?? []) {
            if (!snapshot.attachments.some((current) => current.id === attachment.id))
              tx.store("attachments").delete(attachment.id);
          }
          tx.result(true);
        });
      })
      .pipe(Effect.result);
    if (result._tag === "Failure") {
      update(id, { error: result.failure.message });
      return;
    }
    if (!result.success) {
      update(id, { conflict: true, error: "This draft changed or was deleted in another window." });
      return;
    }
    const current = get(id);
    if (current)
      put(id, {
        ...current,
        value: current.value === snapshot ? value : current.value,
        saved: value,
        files:
          current.value === snapshot && inactive.has(id) && !current.busy
            ? undefined
            : current.files,
        error: undefined,
      });
    notify(value.serverKey);
  });
  const scheduled = new Set<string>();
  const schedule = (id: string) => {
    if (scheduled.has(id)) return;
    scheduled.add(id);
    Queue.offerUnsafe(
      queue,
      Effect.sync(() => scheduled.delete(id)).pipe(Effect.andThen(save(id))),
    );
  };
  const create = Effect.fn("NewSessionDrafts.create")(function* (
    serverKey: string,
    choices: DraftChoices,
  ) {
    // oxlint-disable-next-line effecttsgo/crypto-random-uuid-in-effect -- The pinned Effect RC has no UUID API; IDs must be unique across renderers.
    const id = crypto.randomUUID();
    const now = yield* Clock.currentTimeMillis;
    put(id, {
      value: {
        id,
        serverKey,
        revision: 0,
        created: now,
        updated: now,
        choices,
        text: "",
        skills: [],
        attachments: [],
      },
      files: [],
    });
    rememberChoices(serverKey, preferenceChanges(serverKey, undefined, choices));
    return id;
  });
  const rememberChoices = (serverKey: string, changes: readonly Preference[]) => {
    if (!changes.length) return;
    registry.update(preferences, (current) => {
      const next = new Map(current);
      for (const choice of changes) next.set(choice.key, { ...next.get(choice.key), ...choice });
      return next;
    });
    Queue.offerUnsafe(queue, remember(serverKey, changes));
  };
  const remember = Effect.fn("NewSessionDrafts.remember")(function* (
    serverKey: string,
    changes: readonly Preference[],
  ) {
    yield* storage
      .transaction<void>(["preferences"], "readwrite", (tx) => {
        for (const patch of changes)
          tx.read(tx.store("preferences").get(patch.key), (raw) => {
            const previous = raw === undefined ? {} : decodePreference(raw);
            const value = { ...previous, ...patch };
            tx.store("preferences").put(value);
          });
        tx.result(undefined);
      })
      .pipe(
        Effect.match({
          onFailure: (error) => setStatus(serverKey, { loading: false, error: error.message }),
          onSuccess: () => notify(serverKey),
        }),
      );
  });
  const edit = Effect.fn("NewSessionDrafts.edit")(
    (
      id: string,
      patch: { text?: string; skills?: readonly PromptSkillAttachment[]; choices?: DraftChoices },
      options: { remember?: boolean } = {},
    ) =>
      Effect.sync(() => {
        const entry = get(id);
        if (
          !entry ||
          lockedDraft(entry) ||
          entry.loading ||
          (!entry.files && entry.value.attachments.length)
        )
          return;
        put(id, { ...entry, value: { ...entry.value, ...patch } });
        schedule(id);
        if (patch.choices?.project && options.remember !== false) {
          const serverKey = entry.value.serverKey;
          rememberChoices(
            serverKey,
            preferenceChanges(serverKey, entry.value.choices, patch.choices),
          );
        }
      }),
  );
  const attachFiles = Effect.fn("NewSessionDrafts.attachFiles")(
    (id: string, incoming: readonly File[]) =>
      Effect.sync(() => {
        const entry = get(id);
        if (!entry || lockedDraft(entry) || !entry.files) return;
        const admitted = admitAttachments(
          entry.files.map((item) => item.file),
          incoming,
        );
        // oxlint-disable-next-line effecttsgo/crypto-random-uuid -- The pinned Effect RC has no UUID API; file IDs are shared across renderers.
        const added = admitted.admitted.map((file) => ({ id: crypto.randomUUID(), file }));
        put(id, {
          ...entry,
          files: [...entry.files, ...added],
          value: {
            ...entry.value,
            attachments: [...entry.value.attachments, ...added.map(describeFile)],
          },
          notice:
            admitted.tooLarge.length || admitted.overBudget.length
              ? "Some files exceed the attachment size or count limits."
              : undefined,
        });
        schedule(id);
      }),
  );
  const removeFile = Effect.fn("NewSessionDrafts.removeFile")((id: string, file: File) =>
    Effect.sync(() => {
      const entry = get(id);
      if (!entry || lockedDraft(entry)) return;
      const attachment = entry.files?.find((item) => item.file === file);
      if (!attachment) return;
      put(id, {
        ...entry,
        files: entry.files?.filter((item) => item.id !== attachment.id),
        value: {
          ...entry.value,
          attachments: entry.value.attachments.filter((item) => item.id !== attachment.id),
        },
      });
      schedule(id);
    }),
  );
  const flush = (id: string) =>
    accept(
      save(id).pipe(
        Effect.andThen(
          Effect.suspend(() => {
            const entry = get(id);
            return entry?.error || entry?.conflict
              ? Effect.fail(
                  new StorageError({ message: entry.error ?? "Draft conflict.", cause: undefined }),
                )
              : Effect.void;
          }),
        ),
      ),
    );
  const remove = Effect.fn("NewSessionDrafts.delete")(function* (id: string) {
    const entry = get(id);
    if (!entry || entry.busy) return;
    update(id, { busy: true });
    yield* accept(
      Effect.gen(function* () {
        const current = get(id);
        if (!current) return;
        const deleted = yield* storage
          .transaction<boolean>(["drafts", "attachments"], "readwrite", (tx) => {
            tx.read(tx.store("drafts").get(id), (raw) => {
              const stored = raw === undefined ? undefined : decodeRecord(raw);
              if (
                stored &&
                (stored.revision !== current.saved?.revision ||
                  (stored.attempt && !stored.attempt.result))
              ) {
                tx.result(false);
                return;
              }
              tx.store("drafts").delete(id);
              tx.read(tx.store("attachments").index("draftID").getAllKeys(id), (keys) => {
                keys.forEach((key) => tx.store("attachments").delete(key));
                tx.result(true);
              });
            });
          })
          .pipe(Effect.result);
        if (deleted._tag === "Failure") update(id, { busy: false, error: deleted.failure.message });
        else if (!deleted.success)
          update(id, {
            busy: false,
            conflict: true,
            error: "This draft changed in another window.",
          });
        else {
          put(id, undefined);
          notify(current.value.serverKey);
        }
      }),
    );
  });
  const useSavedVersion = Effect.fn("NewSessionDrafts.useSavedVersion")(function* (id: string) {
    const entry = get(id);
    if (!entry || entry.busy) return;
    update(id, { busy: true });
    yield* accept(
      load(id).pipe(
        Effect.match({
          onFailure: (error) => update(id, { busy: false, error: error.message }),
          onSuccess: (loaded) => {
            if (loaded)
              put(id, {
                value: loaded.value,
                saved: loaded.value,
                files: inactive.has(id) ? undefined : loaded.files,
              });
            else
              update(id, {
                busy: false,
                error: "The saved draft was deleted. Keep a separate copy to save your edits.",
              });
          },
        }),
      ),
    );
  });
  const keepCopy = Effect.fn("NewSessionDrafts.keepCopy")(function* (id: string) {
    const entry = get(id);
    if (
      !entry ||
      entry.busy ||
      (entry.value.attempt && !entry.value.attempt.result) ||
      !entry.files
    )
      return undefined;
    update(id, { busy: true });
    return yield* accept(
      Effect.gen(function* () {
        const copyID = yield* create(entry.value.serverKey, entry.value.choices);
        const copy = get(copyID)!;
        // oxlint-disable-next-line effecttsgo/crypto-random-uuid -- Copies need independent persisted file IDs; the pinned RC has no UUID API.
        const files = entry.files!.map((item) => ({ ...item, id: crypto.randomUUID() }));
        put(copyID, {
          ...copy,
          files,
          value: {
            ...copy.value,
            text: entry.value.text,
            skills: entry.value.skills,
            attachments: files.map(describeFile),
          },
        });
        yield* save(copyID, true);
        if (get(copyID)?.saved) {
          if (entry.saved) put(id, { value: entry.saved, saved: entry.saved });
          else update(id, { busy: false });
          Queue.offerUnsafe(queue, hydrate(entry.value.serverKey));
          return copyID;
        }
        put(copyID, undefined);
        update(id, {
          busy: false,
          error: "The separate copy could not be saved. Your original edits are retained.",
        });
        return undefined;
      }),
    );
  });
  const beginSubmission = (id: string, attempt: DraftAttempt) => {
    const entry = get(id);
    if (!entry || entry.loading || entry.conflict || entry.value.attempt)
      return Effect.fail(
        new StorageError({ message: "This draft cannot be submitted yet.", cause: undefined }),
      );
    update(id, { busy: true, error: undefined });
    return accept(
      Effect.gen(function* () {
        yield* save(id, true);
        const current = get(id);
        if (!current?.saved || current.error || current.conflict || current.value !== current.saved)
          return yield* new StorageError({
            message: current?.error ?? "The draft could not be captured.",
            cause: undefined,
          });
        return yield* transition(id, undefined, attempt);
      }),
    ).pipe(Effect.onError(() => Effect.sync(() => update(id, { busy: false }))));
  };
  const transition = Effect.fn("NewSessionDrafts.transition")(function* (
    id: string,
    sessionID: string | undefined,
    attempt: DraftAttempt | undefined,
  ) {
    const entry = get(id);
    if (!entry?.saved)
      return yield* new StorageError({
        message: "The saved draft is unavailable.",
        cause: undefined,
      });
    const changed = yield* storage.transaction<DraftRecord | undefined>(
      attempt ? ["drafts"] : ["drafts", "attachments"],
      "readwrite",
      (tx) => {
        tx.read(tx.store("drafts").get(id), (raw) => {
          const stored = raw === undefined ? undefined : decodeRecord(raw);
          if (
            !stored ||
            stored.revision !== entry.saved!.revision ||
            stored.attempt?.sessionID !== sessionID
          )
            throw new Error("This draft changed in another window.");
          if (!attempt) {
            tx.store("drafts").delete(id);
            tx.read(tx.store("attachments").index("draftID").getAllKeys(id), (keys) => {
              keys.forEach((key) => tx.store("attachments").delete(key));
              tx.result(undefined);
            });
            return;
          }
          const value = { ...stored, revision: stored.revision + 1, attempt };
          tx.store("drafts").put(value);
          tx.result(value);
        });
      },
    );
    if (changed)
      put(id, {
        ...entry,
        value: changed,
        saved: changed,
        busy: !attempt?.result,
        error: undefined,
      });
    else put(id, undefined);
    notify(entry.value.serverKey);
    return get(id);
  });
  const updateSubmission = (id: string, sessionID: string, attempt: DraftAttempt | undefined) =>
    accept(transition(id, sessionID, attempt));
  const resetSubmission = (id: string) =>
    accept(
      Effect.gen(function* () {
        const entry = get(id);
        if (entry?.value.attempt?.phase !== "preparing" || !entry.value.attempt.result) return;
        const next = { ...entry.value, attempt: undefined, revision: entry.value.revision + 1 };
        yield* storage.transaction<void>(["drafts"], "readwrite", (tx) => {
          tx.read(tx.store("drafts").get(id), (raw) => {
            const stored = decodeRecord(raw);
            if (
              stored.revision !== entry.saved?.revision ||
              stored.attempt?.sessionID !== entry.value.attempt?.sessionID
            )
              throw new Error("This draft changed in another window.");
            tx.store("drafts").put(next);
            tx.result(undefined);
          });
        });
        put(id, { ...entry, value: next, saved: next });
        notify(next.serverKey);
      }),
    );
  const run = Effect.runSyncWith(Context.add(yield* Effect.context(), Scope.Scope, scope));
  const reread = (serverKey: string) => run(Effect.forkIn(accept(hydrate(serverKey)), scope));
  const onMessage = (event: MessageEvent<unknown>) => {
    const parsed = Schema.decodeUnknownOption(Schema.String)(event.data);
    if (parsed._tag === "Some" && registry.get(status).has(parsed.value)) reread(parsed.value);
  };
  channel.addEventListener("message", onMessage);
  const activate = () => {
    if (document.visibilityState === "visible")
      for (const key of registry.get(status).keys()) reread(key);
  };
  document.addEventListener("visibilitychange", activate);
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      channel?.removeEventListener("message", onMessage);
      document.removeEventListener("visibilitychange", activate);
    }).pipe(
      Effect.andThen(accept(Effect.void)),
      Effect.andThen(
        Effect.sync(() => {
          channel?.close();
          channel = undefined;
        }),
      ),
    ),
  );
  return {
    state,
    status,
    beginSubmission,
    updateSubmission,
    resetSubmission,
    setBusy: (id: string, busy: boolean) => {
      const entry = get(id);
      update(id, {
        busy,
        files:
          !busy && inactive.has(id) && entry?.value === entry?.saved ? undefined : entry?.files,
      });
    },
    reportError: (id: string, error: string) => update(id, { error, busy: false }),
    get,
    create,
    edit,
    attachFiles,
    removeFile,
    flush,
    delete: remove,
    open,
    keepCopy,
    useSavedVersion,
    hydrate: (serverKey: string) => accept(hydrate(serverKey)),
    choices: (serverKey: string, project?: DraftChoices["project"]): Partial<DraftChoices> => {
      const prefs = registry.get(preferences);
      const selected = project ?? prefs.get(serverKey)?.project;
      const remembered = selected ? prefs.get(projectKey(serverKey, selected)) : undefined;
      return { project: selected, mode: remembered?.mode ?? "local", branch: remembered?.branch };
    },
    release: (id: string) => {
      inactive.add(id);
      const entry = get(id);
      if (entry && entry.value === entry.saved && !entry.busy) update(id, { files: undefined });
    },
  };
});
export class NewSessionDrafts extends Context.Service<
  NewSessionDrafts,
  Effect.Success<ReturnType<typeof makeNewSessionDrafts>>
>()("renderer/NewSessionDrafts") {}
