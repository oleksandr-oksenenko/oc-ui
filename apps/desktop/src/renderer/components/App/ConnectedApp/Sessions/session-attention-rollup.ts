import type { SessionAttention } from "./createSessionAttention.ts";
import type { SessionTreeNode } from "./session-tree-projection.ts";

export type SessionAttentionState = {
  readonly kind: SessionAttention;
  /** `session` when this session owns the state, `subagents` when a descendant does. */
  readonly origin: "session" | "subagents";
};

const blockingRank = {
  completed: 0,
  question: 1,
  permission: 2,
} satisfies Record<SessionAttention, number>;

/** Unread completions stay on their own row; only blocking states roll up. */
function blocking(state: SessionAttention | undefined): SessionAttention | undefined {
  return state === "permission" || state === "question" ? state : undefined;
}

function stronger(
  left: SessionAttention | undefined,
  right: SessionAttention | undefined,
): SessionAttention | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return blockingRank[left] >= blockingRank[right] ? left : right;
}

/** Combines a session's own attention with the strongest blocking state below it. */
function combine(
  own: SessionAttention | undefined,
  inherited: SessionAttention | undefined,
): SessionAttentionState | undefined {
  if (own === "permission") return { kind: "permission", origin: "session" };
  if (inherited === "permission") return { kind: "permission", origin: "subagents" };
  if (own === "question") return { kind: "question", origin: "session" };
  if (inherited === "question") return { kind: "question", origin: "subagents" };
  if (own === "completed") return { kind: "completed", origin: "session" };
  return undefined;
}

/**
 * Maps every projected node to its own-or-inherited attention. Permission wins
 * over question; a row's own state wins ties. The result covers collapsed rows
 * because it reads the whole projection, not the rendered tree.
 */
export function rollupSessionAttention(
  roots: readonly SessionTreeNode[],
  own: (sessionID: string) => SessionAttention | undefined,
): ReadonlyMap<string, SessionAttentionState> {
  const result = new Map<string, SessionAttentionState>();

  const visit = (node: SessionTreeNode): SessionAttention | undefined => {
    const ownAttention = own(node.session.id);
    let inherited: SessionAttention | undefined;
    for (const child of node.children) {
      inherited = stronger(inherited, visit(child));
    }
    const state = combine(ownAttention, inherited);
    if (state !== undefined) result.set(node.session.id, state);
    return stronger(blocking(ownAttention), inherited);
  };

  for (const root of roots) visit(root);
  return result;
}
