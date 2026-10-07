import { Cache, Duration, Effect, Exit, Schema } from "effect";
import type { ResttyFontInput } from "restty";

import fontUrl from "../../../../assets/terminal-fonts/JetBrainsMonoNerdFontMono-Regular.ttf?url";
import emojiFontUrl from "../../../../assets/terminal-fonts/NotoEmoji-Variable.ttf?url";
import symbolsFontUrl from "../../../../assets/terminal-fonts/NotoSansSymbols2-Regular.ttf?url";
import cjkFontUrl from "../../../../assets/terminal-fonts/NotoSansCJKsc-Regular.otf?url";
import { WorkspaceRequestError, type WorkspaceOwner } from "../../../../workspace-owner.ts";

const sources = [
  { url: fontUrl, name: "JetBrains Mono Nerd Font" },
  { url: emojiFontUrl, name: "Noto Emoji" },
  { url: symbolsFontUrl, name: "Noto Sans Symbols 2" },
  { url: cjkFontUrl, name: "Noto Sans CJK SC" },
];
const decodeBuffer = Schema.decodeUnknownSync(Schema.instanceOf(ArrayBuffer));

/** XHR supports packaged file assets as well as HTTP; Chromium fetch does not. */
const readFont = Effect.fn("TerminalFonts.read")((url: string) =>
  Effect.suspend(() => {
    const request = new XMLHttpRequest();
    return Effect.callback<ArrayBuffer, WorkspaceRequestError>((resume) => {
      request.open("GET", url);
      request.responseType = "arraybuffer";
      const loaded = () => {
        cleanup();
        resume(
          Effect.try({
            try: () => {
              if (
                request.status !== 200 &&
                !(new URL(url).protocol === "file:" && request.status === 0)
              )
                throw new Error(`Terminal font could not load: ${request.status}`);
              return decodeBuffer(request.response);
            },
            catch: (cause) => new WorkspaceRequestError({ cause }),
          }),
        );
      };
      const failed = () => {
        cleanup();
        resume(
          Effect.fail(
            new WorkspaceRequestError({ cause: new Error("Terminal font could not load.") }),
          ),
        );
      };
      const cleanup = () => {
        request.removeEventListener("load", loaded);
        request.removeEventListener("error", failed);
        if (request.readyState !== 4) request.abort();
      };
      request.addEventListener("load", loaded);
      request.addEventListener("error", failed);
      request.send();
      return Effect.sync(cleanup);
    });
  }),
);

/** Shared font bytes live in the workspace; losing a surface does not cancel their load. */
export function createTerminalFonts(
  effects: WorkspaceOwner,
): Effect.Effect<readonly ResttyFontInput[], WorkspaceRequestError> {
  const cache = effects.runSync(
    Cache.makeWith(readFont, {
      capacity: sources.length,
      timeToLive: (exit) => (Exit.isSuccess(exit) ? Duration.infinity : Duration.zero),
    }),
  );
  return Effect.forEach(
    sources,
    ({ url, name }) =>
      Cache.get(cache, new URL(url, document.baseURI).href).pipe(
        Effect.map((data) => ({ data, name })),
      ),
    { concurrency: sources.length },
  );
}
