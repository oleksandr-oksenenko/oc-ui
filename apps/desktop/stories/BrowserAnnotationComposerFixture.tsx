import { RegistryContext } from "@effect/atom-solid";
import { Browser } from "@opencode/plugin-browser/rpc";
import { Effect, Exit, Scope } from "effect";
import { AtomRegistry } from "effect/unstable/reactivity";
import { onCleanup } from "solid-js";
import { fn } from "storybook/test";

import { createSessionComposer } from "../src/renderer/components/App/ConnectedApp/Conversation/createSessionComposer.ts";
import { Composer } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/Composer.tsx";
import {
  createAnnotationDraftStore,
  createReviewDraftStore,
} from "../src/renderer/domain/index.ts";
// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- This fixture is the composition root for its disposable workspace.
import { makeWorkspaceOwner, type WorkspaceOwner } from "../src/renderer/workspace-owner.ts";
import { browserAnnotationBatch } from "./browser-annotation-fixtures.ts";
import { composerAgentSelection, composerModelSelection } from "./composer-fixtures.ts";

type Prompt = Parameters<typeof createSessionComposer>[0]["runtime"]["data"]["session"]["prompt"];

export function createBrowserAnnotationPrompt() {
  return fn<Prompt>()
    .mockRejectedValueOnce(new Error("Fixture admission failure"))
    .mockImplementation((input) =>
      Promise.resolve({
        id: input.id!,
        sessionID: input.sessionID,
        type: "user",
        timeCreated: 0,
        payload: { text: input.text, metadata: input.metadata },
        delivery: "steer",
      }),
    );
}

/** Production composer and controller; only captures and the SDK transport are fixtures. */
export function BrowserAnnotationComposerFixture(props: { readonly prompt: Prompt }) {
  const registry = AtomRegistry.make();
  const scope = Scope.makeUnsafe();
  const effects = Effect.runSync(
    makeWorkspaceOwner(registry).pipe(Effect.provideService(Scope.Scope, scope)),
  );
  onCleanup(() => {
    void Effect.runPromise(Scope.close(scope, Exit.void)).then(() => registry.dispose());
  });
  return (
    <RegistryContext.Provider value={registry}>
      <Content effects={effects} prompt={props.prompt} />
    </RegistryContext.Provider>
  );
}

function Content(props: { readonly effects: WorkspaceOwner; readonly prompt: Prompt }) {
  const composer = createSessionComposer({
    effects: props.effects,
    runtime: {
      api: { session: { command: () => Promise.resolve() } },
      data: { session: { prompt: props.prompt, message: { get: () => undefined } } },
    },
    commands: () => ({ state: "ready", items: [] }),
    selectedID: () => "browser-composer-story",
    transcriptLoading: () => false,
    transcriptError: () => undefined,
    connected: () => true,
    selectionSwitching: () => false,
    annotations: createAnnotationDraftStore(props.effects),
    review: {
      drafts: createReviewDraftStore(props.effects),
      key: () => undefined,
      requestDiscard: () => undefined,
    },
  });
  composer.attachFiles([new File(["notes"], "notes.txt", { type: "text/plain" })]);
  for (const numbers of [[1, 3], [1]]) {
    const batch = browserAnnotationBatch(numbers);
    composer.appendBatch(
      "browser-composer-story",
      batch.files,
      batch.annotations.map((item) => ({
        ...item,
        id: `capture-${item.number}`,
        tab: {
          id: Browser.TabID.make("tab_00000000-0000-4000-8000-000000000001"),
          url: item.url,
          title: item.title,
          loading: false,
          canGoBack: false,
          canGoForward: false,
          generation: 1,
        },
        image: {
          name: batch.files[item.fileIndex]!.name,
          mime: "image/png",
          data: new Uint8Array(),
        },
      })),
    );
  }
  return (
    <Composer
      value={composer.value()}
      files={composer.files()}
      browserBatches={composer.browserBatches()}
      onAttachFiles={composer.attachFiles}
      onAttachText={composer.attachText}
      onRemoveFile={composer.removeFile}
      onRemoveBrowserBatch={composer.removeBrowserBatch}
      action={composer.submitting() ? "sending" : "send"}
      disabled={composer.disabled()}
      error={composer.error()}
      modelSelection={composerModelSelection()}
      agentSelection={composerAgentSelection()}
      onInput={composer.input}
      onSubmit={() => void composer.submit()}
    />
  );
}
