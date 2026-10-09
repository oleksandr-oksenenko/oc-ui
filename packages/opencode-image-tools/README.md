# OpenCode image tools

An OpenCode V2 server plugin providing `image_generate` through the active OpenAI
ChatGPT subscription connection. It is included in oc-ui's built-in server. The
conversational model can use any provider; the image request uses ChatGPT OAuth.

## Usage

Connect OpenAI with ChatGPT sign-in, then ask your agent to generate or edit an
image. `image_generate` is available only through Code Mode's `execute`, with its
signature discoverable through Code Mode search. Inside `execute`, call:

```ts
return await tools.image_generate({
  prompt: "An otter reading a book",
  outputPath: "illustrations/otter.png", // optional
  referencePaths: ["reference.png"], // optional; selects editing
  background: "auto", // auto | opaque | transparent
});
```

Paths belong to the connected server and resolve against the calling session's
directory. The default output is `generated_images/<tool-call-id>-<unique-id>.png`,
so multiple calls within one `execute` get distinct files. Existing outputs are
never overwritten. References may be PNG, JPEG, WebP, or GIF; at most
five, 20 MiB each and 40 MiB combined. Reference symlinks are followed and bytes are
read from one bounded regular-file handle and decoded before dispatch. Returned
PNGs must also decode successfully and fit the 20 MiB image limit. HTTP response
bodies are capped at 28 MiB before JSON parsing or base64 decoding, including
chunked responses and error bodies. Remote workspace locations are unsupported.

The tool uses the calling server's existing permission services: `image_generate`
for the operation, `edit` for the output, and `read` / `external_directory` for
file access. Approval, rejection, and cancellation follow OpenCode's normal policy.

## Standalone configuration

Build with `pnpm --filter @oc-ui/opencode-image-tools build` using the repository's
pinned Node version. Point an OpenCode **2.0.3** server at the resulting directory:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "file:///absolute/path/to/packages/opencode-image-tools/dist/",
      "options": { "model": "gpt-image-2" },
    },
  ],
}
```

The model is a plugin option, defaulting to `gpt-image-2`. Generation and editing
were live-tested with `gpt-image-2`, `gpt-image-2.5-sunburst`, and
`gpt-image-2.5-flare` on October 9, 2026. Availability depends on the connected
account. Transparent-background behavior was not established by those probes.

## Results and recovery

Results containing image bytes include a preview and an original PNG attachment.
The original uses `application/octet-stream` with a `.original.png` name to bypass image
normalization. Code Mode collects both attachments automatically, including when
later JavaScript throws or returns only part of the tool result. In oc-ui, clicking
the preview opens the original image from the persisted attachment, including
after reload. Return the tool result
as shown above to persist its structured data in the `execute` output text. If
saving fails after generation, the result has `saved: false`, `requestedPath`, a warning, and
the original PNG attachment for recovery. Structured output contains no base64 image
data. A provider URL-only response fails explicitly with the recovery URL in its
error message, without downloading it or regenerating. Cleanup failures report `partialPath`.

Session request hooks keep original attachments in the persisted transcript but
exclude them from outgoing model requests; models receive the image previews.
This applies to chat, compaction, title, and transient generation requests.

OpenCode may resize preview attachments; use the original PNG attachment, saved
PNG, or recovery URI for the original bytes. Transport errors and timeouts can have an
uncertain generation outcome. The plugin makes one request and does not retry.

## Ownership and implementation

Registration belongs to the plugin scope. Each admitted invocation belongs to the
calling tool fiber and owns its filesystem and scoped HTTP services. Interruption
aborts HTTP, closes file handles, and removes incomplete staging files.
Completed images are published by an exclusive hard link on the same filesystem;
concurrent output files survive both cancellation and publication failure. Filesystems
without hard-link support return the original PNG attachment for recovery. A complete,
synced PNG whose publication fails is retained in its private staging directory;
`partialPath` and a server warning identify it. This fallback survives cancellation
before recovery reaches the transcript and can be removed after recovery. Non-cancellable
native file acquisition and commit settle before cleanup. Unloading removes future
registrations; already captured executors remain callable under OpenCode's tool
snapshot contract. Server shutdown interrupts its owned tool calls.

The plugin reuses OpenCode's permission/file-access owner, OAuth resolution/refresh, Images adapter, request
executor, MIME detection, the same Photon decoder, and tool-result normalization.
The pinned OpenCode core package and Photon are runtime dependencies. Photon includes
its WASM asset; the desktop server's
staged dependencies already include it. A narrow compatibility
bridge changes the adapter's multipart edit request to the Codex backend's JSON
image references. It uses `https://chatgpt.com/backend-api/codex/images/…`, which
is a subscription backend rather than the public API-key Images endpoint.

Focused tests cover request formatting, authentication, references, collisions,
recovery, malformed images, bounded response reads, and cancellation. Browser acceptance exercises the built plugin against
the pinned server with fixture OAuth and a local HTTP image transport, including
preview rendering and reload persistence.
