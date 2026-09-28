import { For } from "solid-js";
import { AnnotationCommentRow } from "../../../src/renderer/components/App/ConnectedApp/Conversation/AnnotationPopover/AnnotationCommentRow.tsx";
import { ImagePreview } from "../../../src/renderer/ui/ImagePreview.tsx";
import {
  AttachmentPills,
  AttachmentDetailPill,
  AttachmentImagePill,
  AttachmentFilePill,
} from "../../../src/renderer/ui/AttachmentPills.tsx";
import { ReviewAttachmentDetails } from "../../../src/renderer/ui/ReviewAttachmentDetails.tsx";
import {
  annotations,
  browserAnnotation,
  files,
  reviewComments,
} from "../../attachment-fixtures.ts";
import "./pills.css";

const browserImage = `data:${browserAnnotation.image.mime};base64,${btoa(
  String.fromCharCode(...browserAnnotation.image.data),
)}`;

/** Read-only fixture content shared by the standalone and composer stories. */
export function AttachmentDetailExamples() {
  return (
    <>
      <AttachmentDetailPill
        kind="review"
        label={`Review · ${reviewComments.length}`}
        title="Review comments"
      >
        <ReviewAttachmentDetails comments={reviewComments} />
      </AttachmentDetailPill>
      <AttachmentDetailPill
        kind="annotations"
        label={`Annotations · ${annotations.length}`}
        title="Transcript annotation"
      >
        <AnnotationCommentRow
          annotation={annotations[0]!}
          readonly
          disabled={false}
          editing={false}
          onNavigate={() => false}
          onEdit={() => undefined}
          onFinish={() => undefined}
          onSubmit={() => undefined}
          onInput={() => undefined}
          onRemove={() => undefined}
        />
      </AttachmentDetailPill>
      <AttachmentDetailPill kind="browser" label="Browser · 1" title="Browser annotation">
        <p>{browserAnnotation.body}</p>
        <div class="attachment-pill-source">
          {browserAnnotation.tab.title} · {browserAnnotation.tab.url}
          <br />
          {browserAnnotation.selection.label}
        </div>
        <ImagePreview
          src={browserImage}
          alt={browserAnnotation.image.name}
          class="attachment-pill-browser-image"
        />
      </AttachmentDetailPill>
    </>
  );
}

export function PillsOption() {
  const image = files[0]!;
  return (
    <AttachmentPills>
      <AttachmentDetailExamples />
      <AttachmentImagePill
        src={`data:${image.mime};base64,${image.data}`}
        alt={image.name!}
        name={image.name!}
      />
      <For each={files.slice(1)}>{(file) => <AttachmentFilePill name={file.name!} />}</For>
    </AttachmentPills>
  );
}
