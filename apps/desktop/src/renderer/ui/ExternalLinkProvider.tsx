import { onCleanup, type ParentProps } from "solid-js";

export type ExternalLinkProviderProps = ParentProps<{
  readonly open: (url: string) => void;
}>;

/**
 * Resolves an anchor target and keeps only absolute web URLs. Relative paths,
 * fragments, and other schemes stay with the document. Absolute http(s) links
 * are external even when they share this document's origin.
 */
function webUrl(href: string): string | undefined {
  let url: URL;
  try {
    url = href.startsWith("//") ? new URL(href, window.location.href) : new URL(href);
  } catch {
    return undefined;
  }
  return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
}

/**
 * The single application-wide link handler. Markdown is injected as HTML, and
 * every anchor in the document counts as a web link when the rules above match,
 * so this delegates on the document rather than on a Solid tree. Primary clicks
 * (including keyboard activation and modifier clicks) and middle clicks leave
 * through the host's external opener; native events bubble here before window
 * listeners run.
 */
export function ExternalLinkProvider(props: ExternalLinkProviderProps) {
  const activate = (event: MouseEvent) => {
    const primary = event.type === "click" && event.button === 0;
    const middle = event.type === "auxclick" && event.button === 1;
    if (event.defaultPrevented || (!primary && !middle)) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest("a[href]");
    if (anchor === null) return;
    const url = webUrl(anchor.getAttribute("href") ?? "");
    if (url === undefined) return;
    event.preventDefault();
    props.open(url);
  };
  document.addEventListener("click", activate);
  document.addEventListener("auxclick", activate);
  onCleanup(() => {
    document.removeEventListener("click", activate);
    document.removeEventListener("auxclick", activate);
  });
  return <>{props.children}</>;
}
