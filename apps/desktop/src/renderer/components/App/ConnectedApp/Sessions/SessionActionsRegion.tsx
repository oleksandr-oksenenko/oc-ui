import { SessionHeader } from "./SessionSidebar/SessionHeader.tsx";

/** Session actions shared by the desktop titlebar and the session sidebar. */
export function SessionActionsRegion(props: {
  readonly canCreate: boolean;
  readonly onCreate: () => void;
}) {
  return <SessionHeader canCreate={props.canCreate} onCreate={props.onCreate} />;
}
