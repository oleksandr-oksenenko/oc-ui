import { For, type JSX } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { ChipsOption } from "./attachments/compact/ChipsOption.tsx";
import { TilesOption } from "./attachments/compact/TilesOption.tsx";
import { SummaryOption } from "./attachments/compact/SummaryOption.tsx";
import { PillsOption } from "./attachments/compact/PillsOption.tsx";
import { SummaryPillsOption } from "./attachments/compact/SummaryPillsOption.tsx";
import "./attachments/compact/comparison.css";

const instruction = "Please address this feedback and use the attached reference.";

const options: {
  title: string;
  tradeoff: string;
  attachment: () => JSX.Element;
}[] = [
  {
    title: "A · Chips",
    tradeoff: "Each item stays visible; the compact chips may wrap across several lines.",
    attachment: () => <ChipsOption />,
  },
  {
    title: "B · Tiles",
    tradeoff: "Larger targets make each item easier to scan, while using more vertical space.",
    attachment: () => <TilesOption />,
  },
  {
    title: "C · Summary",
    tradeoff: "A short overview keeps the message small; details take an extra step to open.",
    attachment: () => <SummaryOption />,
  },
  {
    title: "D · Pills",
    tradeoff: "Familiar filename pills keep the layout light; comment types need clear labels.",
    attachment: () => <PillsOption />,
  },
  {
    title: "E · Summary + pills",
    tradeoff: "A short summary keeps the message small; opening it reveals compact pills.",
    attachment: () => <SummaryPillsOption />,
  },
];

function Comparison(props: { readonly narrow?: boolean }) {
  return (
    <main class="attachment-options" classList={{ "attachment-options--narrow": props.narrow }}>
      <header class="attachment-options-header">
        <h1>Compact attachment options</h1>
        <p>Five treatments of the same message and attached context.</p>
      </header>
      <div class="attachment-options-list">
        <For each={options}>
          {(option) => (
            <section class="attachment-options-example" aria-label={option.title}>
              <div class="attachment-options-caption">
                <h2>{option.title}</h2>
                <p>{option.tradeoff}</p>
              </div>
              <article class="attachment-options-message" aria-label="Your message">
                <p class="attachment-options-instruction">{instruction}</p>
                {option.attachment()}
              </article>
            </section>
          )}
        </For>
      </div>
      <p class="attachment-options-note">
        Browser annotation grouping is a visual proposal; earlier messages still keep their original
        text and screenshots.
      </p>
    </main>
  );
}

const meta = {
  title: "Transcript/Attachment options/Compare",
  parameters: { layout: "fullscreen" },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const AllOptions: Story = { render: () => <Comparison /> };
export const Narrow: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
  render: () => <Comparison narrow />,
};
export const Dark: Story = {
  globals: { theme: "dark" },
  render: () => <Comparison />,
};
