/* oxlint-disable effecttsgo/async-function -- Storybook owns interaction tests. */
import { createSignal } from "solid-js";
import { expect, fireEvent, userEvent, waitFor, within } from "storybook/test";

import { AppShell } from "../src/renderer/components/App/ConnectedApp/Shell/AppShell.tsx";
import { Titlebar } from "../src/renderer/components/App/ConnectedApp/Shell/Titlebar.tsx";
import { Workspace } from "../src/renderer/components/App/ConnectedApp/Shell/Workspace.tsx";
import { TerminalPanel } from "../src/renderer/components/App/ConnectedApp/Terminal/TerminalPanel.tsx";
import { NewSessionScreen } from "../src/renderer/components/App/ConnectedApp/Conversation/NewSessionScreen.tsx";
import { SessionPane } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane.tsx";
import { Composer } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/Composer.tsx";
import type { ComposerCatalog } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/Composer.tsx";
import { PendingMessages } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/PendingMessages.tsx";
import { TranscriptView } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/TranscriptView.tsx";
import { queuedMessage } from "./queueing-steering/QueueingSteering.tsx";
import { longTranscript } from "./transcript-catalog-fixtures.ts";
import {
  composerAgentSelection,
  composerModelSelection,
  composerPasteProps,
} from "./composer-fixtures.ts";

const longPrompt = "Explain the layout and keep every control reachable.\n".repeat(30);
const commands = Array.from({ length: 24 }, (_, index) => ({
  name: `command-${String(index).padStart(2, "0")}`,
  description: "A command with enough detail to exercise menu scrolling.",
}));

/** Real shell slots and components, with controlled data and no terminal process. */
export function ShortShellComposerFixture(props: { readonly newDraft?: boolean }) {
  const [draft, setDraft] = createSignal(longPrompt);
  const [overflow, setOverflow] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  const [submissions, setSubmissions] = createSignal(0);
  const [retries, setRetries] = createSignal(0);
  const [selectedModelID, setSelectedModelID] = createSignal("openai/gpt-5");
  const [files, setFiles] = createSignal<readonly File[]>([]);
  const [pending, setPending] = createSignal<ReturnType<typeof queuedMessage>[]>([]);
  const loadOverflow = () => {
    setOverflow(true);
    setFiles(Array.from({ length: 24 }, (_, index) => new File(["notes"], `notes-${index}.txt`)));
    setPending(
      Array.from({ length: 18 }, (_, index) =>
        queuedMessage(`queue-${index}`, `Follow-up ${index}`),
      ),
    );
  };
  const composer = (
    <Composer
      {...composerPasteProps}
      value={draft()}
      onInput={setDraft}
      files={files()}
      onRemoveFile={(file) => setFiles((current) => current.filter((item) => item !== file))}
      error={overflow() ? "A recoverable submission notice. ".repeat(30) : undefined}
      actions={
        overflow() ? (
          <button type="button" onClick={() => setOverflow(false)}>
            Dismiss notice
          </button>
        ) : undefined
      }
      catalog={{
        get commands(): ComposerCatalog["commands"] {
          return { state: failed() ? "failed" : "ready", items: failed() ? [] : commands };
        },
        skills: {
          state: "ready",
          items: [{ id: "review", name: "review", description: "Review changes." }],
        },
        onRetry: () => {
          setRetries((count) => count + 1);
          setFailed(false);
        },
      }}
      disabled={false}
      action="send"
      modelSelection={{
        ...composerModelSelection(),
        get selectedModelID() {
          return selectedModelID();
        },
        onSelectModel: setSelectedModelID,
      }}
      agentSelection={composerAgentSelection()}
      onSubmit={() => {
        setSubmissions((count) => count + 1);
        setDraft("");
      }}
    />
  );
  return (
    <div style={{ width: "1280px", height: "480px" }}>
      <AppShell
        titlebar={
          <Titlebar
            selectedTitle="Short composer"
            leftSidebarOpen={false}
            rightPanelOpen={false}
            rightPanelAvailable={false}
            onToggleLeftSidebar={() => undefined}
            onToggleRightPanel={() => undefined}
          />
        }
        workspace={
          <Workspace
            leftSidebarOpen={false}
            rightPanelOpen={false}
            bottomOpen
            main={
              props.newDraft ? (
                <NewSessionScreen
                  setup={{
                    projects: [{ id: "project", label: "project" }],
                    projectID: "project",
                    mode: "local",
                    branches: [],
                    branch: { kind: "existing", name: "main" },
                    defaultBranch: "main",
                    git: false,
                    onProjectChange: () => undefined,
                    onModeChange: () => undefined,
                    onBranchChange: () => undefined,
                    onAddProject: () => undefined,
                  }}
                  status={
                    overflow()
                      ? {
                          kind: "error",
                          message:
                            "Worktree preparation failed; the draft remains available. ".repeat(12),
                        }
                      : undefined
                  }
                  onRetry={() => setOverflow(false)}
                  composer={composer}
                />
              ) : (
                <SessionPane
                  selected
                  title="Short composer"
                  transcript={
                    <TranscriptView
                      sessionID="short-composer"
                      messages={longTranscript}
                      sessionStatus="idle"
                      loading={false}
                    />
                  }
                  composer={
                    <>
                      <PendingMessages
                        messages={pending()}
                        onCancel={(id) =>
                          setPending((current) => current.filter((message) => message.id !== id))
                        }
                        onSteer={() => undefined}
                      />
                      {composer}
                    </>
                  }
                />
              )
            }
            bottom={
              <TerminalPanel
                open
                tabs={[]}
                canCreate={false}
                onCreate={() => undefined}
                onSelect={() => undefined}
                onClose={() => undefined}
                onReconnect={() => undefined}
                onHide={() => undefined}
              >
                <div role="group" aria-label="Composer fixture controls">
                  <button type="button" onClick={loadOverflow}>
                    Load overflow content
                  </button>
                  <button type="button" onClick={() => setDraft(longPrompt)}>
                    Restore long prompt
                  </button>
                  <button type="button" onClick={() => setFailed(true)}>
                    Fail command catalog
                  </button>
                  <output aria-label="Submission count">{submissions()}</output>
                  <output aria-label="Catalog retry count">{retries()}</output>
                </div>
              </TerminalPanel>
            }
          />
        }
      />
    </div>
  );
}

async function expectHitTarget(element: HTMLElement) {
  const document = element.ownerDocument;
  const view = document.defaultView;
  if (!view) throw new Error("Hit target has no browser window");
  await waitFor(async () => {
    const rect = element.getBoundingClientRect();
    const name =
      element.getAttribute("aria-label") ??
      element.getAttribute("data-key") ??
      element.textContent?.trim().slice(0, 80) ??
      element.tagName;
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const diagnostic = `${name}: bounds=${JSON.stringify(rect.toJSON())}; center hit=${hit?.outerHTML.slice(0, 240) ?? "none"}`;
    await expect(rect.width).toBeGreaterThan(0);
    await expect(rect.height).toBeGreaterThan(0);
    await expect(rect.top).toBeGreaterThanOrEqual(0);
    await expect(rect.bottom).toBeLessThanOrEqual(view.innerHeight);
    await expect(rect.left).toBeGreaterThanOrEqual(0);
    await expect(rect.right).toBeLessThanOrEqual(view.innerWidth);
    await expect(element.contains(hit), diagnostic).toBe(true);
  });
}

export async function exerciseShortShellComposer(canvasElement: HTMLElement, newDraft = false) {
  const canvas = within(canvasElement);
  const region = (selector: string) => {
    const element = canvasElement.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing composer region: ${selector}`);
    return element;
  };
  const scroller = region(newDraft ? ".new-session-screen" : ".session-pane-composer");
  const prompt = canvas.getByRole("textbox", { name: "Prompt" });
  const send = canvas.getByRole("button", { name: "Send" });
  const reveal = async (element: HTMLElement) => {
    element.scrollIntoView({ block: "center" });
    await expectHitTarget(element);
    const rect = element.getBoundingClientRect();
    const bounds = scroller.getBoundingClientRect();
    await expect(rect.top).toBeGreaterThanOrEqual(bounds.top);
    await expect(rect.bottom).toBeLessThanOrEqual(bounds.bottom);
  };
  await userEvent.click(canvas.getByRole("separator", { name: "Resize terminal panel" }));
  await userEvent.keyboard("{End}");
  await waitFor(async () => {
    await expect(window.innerWidth).toBe(1280);
    await expect(window.innerHeight).toBe(480);
    await expect(region(".shell-main").clientHeight).toBeCloseTo(160, 0);
    await expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
  });
  await reveal(send);
  await expect(scroller.scrollTop).toBeGreaterThan(0);
  await userEvent.click(send);
  await expect(canvas.getByLabelText("Submission count")).toHaveTextContent("1");
  await expect(prompt).toHaveTextContent("");

  if (!newDraft) {
    // The native suggestions must leave the top layer before the sibling model
    // picker opens, or they intercept its options in this short shell.
    await userEvent.type(prompt, "/");
    await expect(canvas.getByRole("region", { name: "Suggestions" })).toBeVisible();
    const model = canvas.getByRole("button", { name: "Model: GPT-5" });
    const wrapper = region(".prompt-editor");
    for (let tabs = 0; tabs < 8 && canvasElement.ownerDocument.activeElement !== model; tabs++) {
      await userEvent.tab();
      if (!wrapper.contains(canvasElement.ownerDocument.activeElement)) {
        await expect(canvas.queryByRole("region", { name: "Suggestions" })).toBeNull();
      }
    }
    await expect(model).toHaveFocus();
    await expect(model).toHaveAttribute("aria-expanded", "false");
    await expect(canvas.queryByRole("region", { name: "Suggestions" })).toBeNull();
    await userEvent.keyboard("{Enter}");
    const page = within(canvasElement.ownerDocument.body);
    const claude = await page.findByRole("button", { name: "Claude" });
    await expectHitTarget(claude);
    await userEvent.click(claude);
    await expect(canvas.getByRole("button", { name: "Model: Claude" })).toBeVisible();
    await expect(prompt.textContent).toBe("/");
    await expect(canvas.getByLabelText("Submission count")).toHaveTextContent("1");
  }

  const checkMenu = async () => {
    await userEvent.clear(prompt);
    prompt.focus();
    await userEvent.type(prompt, "/", { skipClick: true });
    const menu = await canvas.findByRole("region", { name: "Suggestions" });
    await expect(prompt.closest("form")?.contains(menu)).toBe(true);
    await expectHitTarget(menu);
    await expectHitTarget(within(menu).getByText("↑ ↓ navigate · Enter select · Esc close"));
    await userEvent.keyboard("{ArrowDown}".repeat(20));
    const activeOption = () => {
      const element = menu.querySelector<HTMLElement>(
        '[data-slot="list-item"][data-active="true"]',
      );
      if (!element) throw new Error("No active suggestion");
      return element;
    };
    const active = await waitFor(activeOption);
    await expectHitTarget(active);
    await expect(
      menu.querySelector<HTMLElement>('[data-slot="list-scroll"]')?.scrollTop,
    ).toBeGreaterThan(0);
    // Cross the sticky group boundary in both directions while the list scrolls.
    await userEvent.keyboard("{ArrowDown}".repeat(4));
    const skill = await waitFor(activeOption);
    await expect(skill).toHaveAttribute("data-key", "skill:review");
    await expectHitTarget(skill);
    await userEvent.keyboard("{ArrowUp}");
    const lastCommand = await waitFor(activeOption);
    await expect(lastCommand).toHaveAttribute("data-key", "command:command-23");
    await expectHitTarget(lastCommand);
    await expectHitTarget(within(menu).getByText("↑ ↓ navigate · Enter select · Esc close"));
    await userEvent.keyboard("{ArrowUp}".repeat(3));
    await expectHitTarget(await waitFor(activeOption));
    await userEvent.keyboard("{Enter}");
    await expect(prompt).toHaveTextContent("/command-20");
    await expect(canvas.getByLabelText("Submission count")).toHaveTextContent("1");
    await expect(canvas.queryByRole("region", { name: "Suggestions" })).toBeNull();
  };
  await checkMenu();
  await userEvent.click(canvas.getByRole("button", { name: "Load overflow content" }));
  await userEvent.click(canvas.getByRole("button", { name: "Restore long prompt" }));
  await reveal(send);
  if (!newDraft) {
    const transcript = region(".transcript-view");
    await waitFor(async () => {
      await expect(transcript).toHaveAttribute("aria-busy", "false");
      await expect(canvasElement.querySelectorAll("[data-message-id]")).toHaveLength(
        longTranscript.length,
      );
      await expect(transcript.clientHeight).toBeGreaterThan(0);
      await expect(
        transcript.scrollHeight - transcript.clientHeight - transcript.scrollTop,
      ).toBeLessThan(2);
    });
    // Navigation relinquishes positioning/follow ownership before moving the
    // viewport. A bare scroll event alone can still be an application scroll.
    await fireEvent.wheel(transcript, { deltaY: -120 });
    transcript.scrollTop = Math.round((transcript.scrollHeight - transcript.clientHeight) / 2);
    transcript.dispatchEvent(new Event("scroll"));
    // Newly relevant content-visibility rows can adjust native scroll anchoring.
    // Record the rendered reading position after observer/frame work settles.
    // oxlint-disable-next-line effecttsgo/new-promise -- Storybook owns this bounded DOM-frame wait for native observers and rendered rows to settle.
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    const readingPosition = transcript.scrollTop;
    await expect(readingPosition).toBeGreaterThan(0);
    await expect(
      transcript.scrollHeight - transcript.clientHeight - readingPosition,
    ).toBeGreaterThan(transcript.clientHeight);
    await expect(canvas.getByRole("button", { name: "Scroll to bottom" })).toBeVisible();
    const cancel = canvas.getByRole("button", { name: "Cancel message: Follow-up 17" });
    await reveal(cancel);
    await userEvent.click(cancel);
    await expect(canvas.queryByRole("button", { name: "Cancel message: Follow-up 17" })).toBeNull();
    await reveal(send);
    await expect(transcript.scrollTop).toBe(readingPosition);
    await expect(canvas.getByRole("button", { name: "Scroll to bottom" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Scroll to bottom" }));
  } else {
    await reveal(canvas.getByRole("button", { name: "Project: project" }));
    await reveal(canvas.getByRole("button", { name: "Retry" }));
  }
  const remove = canvas.getByRole("button", { name: "Remove notes-23.txt" });
  await reveal(remove);
  await userEvent.click(remove);
  await expect(canvas.queryByRole("button", { name: "Remove notes-23.txt" })).toBeNull();
  await reveal(canvas.getByRole("button", { name: "Dismiss notice" }));
  await checkMenu();
  if (!newDraft) {
    const transcript = region(".transcript-view");
    await waitFor(async () => {
      await expect(
        transcript.scrollHeight - transcript.clientHeight - transcript.scrollTop,
      ).toBeLessThan(2);
    });
  }

  // Retry belongs to the editor wrapper even while ProseMirror itself is blurred.
  await userEvent.click(canvas.getByRole("button", { name: "Fail command catalog" }));
  await userEvent.clear(prompt);
  prompt.focus();
  await userEvent.type(prompt, "/", { skipClick: true });
  let menu = await canvas.findByRole("region", { name: "Suggestions" });
  let retry = within(menu).getByRole("button", { name: "Try again" });
  await expectHitTarget(retry);
  retry.focus();
  await expect(retry).toHaveFocus();
  await expect(canvas.getByRole("region", { name: "Suggestions" })).toBe(menu);
  if (!newDraft) {
    // Leaving Retry without activating it must close the menu as well; an
    // editor-only blur handler cannot observe this second focus transition.
    const model = canvas.getByRole("button", { name: "Model: Claude" });
    model.focus();
    await expect(model).toHaveFocus();
    await expect(canvas.queryByRole("region", { name: "Suggestions" })).toBeNull();
    await expect(canvas.getByLabelText("Catalog retry count")).toHaveTextContent("0");
    await expect(prompt.textContent).toBe("/");
    prompt.focus();
    await userEvent.type(prompt, "c", { skipClick: true });
    menu = await canvas.findByRole("region", { name: "Suggestions" });
    retry = within(menu).getByRole("button", { name: "Try again" });
    retry.focus();
    await expect(retry).toHaveFocus();
    await expect(canvas.getByRole("region", { name: "Suggestions" })).toBe(menu);
    await expectHitTarget(retry);
  }
  await userEvent.click(retry);
  await expect(canvas.getByLabelText("Catalog retry count")).toHaveTextContent("1");
  await expect(canvas.getByRole("region", { name: "Suggestions" })).toBe(menu);
  await expect(prompt).toHaveFocus();
  await expect(prompt.textContent).toBe(newDraft ? "/" : "/c");

  // Scrolling moves the anchor while visible, then hides the top-layer menu when
  // the editor is fully clipped, without changing the query's lifetime.
  const anchor = region(".prompt-editor");
  const before = anchor.getBoundingClientRect().top;
  const menuBefore = menu.getBoundingClientRect();
  const start = scroller.scrollTop;
  scroller.scrollTop = Math.max(0, start - 8);
  await waitFor(async () => {
    await expect(anchor.getBoundingClientRect().top).not.toBe(before);
    const rect = menu.getBoundingClientRect();
    await expect([rect.top, rect.bottom]).not.toEqual([menuBefore.top, menuBefore.bottom]);
    await expectHitTarget(menu);
  });
  scroller.scrollTop = scroller.scrollHeight;
  await waitFor(async () => {
    await expect(anchor.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      scroller.getBoundingClientRect().top,
    );
    const rect = menu.getBoundingClientRect();
    await expect(
      menu.contains(
        document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2),
      ),
    ).toBe(false);
  });
  await reveal(prompt);
  await expectHitTarget(menu);
  await userEvent.keyboard("{Escape}");
  await expect(canvas.queryByRole("region", { name: "Suggestions" })).toBeNull();
  await expect(prompt).toHaveFocus();
  await fireEvent.keyDown(prompt, {
    key: "b",
    code: "KeyB",
    keyCode: 66,
    metaKey: /Mac/.test(navigator.platform),
    ctrlKey: !/Mac/.test(navigator.platform),
  });
  await expect(canvas.queryByRole("region", { name: "Suggestions" })).toBeNull();
  await expect(canvas.getByLabelText("Submission count")).toHaveTextContent("1");
  await reveal(send);
  await userEvent.click(send);
  await expect(canvas.getByLabelText("Submission count")).toHaveTextContent("2");
}
