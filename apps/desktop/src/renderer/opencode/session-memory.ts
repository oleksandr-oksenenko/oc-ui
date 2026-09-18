import type { OpenCodeEvent } from "@opencode/client";
import type { Data } from "@opencode/client/solid";
import { Atom } from "effect/unstable/reactivity";
import { onCleanup } from "solid-js";

import type { WorkspaceOwner } from "../workspace-owner.ts";
import type { SessionReads } from "./session-reads.ts";

type SessionDeletedEvent = Extract<OpenCodeEvent, { type: "session.deleted" }>;

type SessionMemoryData = {
  readonly on: (
    type: "session.deleted",
    handler: (event: SessionDeletedEvent) => void,
  ) => () => void;
  readonly session: {
    readonly root: Data["session"]["root"];
    readonly family: Data["session"]["family"];
    readonly evict: Data["session"]["evict"];
    readonly creating: Data["session"]["creating"];
    readonly status: Data["session"]["status"];
    readonly message: {
      readonly list: Data["session"]["message"]["list"];
      readonly loading: Data["session"]["message"]["loading"];
    };
    readonly pending: {
      readonly list: Data["session"]["pending"]["list"];
    };
  };
};

type MemoryState = {
  readonly selectedID?: string;
  readonly visited: readonly string[];
};

type Family = {
  readonly root: string;
  readonly members: Set<string>;
  resident: boolean;
};

export type SessionMemory = {
  /** Record the newly selected session and trim least-recent inactive families. */
  readonly touchSelection: (sessionID: string | undefined) => void;
};

/**
 * Bounds how many inactive session families keep their SDK message cache. The
 * SDK owns the cache; this policy only decides when to call `session.evict`.
 *
 * Reconciliation runs on selection, on application-owned read settlement, and
 * on session deletion. It considers discoverable resident families, trims
 * toward a soft five-family target, and never evicts the selected, running,
 * creating, pending, or application-reading family. Background SDK
 * publications are reconsidered on a later reconciliation, not at event time.
 */
export function createSessionMemory(input: {
  readonly effects: WorkspaceOwner;
  readonly data: SessionMemoryData;
  readonly sessions: { readonly ids: () => readonly string[] };
  readonly reads: SessionReads;
  readonly budget?: number;
}): SessionMemory {
  const budget = input.budget ?? 5;
  const stateAtom = Atom.make<MemoryState>({ visited: [] });
  input.effects.mount(stateAtom);

  const resolveRoot = (sessionID: string): string => input.data.session.root(sessionID);
  const hasRows = (sessionID: string): boolean =>
    input.data.session.message.list(sessionID).length > 0 ||
    input.data.session.pending.list(sessionID).length > 0;

  const canEvict = (family: Family, selectedRoot: string | undefined): boolean => {
    if (selectedRoot !== undefined && family.root === selectedRoot) return false;
    for (const member of family.members) {
      if (selectedRoot !== undefined && resolveRoot(member) === selectedRoot) return false;
      if (input.reads.active(member)) return false;
      if (input.data.session.message.loading(member)) return false;
      if (input.data.session.creating(member)) return false;
      if (input.data.session.status(member) === "running") return false;
      // Unacknowledged pending items must survive; the SDK also preserves them.
      if (input.data.session.pending.list(member).length > 0) return false;
    }
    return true;
  };

  // Guard exactly the membership `evict(root)` clears: known descendants may
  // not be in the current catalog, and the root may be absent from its family.
  const collectFamilies = (state: MemoryState, seedID: string | undefined): Map<string, Family> => {
    const families = new Map<string, Family>();
    const familyOf = (sessionID: string): void => {
      const root = resolveRoot(sessionID);
      let family = families.get(root);
      if (family === undefined) {
        family = { root, members: new Set<string>(), resident: false };
        families.set(root, family);
      }
      family.members.add(sessionID);
      family.members.add(root);
      if (hasRows(sessionID)) family.resident = true;
    };
    const seeds = new Set<string>(input.sessions.ids());
    for (const visited of state.visited) seeds.add(visited);
    if (state.selectedID !== undefined) seeds.add(state.selectedID);
    if (seedID !== undefined) seeds.add(seedID);
    for (const sessionID of seeds) familyOf(sessionID);
    for (const family of families.values()) {
      for (const member of input.data.session.family(family.root)) {
        family.members.add(member);
        if (hasRows(member)) family.resident = true;
      }
      if (hasRows(family.root)) family.resident = true;
    }
    return families;
  };

  const orderRoots = (
    state: MemoryState,
    selectedRoot: string | undefined,
    families: Map<string, Family>,
  ): string[] => {
    const order: string[] = [];
    const seen = new Set<string>();
    const push = (root: string): void => {
      if (seen.has(root)) return;
      seen.add(root);
      order.push(root);
    };
    if (selectedRoot !== undefined) push(selectedRoot);
    for (const visited of state.visited.toReversed()) push(resolveRoot(visited));
    for (const root of families.keys()) push(root);
    return order;
  };

  // Keep the selection plus the most recent resident families up to the budget;
  // evict over-budget residents unless an active guard protects them.
  const trim = (
    selectedRoot: string | undefined,
    order: readonly string[],
    families: Map<string, Family>,
  ): Set<string> => {
    const keep = new Set<string>();
    let remaining = Math.max(0, budget - (selectedRoot === undefined ? 0 : 1));
    for (const root of order) {
      const family = families.get(root);
      if (family === undefined || !family.resident) continue;
      if (root === selectedRoot || remaining > 0) {
        keep.add(root);
        if (root !== selectedRoot) remaining--;
        continue;
      }
      if (canEvict(family, selectedRoot)) input.data.session.evict(root);
      else keep.add(root);
    }
    return keep;
  };

  // Retain recency for kept families, the selection, and families with an
  // unsettled read so their outcome can be reconciled later.
  const retainedVisited = (
    state: MemoryState,
    selectedRoot: string | undefined,
    families: Map<string, Family>,
    keep: Set<string>,
  ): readonly string[] =>
    state.visited.filter((root) => {
      const current = resolveRoot(root);
      if (current === selectedRoot || keep.has(current)) return true;
      const family = families.get(current);
      return family !== undefined && [...family.members].some((id) => input.reads.active(id));
    });

  // Read the atom directly so a settlement handler never becomes a reactive dependency.
  const reconcile = (seedID?: string): void => {
    const state = input.effects.registry.get(stateAtom);
    const selectedRoot = state.selectedID === undefined ? undefined : resolveRoot(state.selectedID);
    const families = collectFamilies(state, seedID);
    const order = orderRoots(state, selectedRoot, families);
    const keep = trim(selectedRoot, order, families);
    const visited = retainedVisited(state, selectedRoot, families, keep);
    if (
      visited.length !== state.visited.length ||
      visited.some((root, index) => root !== state.visited[index])
    ) {
      input.effects.registry.set(stateAtom, { selectedID: state.selectedID, visited });
    }
  };

  onCleanup(input.reads.onIdleChange((sessionID) => reconcile(sessionID)));
  onCleanup(input.data.on("session.deleted", (event) => reconcile(event.data.sessionID)));

  return {
    touchSelection: (sessionID) => {
      const root = sessionID === undefined ? undefined : resolveRoot(sessionID);
      input.effects.registry.update(stateAtom, (state) => ({
        selectedID: sessionID,
        visited:
          root === undefined
            ? state.visited
            : [...state.visited.filter((entry) => entry !== root), root],
      }));
      reconcile();
    },
  };
}
