import { ContextPanel } from "./ContextPanel.tsx";
import type {
  DiffFileData,
  DiffReviewView,
  DiffViewPresentation,
} from "./ContextPanel/DiffView.tsx";

export type ChangesRegionProps = {
  readonly idBase: string;
  readonly files: readonly DiffFileData[];
  readonly presentation: DiffViewPresentation;
  readonly review?: DiffReviewView;
  readonly showTabs: boolean;
  readonly onClose?: () => void;
};

export function ChangesRegion(props: ChangesRegionProps) {
  return (
    <ContextPanel
      tabsIdBase={props.idBase}
      showTabs={props.showTabs}
      autoFocusClose={props.showTabs}
      onClose={props.onClose}
      files={props.files}
      presentation={props.presentation}
      review={props.review}
    />
  );
}
