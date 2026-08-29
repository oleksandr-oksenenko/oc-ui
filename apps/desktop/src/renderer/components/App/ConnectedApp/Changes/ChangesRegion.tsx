import { ContextPanel } from "./ContextPanel.tsx";
import type { DiffViewProps } from "./ContextPanel/DiffView.tsx";

export type ChangesRegionProps = {
  readonly idBase: string;
  readonly changes: DiffViewProps;
  readonly showTabs: boolean;
  readonly onClose?: () => void;
};

export function ChangesRegion(props: ChangesRegionProps) {
  return (
    <ContextPanel
      tabsIdBase={props.idBase}
      showTabs={props.showTabs}
      onClose={props.onClose}
      diff={props.changes}
    />
  );
}
