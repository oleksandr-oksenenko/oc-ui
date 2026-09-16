import { RegistryContext } from "@effect/atom-solid";
import type { LocationRef, OpenCodeClient } from "@opencode/client";
import { Effect, Exit, Scope } from "effect";
import { AtomRegistry } from "effect/unstable/reactivity";
import { onCleanup } from "solid-js";
// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- Isolated Storybook composition root, matching AddProjectDialog stories.
import { makeWorkspaceOwner } from "../../src/renderer/workspace-owner.ts";
import { AddProjectDialog } from "../../src/renderer/components/App/ConnectedApp/Sessions/SessionSidebar/NewSessionFlow/AddProjectDialog.tsx";

const listDirectory: OpenCodeClient["file"]["list"] = (input) => {
  const directory = input?.location?.directory ?? "/srv/projects";
  const entries =
    directory === "/srv/projects"
      ? ["oc-ui", "opencode", "docs"]
      : directory === "/srv"
        ? ["projects"]
        : directory === "/"
          ? ["srv"]
          : [];
  return Promise.resolve({
    location: { directory, project: { id: "fixture-project", directory, canonical: directory } },
    data: entries.map((path) => ({ path, type: "directory" as const })),
  });
};

// The dialog owns its directory reads. Closing it cancels them before disposing
// the registry; listing and project creation never touch a real server.
export function WorkspaceAddProject(props: {
  readonly onAddProject: (location: LocationRef) => void;
}) {
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
      <AddProjectDialog
        effects={effects}
        listDirectory={listDirectory}
        initialLocation={{ directory: "/srv/projects" }}
        onAddProject={props.onAddProject}
      />
    </RegistryContext.Provider>
  );
}
