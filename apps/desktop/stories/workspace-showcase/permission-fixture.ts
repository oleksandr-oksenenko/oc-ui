import type { PermissionRequest } from "@opencode-ai/client";
import { createSignal } from "solid-js";
import type { SessionPermissionsController } from "../../src/renderer/components/App/ConnectedApp/Permissions/createPermissions.ts";

const sync = () => Promise.resolve();

export function createWorkspacePermissions() {
  const [requests, setRequests] = createSignal<readonly PermissionRequest[]>([
    {
      id: "workspace-permission",
      sessionID: "rename-helpers",
      action: "run command",
      resources: ["pnpm check"],
      save: ["pnpm check"],
    },
  ]);
  const controller: SessionPermissionsController = {
    requests,
    state: () => "ready",
    error: () => undefined,
    recoveryError: () => undefined,
    pending: () => requests().length > 0,
    submitting: () => false,
    errorFor: () => undefined,
    sync,
    reply: (id) => {
      setRequests((items) => items.filter((item) => item.id !== id));
      return Promise.resolve();
    },
  };
  return controller;
}
