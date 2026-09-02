import type { FormAnswer, LocationRef } from "@opencode-ai/client";
import type { FormWithLocation } from "@opencode-ai/client/solid";
import { createSignal, type Accessor } from "solid-js";

import type { GlobalFormsController } from "../../src/renderer/components/App/ConnectedApp/GlobalForms/createGlobalForms.ts";

export const GLOBAL_FORM_LOCATION: LocationRef = {
  directory: "/srv/workspaces/oc-ui",
  workspaceID: "workspace-demo",
};

// This fixture deliberately models a delayed server boundary with a native Promise.
const delay = (milliseconds: number) =>
  // oxlint-disable-next-line effecttsgo/new-promise -- Delayed fake server boundary.
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

const option = (value: string, label: string) => ({ value, label });

export const defaultForms: readonly FormWithLocation[] = [
  {
    id: "frm_release-intake",
    sessionID: "global",
    title: "Prepare a release update",
    metadata: { source: "release-bot", priority: "normal" },
    location: GLOBAL_FORM_LOCATION,
    fields: [
      {
        key: "summary",
        type: "string",
        title: "Release summary",
        description: "A short sentence for the release feed.",
        placeholder: "What changed in this release?",
        default: "Ship the global forms flow",
        required: true,
        minLength: 8,
      },
      {
        key: "channel",
        type: "string",
        title: "Channel",
        description: "Choose where the update will be shared.",
        options: [
          option("internal", "Internal"),
          option("public", "Public"),
          option("partners", "Partners"),
        ],
        default: "internal",
      },
      {
        key: "confidence",
        type: "number",
        title: "Confidence score",
        description: "A score from 0 to 1 used by the release assistant.",
        minimum: 0,
        maximum: 1,
        default: 0.85,
        required: true,
      },
      {
        key: "include-migrations",
        type: "boolean",
        title: "Include migration notes",
        description: "Adds database and configuration changes to the update.",
        default: true,
      },
      {
        key: "migration-version",
        type: "integer",
        title: "Migration version",
        description: "Visible only when migration notes are included.",
        minimum: 1,
        maximum: 99,
        default: 12,
        when: [{ key: "include-migrations", op: "eq", value: true }],
      },
      {
        key: "audiences",
        type: "multiselect",
        title: "Audience",
        description: "Select one or two audiences.",
        options: [
          option("engineering", "Engineering"),
          option("support", "Support"),
          option("customers", "Customers"),
        ],
        minItems: 1,
        maxItems: 2,
        default: ["engineering", "support"],
        required: true,
      },
      {
        key: "public-note",
        type: "string",
        title: "Public note",
        description: "Required only for the public channel.",
        placeholder: "One detail customers will appreciate",
        when: [{ key: "channel", op: "eq", value: "public" }],
      },
      {
        key: "release-docs",
        type: "external",
        title: "Release checklist",
        description: "Open the checklist before approving this request.",
        url: "https://docs.example.test/releases/global-forms",
      },
    ],
  },
  {
    id: "frm_account-verification",
    sessionID: "global",
    title: "Verify account contact",
    metadata: { source: "account-service" },
    location: GLOBAL_FORM_LOCATION,
    fields: [
      {
        key: "email",
        type: "string",
        title: "Contact email",
        format: "email",
        required: true,
        default: "maintainers@example.test",
      },
      {
        key: "reminder-date",
        type: "string",
        title: "Reminder date",
        format: "date",
        default: "2026-09-15",
      },
    ],
  },
  {
    id: "frm_custom-routing",
    sessionID: "global",
    title: "Configure routing rule",
    metadata: { source: "routing-service", custom: true },
    location: GLOBAL_FORM_LOCATION,
    fields: [
      {
        key: "route-name",
        type: "string",
        title: "Rule name",
        custom: true,
        placeholder: "e.g. nightly-docs",
        required: true,
      },
      {
        key: "destination",
        type: "string",
        title: "Destination URL",
        format: "uri",
        custom: true,
        required: true,
        default: "https://hooks.example.test/oc-ui",
      },
    ],
  },
];

export const hostileContentForm: FormWithLocation = {
  id: "frm_hostile-content",
  sessionID: "global",
  title:
    "A very long form title that should remain readable without pushing the action controls out of the viewport",
  metadata: { source: "edge-case", note: "long content" },
  location: GLOBAL_FORM_LOCATION,
  fields: [
    {
      key: "long-text",
      type: "string",
      title:
        "A label containing punctuation, Unicode, and a very long sentence that must wrap naturally",
      description:
        "This description intentionally contains a long unbroken-ish URL https://example.test/a/really/long/path/to/a/resource so the form keeps its width under control.",
      default: "Keep the layout calm",
      maxLength: 80,
      required: true,
    },
    {
      key: "long-options",
      type: "multiselect",
      title: "Many possible destinations",
      options: [
        option("alpha", "Alpha — primary workspace"),
        option("beta", "Beta — verification workspace"),
        option("gamma", "Gamma — release workspace"),
      ],
      default: ["alpha"],
      maxItems: 2,
    },
    {
      key: "long-external",
      type: "external",
      title: "Open the long documentation address",
      url: "https://docs.example.test/workspaces/oc-ui/forms/hostile-content/verification?from=storybook&mode=review",
    },
  ],
};

export const emptyForms: readonly FormWithLocation[] = [];

export type FakeControllerOptions = {
  readonly forms?: readonly FormWithLocation[];
  readonly connected?: boolean;
  readonly syncState?: "idle" | "loading" | "ready" | "error";
  readonly syncError?: string;
  readonly syncRecovery?: "ready" | "error";
  readonly replyFailures?: Readonly<Record<string, number>>;
};

export type FakeGlobalForms = {
  readonly controller: GlobalFormsController;
  readonly forms: Accessor<readonly FormWithLocation[]>;
  readonly addForm: () => FormWithLocation;
  readonly removeLastForm: () => void;
};

export function createFakeGlobalForms(options: FakeControllerOptions = {}): FakeGlobalForms {
  const [forms, setForms] = createSignal<readonly FormWithLocation[]>(
    options.forms ?? defaultForms,
  );
  const [connected] = createSignal(options.connected ?? true);
  const [loading, setLoading] = createSignal(options.syncState === "loading");
  const [loadError, setLoadError] = createSignal(
    options.syncState === "error"
      ? (options.syncError ?? "The workspace service is unavailable.")
      : undefined,
  );
  const [lastActionError, setLastActionError] = createSignal<
    | {
        readonly formID: string;
        readonly kind: "reply" | "cancel";
        readonly message: string;
      }
    | undefined
  >();
  const [activeAction, setActiveAction] = createSignal<
    { readonly formID: string; readonly kind: "reply" | "cancel" } | undefined
  >();
  const actionIDs = new Set<string>();
  const remainingFailures = new Map(Object.entries(options.replyFailures ?? {}));
  let nextID = 1;

  // oxlint-disable-next-line effecttsgo/async-function -- Fake controller models a Promise API.
  const sync = async (): Promise<void> => {
    setLoading(true);
    setLoadError(undefined);
    await delay(350);
    if (options.syncRecovery === "error") {
      setLoading(false);
      setLoadError(options.syncError ?? "The workspace service is unavailable.");
      return;
    }
    setLoading(false);
  };

  // oxlint-disable-next-line effecttsgo/async-function -- Fake controller models a Promise API.
  const settle = async (
    form: FormWithLocation,
    operation: "reply" | "cancel",
    answer?: FormAnswer,
  ) => {
    if (actionIDs.has(form.id)) return false;
    actionIDs.add(form.id);
    setActiveAction({ formID: form.id, kind: operation });
    setLastActionError((current) => (current?.formID === form.id ? undefined : current));
    await delay(320);
    const failures = remainingFailures.get(form.id) ?? 0;
    if (operation === "reply" && failures > 0) {
      remainingFailures.set(form.id, failures - 1);
      setLastActionError({
        formID: form.id,
        kind: operation,
        message: "The workspace service rejected this answer. Try again.",
      });
      actionIDs.delete(form.id);
      setActiveAction(undefined);
      return false;
    }
    void answer;
    setForms((current) => current.filter((candidate) => candidate.id !== form.id));
    actionIDs.delete(form.id);
    setActiveAction(undefined);
    return true;
  };

  const addForm = () => {
    const created: FormWithLocation = {
      id: `frm_live-${String(nextID++).padStart(2, "0")}`,
      sessionID: "global",
      title: "Live workspace check",
      metadata: { source: "storybook-live-queue" },
      location: GLOBAL_FORM_LOCATION,
      fields: [
        {
          key: "check",
          type: "string",
          title: "What should the workspace check?",
          default: "Confirm the new form is visible",
          required: true,
        },
      ],
    };
    setForms((current) => [...current, created]);
    return created;
  };

  const removeLastForm = () => {
    setForms((current) => current.slice(0, -1));
  };

  const controller = {
    location: GLOBAL_FORM_LOCATION,
    forms,
    connected,
    pending: () => activeAction() !== undefined,
    submitting: (formID: string) => activeAction()?.formID === formID,
    errorFor: (formID: string) => {
      const error = lastActionError();
      return error?.formID === formID ? error.message : undefined;
    },
    loading,
    loadError,
    refresh: sync,
    reply: (formID: string, answer: FormAnswer) => {
      const form = forms().find((candidate) => candidate.id === formID);
      return form ? settle(form, "reply", answer) : Promise.resolve(false);
    },
    cancel: (formID: string) => {
      const form = forms().find((candidate) => candidate.id === formID);
      return form ? settle(form, "cancel") : Promise.resolve(false);
    },
  } satisfies GlobalFormsController;

  return { controller, forms, addForm, removeLastForm };
}
