# Storybook verification

The desktop Storybook is the renderer's controlled verification surface. Its
project configuration separates the `unit`, `storybook`, `storage`, and `web`
Vitest projects. Storybook and Chromium storage tests belong to tier 1, which
runs on Linux x64 in GitHub Actions on every PR, push to `main`, and manual
dispatch. The Components job also builds the static Storybook catalog.
Use [App verification](app-verification.md) to decide when stories, full-app
workflows, Electron checks, and packaging checks are needed.

Run the component tier from the root when a full local run is useful:

```sh
pnpm build-storybook && pnpm test:components
```

To run only the Storybook project while developing, use the existing Vite+
runner directly:

```sh
pnpm --filter desktop exec vp test run --project=storybook
```

The Storybook test project uses the Storybook 10.5.10 Vitest addon in headless
Chromium. The browser provider is an execution detail of the Storybook project;
Storybook does not need a separate Playwright suite. The full browser app has its
own `web` Vitest project using Playwright. Use automated tests for final behavioral
verification and targeted visual inspection for appearance or usability questions
that assertions do not establish; see the app verification guide.
Capture screenshots when they help review the change or explain a failure.

A fresh development or CI machine must provision that Chromium runtime once:

```sh
pnpm --filter desktop exec playwright install chromium
```

On Linux, add `--with-deps` to install its system libraries as CI does.

Project-wide accessibility checks run with `parameters.a11y.test = "error"`, so
an accessibility regression fails the Storybook project. Any temporary exception
must be scoped to the affected story and document the known violation instead of
weakening the catalog-wide gate. The shared viewport toolbar provides these named states:

- `desktop`: 1440 × 900
- `narrow`: 820 × 900
- `mobile`: 390 × 760

The static Storybook build runs in the Linux Components job and in the opt-in root
`pnpm ready:ci` command. Local `pnpm ready` runs static checks and unit tests only;
it does not require Chromium.
