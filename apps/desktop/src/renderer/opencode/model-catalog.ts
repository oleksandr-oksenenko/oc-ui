import { useAtomValue } from "@effect/atom-solid";
import type { LocationRef, ModelRef, OpenCodeClient } from "@opencode/client";
import { locationKey, type Data } from "@opencode/client/solid";
import { Effect, Fiber } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { createEffect, createMemo, on, onCleanup, type Accessor } from "solid-js";
import type { WorkspaceOwner, WorkspaceRequestError } from "../workspace-owner.ts";

type ModelCatalogInput = {
  readonly effects: WorkspaceOwner;
  readonly api: {
    readonly model: Pick<OpenCodeClient["model"], "default">;
    readonly plugin: Pick<OpenCodeClient["plugin"], "awaitActivation">;
  };
  readonly data: Pick<Data, "on"> & {
    readonly location: {
      readonly model: Pick<Data["location"]["model"], "list" | "sync" | "invalidate">;
    };
  };
  readonly location: Accessor<LocationRef | undefined>;
  readonly connected: Accessor<boolean>;
};

/** Workspace owns discovery attempts; SDK resources own catalogs and event revalidation. */
export function createModelCatalog(input: ModelCatalogInput) {
  const { effects } = input;
  const status = Atom.make<{
    state: "loading" | "ready" | "failed";
    key?: string;
    defaultRef?: ModelRef;
    error?: string;
  }>({ state: "loading" });
  effects.mount(status);
  const current = useAtomValue(() => status);
  const read = effects.latest<void, WorkspaceRequestError>();
  let active: Fiber.Fiber<void, WorkspaceRequestError> | undefined;
  const target = createMemo(
    () => {
      const location = input.location();
      return location
        ? { directory: location.directory, workspaceID: location.workspaceID }
        : undefined;
    },
    undefined,
    {
      equals: (left, right) =>
        left === right ||
        (left !== undefined && right !== undefined && locationKey(left) === locationKey(right)),
    },
  );

  const refresh = Effect.fn("modelCatalog.refresh")(
    function* (invalidate: boolean) {
      const location = target();
      const key = location ? locationKey(location) : undefined;
      const previous = effects.registry.get(status);
      // Revalidation keeps the current controls mounted and the last successful default visible.
      effects.registry.set(
        status,
        location && input.connected() && previous.key === key && previous.state === "ready"
          ? { ...previous, error: undefined }
          : { state: !location ? "ready" : input.connected() ? "loading" : "failed", key },
      );
      if (!location || !input.connected()) return;
      const query = { directory: location.directory, workspace: location.workspaceID };
      yield* effects.request((signal) =>
        input.api.plugin.awaitActivation({ location: query }, { signal }),
      );
      if (invalidate) input.data.location.model.invalidate(location);
      const [, fallback] = yield* Effect.all(
        [
          effects.request(() => input.data.location.model.sync(location)),
          effects.request((signal) => input.api.model.default({ location: query }, { signal })),
        ],
        { concurrency: "unbounded" },
      );
      effects.registry.set(status, {
        state: "ready",
        key: locationKey(location),
        defaultRef: fallback.data?.enabled
          ? { id: fallback.data.id, providerID: fallback.data.providerID }
          : undefined,
      });
    },
    Effect.tapError(() =>
      Effect.sync(() => {
        effects.registry.update(status, (value) => ({
          ...value,
          state: value.state === "ready" ? value.state : ("failed" as const),
          error: "Models could not be loaded. Check the connection and try again.",
        }));
      }),
    ),
  );

  const start = (invalidate: boolean) => {
    active = read.run(refresh(invalidate));
    return active;
  };
  createEffect(
    on(
      () => [target(), input.connected()],
      () => {
        read.cancel();
        active = undefined;
        start(false);
      },
    ),
  );
  const refreshLocation = (location: LocationRef | undefined) => {
    const selected = target();
    if (
      selected &&
      input.connected() &&
      location &&
      locationKey(location) === locationKey(selected)
    )
      start(false);
  };
  const stops = [
    input.data.on("catalog.updated", (event) => refreshLocation(event.location)),
    input.data.on("config.updated", (event) => refreshLocation(event.location)),
    input.data.on("integration.updated", (event) => refreshLocation(event.location)),
    ...(["credential.updated", "credential.switched"] as const).map((type) =>
      input.data.on(type, () => {
        if (target() && input.connected()) start(type === "credential.updated");
      }),
    ),
  ];
  onCleanup(() => {
    stops.forEach((stop) => stop());
    read.cancel();
  });

  return {
    state: () =>
      !target()
        ? ("ready" as const)
        : current().key === locationKey(target()!)
          ? current().state
          : ("loading" as const),
    error: () =>
      target() && current().key === locationKey(target()!) ? current().error : undefined,
    defaultRef: () =>
      target() && current().key === locationKey(target()!) ? current().defaultRef : undefined,
    models: createMemo(() => {
      current();
      const location = target();
      return (
        (location ? input.data.location.model.list(location) : undefined)?.filter(
          (model) => model.enabled,
        ) ?? []
      );
    }),
    sync: () =>
      effects.runPromise(
        Fiber.join(active && active.pollUnsafe() === undefined ? active : start(true)),
      ),
  };
}
