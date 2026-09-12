# CSS consolidation assessment and plan

Status: implemented; verification recorded below. Initial assessment at `c93d79a`
on 2026-09-12 against `@opencode-ai/ui@0.0.0-beta-19271`. The inventory below
describes the pre-cleanup source.

## Intended result

One app-owned CSS foundation: one semantic token vocabulary, consistent shared
rules, and local component styles that consume them. Reconcile our uses of old
and new styles into that foundation. App-owned names have no `v2` prefix.
OpenCode is an external dependency and remains unchanged. This is a styling
consolidation, not a replacement of component behavior or a switch to OpenCode's
default appearance.

One system does not require one file. Tokens, base rules, focus behavior, and
component styles can remain separate files with explicit ownership. Centralized
mappings from the app's tokens to the names required by OpenCode are part of the
foundation's integration boundary. They do not define a second product palette.

## What exists

The file named foundations is active product styling, not an abandoned framework.
Git history introduces it in `b77d2d3` (2026-08-31, “unify the design system”) and
shows continued focus changes through the assessed commit.

| Layer                     | Evidence                                                                                                                                                                                         | Assessment                                                                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product tokens            | [foundations.css](../apps/desktop/src/renderer/styles/foundations.css)                                                                                                                           | 171 lines, 141 declarations: 87 `--oc-*` tokens and 54 upstream/compatibility declarations. Owns palette, typography, radius, focus, shadows, and scrollbar values. |
| Legacy upstream CSS       | Package `src/styles/theme.css`, `colors.css`, and components such as list, popover, collapsible, scroll-view, text-field                                                                         | Uses names such as `--text-base`, `--border-weak-base`, and `--radius-sm`. Still loaded and consumed.                                                               |
| New upstream CSS          | Package `src/styles/tokens/theme.css`, `colors.css`, and actions/forms/overlays                                                                                                                  | Uses `--v2-*` names; newer components also embed concrete geometry and typography.                                                                                  |
| Local corrections         | [opencode-overrides.css](../apps/desktop/src/renderer/styles/opencode-overrides.css), [focus.css](../apps/desktop/src/renderer/styles/focus.css)                                                 | Reconcile some upstream differences by overriding radius, contrast actions, disabled states, and focus geometry.                                                    |
| Global base               | [reset.css](../apps/desktop/src/renderer/styles/reset.css), upstream `src/styles/base.css`                                                                                                       | Some reset overlap; local file also owns necessary app dimensions, overflow, and Electron no-drag behavior.                                                         |
| Entry points              | [mount-app.tsx](../apps/desktop/src/renderer/mount-app.tsx), [Storybook preview](../apps/desktop/.storybook/preview.ts)                                                                          | Both load upstream styles, upstream new tokens, then local styles. Upstream uses cascade layers; local rules are unlayered.                                         |
| Enforcement and reference | [Stylelint](../stylelint.config.mjs), [Foundations story](../apps/desktop/stories/design-system/Foundations.stories.tsx), [Focus story](../apps/desktop/stories/design-system/Focus.stories.tsx) | Lint reserves concrete values for foundations; stories document product choices and test precise focus behavior.                                                    |

Static scope, excluding the foundation itself: 586 `var(--oc-...)` references in
28 production files, and 243 in six story files. Counts include CSS strings in
TypeScript, but not token-name strings displayed by the Foundations story.
No `--oc-*` declaration was unreachable when retaining all upstream bridges and
following references from local CSS consumers. That is not proof every bridge is
needed at runtime, but it rules out treating the whole file as dead code.

Important mixed cases:

- `QuestionForm.css` uses both product tokens and legacy border/icon/radius names.
- `PermissionRequestCard.css` and `PermissionsDialog.css` use `--font-mono`;
  the foundation comment describing one consumer is stale.
- Several connection/session styles already use `--v2-*` alongside `--oc-*`.
- Upstream Card mixes newer color tokens with older typography and radius tokens.
- Upstream Checkbox lives in `forms/`, but still consumes legacy tokens. Directory
  names and the presence of a `v2` selector cannot classify styling ownership.
- Upstream Button hardcodes 6px normal radius and 2px focus with 2.5px offset;
  oc-ui corrects these to its 4px radius and compact 1px focus treatment.
- Upstream Button CSS also declares global font smoothing and text rendering,
  overlapping the local root's rendering policy.

Runtime-generated CSS must be included: [annotation highlights](../apps/desktop/src/renderer/components/App/ConnectedApp/Conversation/createAnnotationHighlights.ts)
and [Pierre diff customization](../apps/desktop/src/renderer/components/App/ConnectedApp/Changes/ContextPanel/DiffView/DiffFile/PierreDiffBody.tsx).
The diff renderer has its own syntax theme and internal styling contract; preserve
that integration and consolidate the app-provided styles at its boundary.

## Recommended ownership

Use the existing `--oc-*` semantic vocabulary as the starting point, then remove
synonyms only after comparing their roles and states. Do not create a fourth
vocabulary or mechanically strip `v2-` from names. Equal current values do not
necessarily mean equal roles: destructive text and diff deletion, for example,
may need distinct semantics.

Keep `styles/foundations.css` as the single owner of product values and semantic
roles. It already owns most of this responsibility; improve it rather than
replacing it with a parallel token system. Retain product typography roles where
they express actual requirements. Add missing roles only for concrete uses.

Keep the existing mapping section in that foundation as the sole definition of
OpenCode token overrides. Both `--text-base` and `--v2-text-text-base`, for example,
can refer to `--oc-text-base`. Direction is one-way: product value to dependency
token, never a cycle or a second literal palette. Font-family inputs can continue
to use the dependency's published font definitions. Local feature styles consume
`--oc-*` roles instead of choosing between the upstream token generations.

Keep `focus.css` as the owner of shared focus policy and
`opencode-overrides.css` as the narrow adapter for upstream selectors and
hardcoded styling that tokens cannot control. Both consume foundation values.
Keep local layout and feature-specific states beside their components. Consolidate
duplicate rules within these owners; do not move every feature rule into global CSS.

Preserve the package, its CSS imports, and its component contracts. No dependency
patch, fork, vendoring, build-time rewriting, or upstream selector rename is
required. Existing `data-component="button-v2"` and similar attributes remain
valid external contracts. Their use in integration selectors and tests is allowed;
the naming cleanup applies to our own design vocabulary.

## Implementation sequence

1. **Inventory the complete loaded CSS dependency graph.** Install from the
   existing lockfile. Trace entrypoint styles, component CSS side effects, nested
   imports, and runtime-generated CSS across desktop, web, and Storybook. Record
   each app-used token's definitions, consumers, state variants, and replacement. Classify
   by actual use, not old/new directory names. Check for runtime theme injection:
   upstream's theme provider can emit both token generations, although this app's
   mount path currently does not install it.

2. **Reconcile the visual contract.** Use existing stories as the baseline. Resolve
   colors, typography, radius, elevation, disabled/invalid/selected/hover states,
   and focus as explicit decisions. Preserve current product values by default,
   especially the recently verified neutral compact focus. Separate duplicate
   values from distinct semantic roles. Record genuinely conflicting choices
   before implementation rather than accepting whichever rule wins the cascade.

3. **Consolidate the app foundation and dependency mappings.** Reconcile product
   definitions in `foundations.css`. Map both upstream token families to those
   roles wherever the app needs a consistent product value. Preserve upstream
   defaults where no product override is needed; do not mirror every published
   token. Review legacy list/popover/collapsible/scroll-view and mixed card/checkbox
   states alongside newer controls to find gaps. Remove redundant app aliases
   only after migrating their consumers. Retain mappings still used by upstream.

4. **Migrate local consumers in bounded groups.** Cover shell and sessions;
   connection/forms/permissions/dialogs; then transcript/composer/annotations/diffs.
   Update legacy and `--v2-*` local references to the reconciled vocabulary.
   Include inline styles, injected CSS, stories, and token catalogs. Reuse existing
   components; Accordion is not automatically a behavior-equivalent replacement
   for Collapsible, and component replacement is unnecessary for this CSS goal.

5. **Collapse competing app-owned rules.** Centralize local radius and focus
   corrections in their chosen owners. Remove superseded local override selectors
   and declarations, keeping compound-field focus delegation, invalid-state
   visibility, and inset rings. Remove local reset duplication only where upstream
   provides equivalent behavior at the actual cascade priority. Preserve viewport
   sizing, root overflow, runtime-layer sizing, and Electron drag rules. Establish
   the documented import order for tokens, base, components, and feature styles;
   account for existing unlayered component imports and important declarations.
   A layer change must be verified, not treated as cosmetic.

6. **Enforce one app vocabulary.** Remove obsolete app aliases and duplicate
   declarations. Keep the foundation, necessary upstream mappings, and integration
   selectors. Update the Foundations catalog to present only canonical app roles.
   Extend the existing lint/check path to prevent direct legacy or `--v2-*` design
   token use in local feature styles, including injected CSS. Allow upstream token
   declarations only in the foundation mapping section and documented external
   contracts such as font inputs. Keep upstream selectors valid in adapters and
   tests. Reuse the current Stylelint foundation exemption for concrete values;
   avoid a separate permanent verification command.

7. **Verify the combined result.** Run the root gates and affected UI checks below.
   Inspect app-owned CSS for residual mixed token use and unresolved custom
   properties, including values without fallbacks. Report production,
   tests, documentation, and generated-code growth separately, with remaining
   overrides and their reasons.

## Verification and completion criteria

Follow [App verification](app-verification.md). The following criteria guided the
cleanup; the result and completed checks are recorded below.

- Run `pnpm check` and `pnpm test` after implementation. Reuse existing Storybook
  interaction/accessibility and full browser acceptance coverage.
- Preserve and extend meaningful gaps in `Focus.stories.tsx`; it already checks
  exact ring color/width/offset, delegated focus, invalid controls, and disabled
  behavior. Do not replace these with tests that only compare token strings.
- Inspect representative old, new, and mixed component families visually at the
  documented viewports. Check hover, keyboard focus, disabled/invalid controls,
  overlays, clipping, long content, transcript selection, and diff controls.
- Build desktop, web, and Storybook if style entrypoints or cascade integration
  change. Inspect Electron titlebar/no-drag and window-edge appearance in the app.
  Use packaged acceptance if implementation affects native or packaging behavior,
  following the verification guide rather than assuming a dependency change.
- Finish with one app token vocabulary and one owner for each shared visual
  policy. Local features do not consume competing upstream design token families.
  Necessary mappings and selector overrides stay centralized at the integration
  boundary, with all product values sourced from the foundation. Upstream CSS and
  `v2` selector names may remain in the bundle because we do not own that code.
- Confirm package versions, lockfile, and dependency source remain unchanged.

## Initial assessment evidence limits

Dependencies were initially absent from this checkout. The exact pinned UI package was
downloaded to a temporary directory for source inspection; no dependency or
lockfile was changed. The counts above describe repository source, not rendered
coverage or a complete tree-shaken bundle inventory. Full loaded-CSS mapping and
visual comparison are the first implementation steps. No app was launched for
this structural assessment.

## Cleanup result

- Local feature and story styles now consume the app foundation. The remaining
  non-product custom properties are layout inputs, the catalog swatch input,
  Kobalte positioning, and upstream component configuration.
- Both OpenCode token generations remain mapped in `foundations.css`. Contextual
  diff colors and session-button overlays moved into `opencode-overrides.css`.
  The existing radius override groups share one declaration block.
- Removed five composer color aliases and the unused `--font-mono` alias. Renamed
  our composer classes from `composer-v2*` to `composer*`, including their unit and
  packaged-test consumers. OpenCode's selectors are unchanged.
- Moved the three remaining literal upstream theme values into named app roles:
  the highest raised surface and hover/pressed overlays. Centralized the form's
  repeated transition easing in `--oc-motion-ease`.
- Reconciled selected legacy checkbox and local radio colors with the app's strong
  border and selected surface. Reconciled the new-session error surface and its
  upstream token with `--oc-status-danger-surface`. These are intentional visual
  consistency changes; other migrated color references retain their values.
- The catalog now uses app typography roles and no longer falls back to the
  upstream type scale. Removed its redundant universal box-sizing rule. Retained
  the app reset and shared focus treatment: changing their cascade priority was
  unnecessary for this cleanup.
- `pnpm lint:styles` enforces the vocabulary in CSS and inline/injected CSS token
  references. Three regression tests cover both upstream families, adapter
  exemptions, nested fallbacks, unchanged upstream selector names, and undefined
  app tokens. The token audit also found an undefined `--oc-surface-base` reference
  in permission cards; those now use the existing canvas role.
- No dependency versions, dependency source, or lockfile changed. No runtime
  services, component wrappers, or application state were introduced.

### Completed verification

- `pnpm check`: passed, including the CSS and inline-token guards.
- `pnpm test`: all 777 tests passed across 94 files, including Storybook
  interaction/accessibility, the shared focus contract, and browser acceptance.
- `pnpm test:acceptance:mac`: all five packaged Electron scenarios passed. This
  also built the desktop app and checked the packaged artifact and owned cleanup.
  Acceptance uses disposable state, the pinned server, a scripted provider, and
  the native dialog/keychain substitutes described in the verification guide.
- In-app browser inspection: foundation catalog at 1280 and 390 pixels, selected
  form controls at 1280, session error state at 820, and permission cards at 1440.
  Checked typography, surface consistency, and visible layout; no new clipping
  was found. The temporary preview server and tab were closed.
- `git diff --check` and local document references: passed. Dependency versions
  and lockfile are unchanged. The inline annotation and diff styles already used
  valid app tokens and required no migration.

Full local verification log: `/tmp/ocui-css-final-verification.log`.

### Change size

| Category                                     | Added | Removed |  Net |
| -------------------------------------------- | ----: | ------: | ---: |
| Production                                   |   157 |     157 |   +0 |
| Tooling/configuration                        |    44 |       1 |  +43 |
| Tests and stories                            |   156 |      78 |  +78 |
| Documentation (assessment, plan, and result) |   252 |       0 | +252 |
| Generated source                             |     0 |       0 |    0 |

The production changes add no runtime abstractions. The new tooling is one shared
custom-property naming rule and a 28-line inline-reference checker in the existing
style lint command. Test growth covers vocabulary enforcement and undefined
app tokens. Removed machinery is six aliases (five composer colors and the short
mono font alias), repeated radius declarations, catalog type fallbacks, and our
versioned composer class names. The app reset, semantic roles with equal current
values, and required upstream mappings remain because they have distinct owners
or consumers.

## Find–fix–verify follow-up (2026-09-12)

This follow-up reviewed all 32 existing app/story stylesheets, inline styles,
CSS strings injected into shadow roots, and the pinned OpenCode selectors. The
new shared scrollbar stylesheet brings the app/story inventory to 33 files.
OpenCode package contents and dependency versions remain unchanged.

### Completed fixes

- Corrected the delete-session container selector and added a width/viewport
  regression assertion. The assertion fails with the original selector restored.
- Replaced hardcoded story backgrounds and diff font metrics with foundation
  roles. Normalized feature font weights and line heights to existing roles.
- Extended the existing inline-style check using the installed TypeScript parser
  and shared Stylelint design rules. It checks literal style values and injected
  CSS without treating displayed source code or expected-color assertions as CSS.
  Font-weight enforcement now also covers stylesheet and inline literals.
- Removed unnecessary composer priority flags, the duplicate screen-reader
  utility, and the radio radius declaration superseded by the central adapter.
- Consolidated repeated scrollbars into the opt-in `oc-scrollable` class and the
  rendered markdown code/table selectors in `styles/scrollbars.css`.
- A second audit removed unused session-depth inputs and their prop/recursion
  plumbing, plus an unused new-session guidance rule.
- Disabled question choices no longer acquire hover surfaces. A story assertion
  checks both radio and checkbox choices. The guard preserves validation
  specificity by using `:where()`.
- Replaced obsolete mobile viewport parameters in question, permission-card,
  and permissions-dialog stories with the configured Storybook mobile preset.

### Final audit and verification

- `pnpm check` and all 778 tests across 94 files passed after the second batch.
  This includes unit tests, Storybook interactions/accessibility, and automated
  browser integration with the pinned server and scripted provider.
- Focused runs passed: 32 dialog/composer/form stories in the first batch,
  four style-policy tests, and 33 form/permission stories in the second batch.
- The original delete-dialog selector fails the new assertion; the fixed
  selector passes. The temporary original selector was restored only for that
  negative control and is not present in the final source.
- In-app browser inspection covered the combined workspace at 1440×900,
  820×900, and 390×760. At mobile width the composer is 370px wide, there is no
  document horizontal overflow, and transcript scrollbars use the shared colors.
  The delete dialog is 358px wide within its 390px viewport, without overflow.
- Rechecked class consumers, token resolution, remaining priority rules,
  upstream slot contracts, and the combined diff. No further actionable findings
  remain from this audit. Compact transcript trigger height and central focus
  priority rules remain to override pinned upstream specificity. Custom form
  cards, composer layout, and diff annotations implement the approved app layout.
- `git diff --check` passed. The temporary browser tab and Storybook server were
  closed. Native integration and packaging were not changed or rerun in this
  follow-up; the earlier packaged result above belongs to the earlier candidate.

Full logs: `/tmp/ocui-css-loop-final-gates.log`,
`/tmp/ocui-css-loop-regression-proof.log`, `/tmp/ocui-css-loop-tokens.log`, and
`/tmp/ocui-css-loop-second-focused.log`.

### Follow-up change size

Relative to the saved working-tree snapshot at the start of this goal, excluding
prior cleanup changes:

| Category              | Added | Removed | Net |
| --------------------- | ----: | ------: | --: |
| Production            |    77 |     161 | -84 |
| Tooling/configuration |    91 |      20 | +71 |
| Tests and stories     |    94 |      48 | +46 |
| Documentation         |    74 |       0 | +74 |
| Generated source      |     0 |       0 |   0 |

The only new rendering abstraction is the opt-in scrollbar style. Tooling growth
adds syntax-aware extraction to the existing checker and shares its design rules
with Stylelint; it adds no dependency or parallel verification command. Test growth
covers the missed values, dialog width, and disabled hover regression.
