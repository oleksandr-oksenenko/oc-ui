import type { LocationRef, SkillInfo } from "@opencode-ai/client";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";
import { deferred } from "../../../../test/deferred.ts";
import { withTestWorkspace } from "../../../../test/workspace.ts";
import { createSkillCatalog } from "./createSkillCatalog.ts";

type Source = Parameters<typeof createSkillCatalog>[0]["source"];
const location: LocationRef = { directory: "/project", workspaceID: "workspace" };
const skill = (name: string, slash = true): SkillInfo => ({
  id: name,
  name,
  slash,
  location: "/skills/" + name,
  content: "Instructions",
});
function setup(sync: Source["sync"] = async () => undefined) {
  return withTestWorkspace((effects, dispose) => {
    const [selected, setSelected] = createSignal<LocationRef | undefined>(location);
    const [connected, setConnected] = createSignal(true);
    const [items, setItems] = createSignal<SkillInfo[]>([skill("review"), skill("hidden", false)]);
    const source = {
      sync: vi.fn<Source["sync"]>(sync),
      list: vi.fn<Source["list"]>(() => items()),
      invalidate: vi.fn<Source["invalidate"]>(),
    };
    const catalog = createSkillCatalog({ effects, source, location: selected, connected });
    return { catalog, source, setSelected, setConnected, setItems, dispose };
  });
}
describe("skill catalog", () => {
  it("uses complete session location and observes SDK inventory without copying it", async () => {
    const state = setup();
    await vi.waitFor(() => expect(state.catalog.state).toBe("ready"));
    expect(state.source.sync).toHaveBeenCalledWith(location);
    expect(state.catalog.items.map((item) => item.name)).toEqual(["review"]);
    state.setItems([skill("updated")]);
    expect(state.catalog.items.map((item) => item.name)).toEqual(["updated"]);
  });
  it("keeps an obsolete failure from replacing the new location's ready state", async () => {
    const first = deferred();
    const state = setup(
      vi
        .fn<Source["sync"]>()
        .mockImplementationOnce(() => first.promise)
        .mockResolvedValue(undefined),
    );
    state.setSelected({ directory: "/other", workspaceID: "other" });
    await vi.waitFor(() => expect(state.catalog.state).toBe("ready"));
    first.reject(new Error("Obsolete location"));
    await first.promise.catch(() => undefined);
    await Promise.resolve();
    expect(state.catalog.state).toBe("ready");
  });
  it("retries failures and refreshes after reconnect without reading while disconnected", async () => {
    const state = setup(
      vi
        .fn<Source["sync"]>()
        .mockRejectedValueOnce(new Error("Offline"))
        .mockResolvedValue(undefined),
    );
    await vi.waitFor(() => expect(state.catalog.state).toBe("failed"));
    state.catalog.onRetry();
    await vi.waitFor(() => expect(state.catalog.state).toBe("ready"));
    state.setConnected(false);
    expect(state.catalog.state).toBe("failed");
    expect(state.source.sync).toHaveBeenCalledTimes(2);
    state.setConnected(true);
    await vi.waitFor(() => expect(state.catalog.state).toBe("ready"));
    expect(state.source.sync).toHaveBeenCalledTimes(3);
  });
  it("retains settlement of a disposed read without publishing its result", async () => {
    const pending = deferred();
    const state = setup(() => pending.promise);
    state.dispose();
    pending.resolve();
    await pending.promise;
    expect(state.catalog.state).toBe("loading");
  });
});
