# OpenCode native browser backend

Adapted from anomalyco/opencode commit
`013ded3743eb9c198d8f544afdfd60fdad1e68a4` (beta 19271),
`packages/desktop/src/main/browser-chromium.ts` and `browser/`.
The MIT license is preserved in LICENSE; browser-chromium.ts is named page.ts.

The OpenCode 2.0.3 release (`d44b52ca66b6bf69626c0384626d1a9cd9555977`) contributes
keyboard focus retention during navigation and F5 reload. Its unloaded-tab
restore is not adopted: oc-ui keeps every tab loaded for its whole attachment, so
there is no suspended inventory to rebuild.

oc-ui owns networking and attachment/tab lifetimes outside this directory. Local
changes retain and cancel pending operations until disposal, check array indexes,
and wait for Chromium's first frame before pointer input without replaying it.
Unused corner overlays and approval-preview metadata were removed; the tab manager
rejects preview requests. All 44 registered tool operations remain implemented.
Review the backend and protocol together when upgrading the pinned packages.
