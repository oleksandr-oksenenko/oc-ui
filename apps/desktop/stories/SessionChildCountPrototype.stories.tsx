/* oxlint-disable effecttsgo/async-function -- Storybook interaction tests use Promise APIs. */
import { Button } from "@opencode-ai/ui/button";
import { Icon } from "@opencode-ai/ui/icon";
import { IconButton } from "@opencode-ai/ui/icon-button";
import { Loader } from "@opencode-ai/ui/loader";
import { For, Show, createSignal } from "solid-js";
import { expect, userEvent, within } from "storybook/test";
import type { Meta } from "storybook-solidjs-vite";

import "../src/renderer/components/App/ConnectedApp/Sessions/SessionSidebar/SessionTree/SessionTreeItem.css";
import "./SessionChildCountPrototype.css";

const sessions = [
  { id: "ledger", title: "Compact Ledger Transcript" },
  { id: "refactor", title: "Refactor Utils", children: ["Rename Helpers", "Extract Hooks"] },
  {
    id: "regression",
    title: "Investigate a deeply nested renderer regression",
    children: ["Compare the complete workspace location", "Review the implementation"],
  },
  { id: "config", title: "Add Config Option" },
];

function Prototype() {
  const [selected, setSelected] = createSignal("ledger");
  const [expanded, setExpanded] = createSignal<readonly string[]>(["refactor"]);
  const [deleted, setDeleted] = createSignal<readonly string[]>([]);
  const toggle = (id: string) =>
    setExpanded((ids) => (ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]));

  return (
    <section class="child-count-prototype" aria-label="Child count prototype">
      <h2>Child count</h2>
      <p>Click a title to open the session. Click its count to show or hide direct children.</p>
      <nav class="child-count-list" aria-label="Prototype sessions">
        <For each={sessions.filter((session) => !deleted().includes(session.id))}>
          {(session) => (
            <div>
              <div
                class="shell-session-row"
                classList={{
                  selected: selected() === session.id,
                  "has-count": Boolean(session.children),
                }}
              >
                <Button
                  class="shell-session-main oc-focus-inset"
                  variant="ghost-muted"
                  size="small"
                  aria-current={selected() === session.id ? "page" : undefined}
                  onClick={() => setSelected(session.id)}
                >
                  <span class="shell-session-title">{session.title}</span>
                </Button>
                <Show when={session.children}>
                  <Button
                    class="prototype-child-count oc-focus-inset"
                    variant="ghost-muted"
                    size="small"
                    aria-label={`${expanded().includes(session.id) ? "Collapse" : "Expand"} ${session.children?.length} children of ${session.title}`}
                    title={`${expanded().includes(session.id) ? "Hide" : "Show"} ${session.children?.length} child sessions`}
                    aria-expanded={expanded().includes(session.id)}
                    onClick={() => toggle(session.id)}
                  >
                    {session.children?.length}
                  </Button>
                </Show>
                <span class="shell-session-row-end">
                  <Show when={session.id === "refactor" || session.id === "config"}>
                    <span
                      class="shell-session-status"
                      data-status="running"
                      title="Running"
                      aria-hidden="true"
                    >
                      <Loader width={14} height={14} />
                    </span>
                  </Show>
                  <IconButton
                    class="shell-session-delete"
                    size="small"
                    variant="ghost-muted"
                    aria-label={`Delete ${session.title}`}
                    icon={<Icon name="trash" size="small" aria-hidden="true" />}
                    onClick={() => setDeleted((ids) => [...ids, session.id])}
                  />
                </span>
              </div>
              <Show when={expanded().includes(session.id)}>
                <div class="prototype-children">
                  <For each={session.children}>
                    {(title) => (
                      <Button
                        class="prototype-child"
                        variant="ghost-muted"
                        size="small"
                        aria-current={selected() === title ? "page" : undefined}
                        onClick={() => setSelected(title)}
                      >
                        <span class="shell-session-title">{title}</span>
                      </Button>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          )}
        </For>
      </nav>
      <p class="prototype-selection">
        Opened: {sessions.find((session) => session.id === selected())?.title ?? selected()}
      </p>
    </section>
  );
}

export default {
  title: "Sessions/Child Count Prototype",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export const Interactive = {
  render: () => <Prototype />,
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement);
    const count = canvas.getByRole("button", { name: "Collapse 2 children of Refactor Utils" });
    await userEvent.click(count);
    await expect(canvas.queryByRole("button", { name: "Rename Helpers" })).not.toBeInTheDocument();
    await expect(canvas.getByText("Opened: Compact Ledger Transcript")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: /^Refactor Utils$/ }));
    await expect(count).toHaveAttribute("aria-expanded", "false");
    await expect(canvas.getByText("Opened: Refactor Utils")).toBeVisible();
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    await expect(canvas.getByRole("button", { name: "Rename Helpers" })).toBeVisible();
    await expect(count).toHaveAttribute("aria-expanded", "true");
  },
};
