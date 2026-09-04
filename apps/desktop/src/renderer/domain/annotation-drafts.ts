import { Schema } from "effect";
import { createSignal } from "solid-js";

const NonBlankStringSchema = Schema.String.check(Schema.isPattern(/\S/));
const OffsetSchema = Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const AnnotationSourceSchema = Schema.Struct({
  messageID: NonBlankStringSchema,
  block: NonBlankStringSchema,
  textDigest: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  start: OffsetSchema,
  end: OffsetSchema,
}).check(Schema.makeFilter((source) => source.end > source.start));

/** A completed annotation; existing drafts may have an empty body while editing. */
export const TranscriptAnnotationSchema = Schema.Struct({
  id: NonBlankStringSchema,
  source: AnnotationSourceSchema,
  quote: NonBlankStringSchema,
  body: NonBlankStringSchema,
});

export type TranscriptAnnotation = typeof TranscriptAnnotationSchema.Type;

const isValidDraft = Schema.is(
  Schema.Struct({
    ...TranscriptAnnotationSchema.fields,
    body: Schema.String,
  }),
);

export type AnnotationDraftSnapshot = {
  readonly sessionID: string;
  readonly comments: readonly TranscriptAnnotation[];
};

export type AnnotationDraftStore = {
  readonly get: (sessionID: string) => readonly TranscriptAnnotation[];
  readonly add: (sessionID: string, annotation: Omit<TranscriptAnnotation, "id">) => string;
  readonly updateBody: (sessionID: string, id: string, body: string) => void;
  readonly remove: (sessionID: string, id: string) => void;
  readonly clear: (sessionID: string) => void;
  readonly take: (sessionID: string) => AnnotationDraftSnapshot;
  readonly restore: (snapshot: AnnotationDraftSnapshot) => void;
  readonly clearIfUnchanged: (snapshot: AnnotationDraftSnapshot) => boolean;
};

const EMPTY: readonly TranscriptAnnotation[] = Object.freeze([]);

type SessionComments = Readonly<Record<string, readonly TranscriptAnnotation[]>>;

/** Creates an in-memory, reactive annotation draft store keyed by session ID. */
export function createAnnotationDraftStore(): AnnotationDraftStore {
  const [sessions, setSessions] = createSignal<SessionComments>({});

  const read = (sessionID: string): readonly TranscriptAnnotation[] =>
    sessions()[sessionID] ?? EMPTY;

  const write = (sessionID: string, comments: readonly TranscriptAnnotation[]): void => {
    setSessions({ ...sessions(), [sessionID]: comments });
  };

  const clear = (sessionID: string): void => {
    if (sessions()[sessionID] === undefined) return;
    const next = { ...sessions() };
    delete next[sessionID];
    setSessions(next);
  };

  return {
    get: read,

    add: (sessionID, input) => {
      const existing = read(sessionID);
      // oxlint-disable-next-line effecttsgo/crypto-random-uuid -- IDs must stay unique alongside annotations in persisted messages.
      const id = globalThis.crypto.randomUUID();
      const annotation = freezeAnnotation({ ...input, id });
      if (!isValidDraft(annotation)) throw new Error("Invalid transcript annotation");
      write(sessionID, [...existing, annotation]);
      return id;
    },

    updateBody: (sessionID, id, body) => {
      const existing = read(sessionID);
      const index = existing.findIndex((comment) => comment.id === id);
      if (index < 0 || existing[index]!.body === body) return;
      const next = existing.slice();
      next[index] = freezeAnnotation({ ...existing[index]!, body });
      write(sessionID, next);
    },

    remove: (sessionID, id) => {
      const existing = read(sessionID);
      if (!existing.some((comment) => comment.id === id)) return;
      write(
        sessionID,
        existing.filter((comment) => comment.id !== id),
      );
    },

    clear,

    take: (sessionID) => {
      const comments = read(sessionID);
      const snapshot = { sessionID, comments };
      clear(sessionID);
      return snapshot;
    },

    restore: (snapshot) => {
      const current = read(snapshot.sessionID);
      const currentByID = new Map(current.map((comment) => [comment.id, comment]));
      if (snapshot.comments.every((comment) => currentByID.has(comment.id))) return;
      const restoredIDs = new Set(snapshot.comments.map((comment) => comment.id));
      write(snapshot.sessionID, [
        ...snapshot.comments.map((comment) => currentByID.get(comment.id) ?? comment),
        ...current.filter((comment) => !restoredIDs.has(comment.id)),
      ]);
    },

    clearIfUnchanged: (snapshot) => {
      const current = read(snapshot.sessionID);
      const submitted = new Set(snapshot.comments);
      const remaining = current.filter((comment) => !submitted.has(comment));
      if (remaining.length === current.length) return false;
      write(snapshot.sessionID, remaining);
      return true;
    },
  };
}

function freezeAnnotation(annotation: TranscriptAnnotation): TranscriptAnnotation {
  return Object.freeze({
    ...annotation,
    source: Object.freeze({ ...annotation.source }),
  });
}
