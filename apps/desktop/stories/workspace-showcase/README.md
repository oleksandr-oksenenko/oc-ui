# Full workspace review

Open **Showcase / AMOLED Workspace / Workspace Showcase**. The Current / Proposed /
Warm paper switch compares the foundation treatment. Warm paper keeps Proposed's
layout and typography with a restrained palette inspired by
[Flexoki](https://stephango.com/flexoki): a near-white canvas, nearly neutral gray
supporting surfaces, and charcoal ink. The theme control switches Light and Dark. All data and
submissions in these stories are local fixtures.

## Component coverage

| Surface                                                                                                         | Where to see it                                                                                  |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Titlebar, sidebar, session tree, filtering, attention indicators, theme switch                                  | Default workspace; use the sidebar filter and expand session groups                              |
| Conversation text, code, table, image/file attachments, tool/reasoning details, activity rows, return-to-latest | Default conversation; scroll up and expand **Activity**, then a reasoning or tool row            |
| Question form                                                                                                   | Default conversation; choose an answer and Continue                                              |
| Permission request                                                                                              | Select **Rename Helpers** under Refactor Utils                                                   |
| Requests and their field types                                                                              | Open the requests icon with a **3** badge in the sidebar footer                                                      |
| Composer model, agent and variant menus, context meter and tooltip                                              | Default composer; open each picker or hover/focus the context ring                               |
| Command and skill suggestions, inline skill chips                                                               | Type `/`; choose a skill, or `/compact` to see command feedback                                  |
| File/image previews, remove controls, paste attachment                                                          | Use the composer attachment button or paste; browser captures also add an image                  |
| Transcript highlights, annotation popover/editor, annotation count/discard                                      | Open **Annotations · 1 comment**, or select transcript text and choose **Add note**              |
| Inline diff comments, line selection, comment editor/removal                                                    | Default Diff panel; click a comment to edit, or select a line and add a comment                  |
| Review discard confirmation                                                                                     | Use the × beside **Code review · 2 comments**                                                    |
| Diff comparison menu, collapse/expand                                                                           | Default Diff panel; review drafts are separate for Working changes and Changes vs main           |
| Pending-message cards, Queue, Steer now, cancel, Stop                                                           | **Queued Workspace**, or select Refactor Utils; type a follow-up and use ⌘ Enter to queue        |
| Failed tool output and assistant error                                                                          | **Failed Tool Workspace**, or select Error Handling under Prototype API → Implement Endpoints    |
| Loading indicators and disabled controls                                                                        | **Loading Workspace**                                                                            |
| Connection failure, stale diff, inline errors and Retry                                                         | **Error Recovery Workspace**; Retry restores the ready fixture                                   |
| Empty sidebar, empty conversation and empty diff                                                                | **Empty Workspace**; Create session opens the normal creation flow                               |
| New-session dialog, project picker, directory browser                                                           | Create session → project picker / Add project                                                    |
| Delete-session confirmation                                                                                     | Focus a session, then Tab to its delete button                                                   |
| Connection form                                                                                                 | Select server in the sidebar footer; connecting returns to the fixture workspace                 |
| Toast                                                                                                           | Create a session, select a server, or run the `/compact` preview command                         |
| Browser tabs, address field, annotation controls/cards, capture image preview                                   | Open Browser; Annotate / Select area creates a sample capture; add a comment and Add to composer |
| Narrow and mobile panel controls                                                                                | **Narrow Workspace** and **Mobile Workspace**                                                    |

## Scope of the preview

The story renders the production visual components and reuses the real review and
annotation draft stores. The former review-count-only placeholder and inert server
selector have been replaced with working local interactions.

Native web-page rendering, element/area capture selection, OS file dialogs, real
server traffic, and live streaming require Electron or the browser acceptance
fixtures. The Browser panel labels its sample captures explicitly. Less common
failure combinations remain in the dedicated component stories (permission reply
failure, unavailable model catalog, browser reconnect, and project validation).

The showcase is a set of reachable states, not a page that displays mutually
exclusive loading, failure, and success states at the same time.
