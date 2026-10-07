# Visual role placement

Use the pinned `@opencode/ui` controls directly. `foundations.css` owns the
existing type, palette, and elevation roles; `opencode-overrides.css` adapts
upstream hardcoded styles. Feature owners choose placement through existing
`size` and `variant` props. No additional component or token scale is needed.

## Actions

| Placement                 | Text action                                                                     | Production evidence                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Setup or dialog footer    | `normal` (28px); `contrast` for the next step, `outline` for a secondary action | ConnectionForm, AddProjectDialog; ReviewDialog's Keep pending                                                           |
| Inline recovery           | `small` (24px), `outline`                                                       | TranscriptView, DiffView (initial and stale-data errors), SessionSidebar, ServerDirectoryBrowser, request-review errors |
| Toolbar or inline utility | `small`, usually `ghost-muted`; use `ghost` when full text emphasis is needed   | ThemeToggle, diff collapse, new-session pickers and inline branch Cancel                                                |
| Destructive confirmation  | `normal`, `danger`; Cancel uses `outline`                                       | DeleteSessionDialog, CodeReviewRemovalDialog                                                                            |

Placement determines size, not the action's label. Setup Retry remains the
primary next step (`normal` / `contrast`) in ConnectionForm and BuiltInStartup;
an inline Retry beside retained content is `small` / `outline`. Loading and
disabled behavior stays with the existing control and workflow owner.

IconButton has different upstream geometry: `normal` is 24px and `small` is
20px. Keep normal titlebar/sidebar icons and small dense-panel utility icons;
do not equate its size names with Button's heights. Full-width session/request
rows retain their row-owned sizing and selection treatment. Permission and
question cards retain small response actions even inside ReviewDialog: they
belong to the embedded request, not the dialog footer. Optional draft tools
(Check session, Edit draft, Copy to edit) retain ghost-muted emphasis beside
the outlined recovery action. Composer submission and queue controls retain
their specialized placement.

## Typography

Apply the complete existing role (family, size, weight, line height), rather
than mixing upstream weights with a product size. Actions and select values
use control (13px / 16px / 500); entered text, dialog copy, and transcript
recovery messages use body (13px / 20px / 400). Field labels use label
(12px / 16px / 500); hints use caption (12px / 16px / 400). Dialog titles use
title (15px / 20px / 600). Setup page titles keep page-title. Diff and saved
connection status use their existing diff-stat, metadata, and status roles.
Semantic strong text and code retain their own emphasis and family.

## Surfaces and focus

Ordinary controls have a neutral 1px inset resting edge in both themes, not
the content-card shadow. Cards keep card elevation; the composer keeps lift;
menus, dialogs, and popovers keep floating elevation with a 1px border and
panel radius. This separates controls from contained content in light mode
and leaves visible control edges when dark card/lift shadows are absent.
Keep the Warm Paper palette and its existing surface steps.

Keyboard focus remains neutral, 1px, and flush; `focus.css` owns geometry and
compound-field delegation. Do not replace it with a control shadow. Keep the
literal light/dark color and geometry regressions in Focus and Composer.
Verify changes with real-component stories and the app checks in
[App verification](app-verification.md).
