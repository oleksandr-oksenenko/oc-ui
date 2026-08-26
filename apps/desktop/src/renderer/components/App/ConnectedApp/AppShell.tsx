import type { JSX } from "solid-js";

import "./AppShell/AppShell.css";

export type AppShellProps = {
  readonly titlebar: JSX.Element;
  readonly workspace: JSX.Element;
};

/** The presentation-only frame shared by the connected application. */
export function AppShell(props: AppShellProps) {
  return (
    <main class="app-shell-v2">
      {props.titlebar}
      {props.workspace}
    </main>
  );
}
