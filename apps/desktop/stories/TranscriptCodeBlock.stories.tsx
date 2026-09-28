/* oxlint-disable effecttsgo/async-function -- Storybook owns interaction tests. */
import { Effect, ManagedRuntime } from "effect";
import { createSignal, onCleanup } from "solid-js";
import { expect, userEvent, waitFor, within } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

import "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/SessionPane.css";
import { Markdown } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/TranscriptView/AssistantMessage/Markdown.tsx";
import { SyntaxHighlight } from "../src/renderer/syntax-highlight.ts";
import { SyntaxHighlightProvider } from "../src/renderer/ui/SyntaxHighlightProvider.tsx";
import { useTheme } from "../src/renderer/ui/ThemeProvider.tsx";

function HighlightedMarkdown() {
  const runtime = ManagedRuntime.make(SyntaxHighlight.layer);
  onCleanup(() => {
    void runtime.dispose();
  });
  const { theme, onChange } = useTheme();
  const [text, setText] = createSignal(
    '```ts\nconst message = "Hello";\n\nconsole.log(message);\n```',
  );
  return (
    <SyntaxHighlightProvider
      highlight={(input, signal) =>
        runtime.runPromise(
          Effect.gen(function* () {
            return yield* (yield* SyntaxHighlight).highlight(input);
          }),
          { signal },
        )
      }
    >
      <div style={{ padding: "16px", "max-width": "680px" }}>
        <button onClick={() => setText("```ts\nconst updated = true;\n```")}>Update snippet</button>
        <button onClick={() => onChange?.(theme() === "light" ? "dark" : "light")}>
          Switch theme
        </button>
        <Markdown text={text()} />
        <Markdown text={"```unknown-language\nplain <text>\n```\n\nInline `code` stays plain."} />
      </div>
    </SyntaxHighlightProvider>
  );
}

const meta = {
  title: "Transcript/Code highlighting",
  component: HighlightedMarkdown,
} satisfies Meta<typeof HighlightedMarkdown>;
export default meta;
type Story = StoryObj<typeof meta>;
export const WorkerPool: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const code = () => canvasElement.querySelector("pre code");
    await waitFor(() => expect(code()?.querySelector("span[style]")).not.toBeNull(), {
      timeout: 5000,
    });
    await expect(code()?.textContent).toBe('const message = "Hello";\n\nconsole.log(message);\n');
    const color = code()?.querySelector<HTMLElement>("span")?.style.color;
    await userEvent.click(canvas.getByRole("button", { name: "Switch theme" }));
    await waitFor(
      async () => {
        const next = code()?.querySelector<HTMLElement>("span")?.style.color;
        await expect(next).toBeTruthy();
        await expect(next).not.toBe(color);
      },
      { timeout: 5000 },
    );
    await userEvent.click(canvas.getByRole("button", { name: "Update snippet" }));
    await waitFor(
      async () => {
        await expect(code()?.querySelector("span")).not.toBeNull();
        await expect(code()?.textContent).toBe("const updated = true;\n");
      },
      { timeout: 5000 },
    );
    await expect(canvasElement.querySelectorAll("pre code")[1]?.textContent).toBe("plain <text>\n");
  },
};
