import { ContextTabs } from "./ContextPanel/ContextTabs.tsx";

export type ChangesTitlebarRegionProps = {
  readonly idBase: string;
  readonly onClose?: () => void;
};

export function ChangesTitlebarRegion(props: ChangesTitlebarRegionProps) {
  return <ContextTabs idBase={props.idBase} onClose={props.onClose} />;
}
