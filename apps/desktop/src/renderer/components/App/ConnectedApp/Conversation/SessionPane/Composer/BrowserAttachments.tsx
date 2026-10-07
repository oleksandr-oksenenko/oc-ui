import { For } from "solid-js";

import type { BrowserAnnotationBatch } from "../../../../../../opencode/browser-annotation-metadata.ts";
import {
  AttachmentDetailPill,
  AttachmentImagePill,
} from "../../../../../../ui/AttachmentPills.tsx";

/** A controlled view of the composer's authoritative batches and screenshot objects. */
export function BrowserAttachments(props: {
  readonly batches: readonly BrowserAnnotationBatch[];
  readonly disabled?: boolean;
  readonly onRemoveBatch?: (batch: BrowserAnnotationBatch) => void;
  readonly onRemoveFile?: (file: File) => void;
  readonly onRemoved: () => void;
}) {
  return (
    <For each={props.batches}>
      {(batch) => (
        <AttachmentDetailPill
          kind="browser"
          label={`Browser · ${batch.annotations.length}`}
          title="Browser annotations"
          disabled={props.disabled}
          onRemove={
            props.onRemoveBatch
              ? () => {
                  if (props.disabled) return;
                  props.onRemoveBatch?.(batch);
                  props.onRemoved();
                }
              : undefined
          }
          removeLabel={`Remove browser batch of ${batch.annotations.length} annotations`}
        >
          <For each={batch.annotations}>
            {(item) => (
              <div class="attachment-detail-row">
                <p class="attachment-pill-comment-body">
                  {item.number}. {item.body}
                </p>
                <div class="attachment-pill-source">
                  {item.title} · {item.url}
                </div>
                <div class="attachment-pill-source">{item.selection.selector || item.mode}</div>
                <AttachmentImagePill
                  file={batch.files[item.fileIndex]!}
                  name={batch.files[item.fileIndex]!.name}
                  alt={`Browser annotation ${item.number}`}
                  disabled={props.disabled}
                  onRemove={
                    props.onRemoveFile
                      ? () => {
                          if (props.disabled) return;
                          props.onRemoveFile?.(batch.files[item.fileIndex]!);
                          props.onRemoved();
                        }
                      : undefined
                  }
                  removeLabel={`Remove browser annotation ${item.number}`}
                />
              </div>
            )}
          </For>
        </AttachmentDetailPill>
      )}
    </For>
  );
}
