import { createSignal, type JSX } from "solid-js";
import { Icon } from "@opencode-ai/ui/icon";
import { IconButton } from "@opencode-ai/ui/icon-button";

export function CopyCode(props: { readonly text: string }): JSX.Element {
  const [status, setStatus] = createSignal("Copy code");
  return (
    <IconButton
      class="transcript-code-copy"
      size="small"
      aria-label={status()}
      title={status()}
      icon={<Icon name={status() === "Copied" ? "check" : "copy"} size="small" />}
      onClick={() => {
        if (!navigator.clipboard) {
          setStatus("Copy unavailable");
          return;
        }
        void navigator.clipboard.writeText(props.text).then(
          () => setStatus("Copied"),
          () => setStatus("Copy failed — try again"),
        );
      }}
      onBlur={() => setStatus("Copy code")}
      onPointerLeave={() => setStatus("Copy code")}
    />
  );
}
