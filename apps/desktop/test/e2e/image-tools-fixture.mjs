import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { crc32, deflateSync } from "node:zlib";

// Exceed upstream's 2000px preview bound so acceptance can distinguish an
// original attachment from its resized preview without a large fixture file.
export const imageFixtureWidth = 2100;
const header = Buffer.alloc(13);
header.writeUInt32BE(imageFixtureWidth, 0);
header.writeUInt32BE(imageFixtureWidth, 4);
header[8] = 8;
header[9] = 6;
const row = Buffer.concat([
  Buffer.from([0]),
  Buffer.alloc(imageFixtureWidth * 4, Buffer.from([0, 128, 255, 255])),
]);
function pngChunk(type, data) {
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  return chunk;
}
export const imageFixtureBase64 = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  pngChunk("IHDR", header),
  pngChunk(
    "IDAT",
    deflateSync(Buffer.concat(Array.from({ length: imageFixtureWidth }, () => row))),
  ),
  pngChunk("IEND", Buffer.alloc(0)),
]).toString("base64");

export async function serveImageFixture(request, response, requests) {
  if (request.method !== "POST" || !["/images/generations", "/images/edits"].includes(request.url))
    return false;
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  requests.push({
    kind: "image",
    operation: request.url.split("/").at(-1),
    model: body.model,
    references: body.images?.length ?? 0,
  });
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(
    JSON.stringify({
      created: 1,
      data: [
        body.prompt === "URL-only response"
          ? { url: "https://example.invalid/retained-image.png" }
          : { b64_json: imageFixtureBase64 },
      ],
    }),
  );
  return true;
}

/** Exercise the built plugin with fixture OAuth and a local image transport. */
export async function createImageToolsFixture(directory, providerUrl) {
  const pluginDirectory = join(directory, "image-tools-fixture");
  await mkdir(pluginDirectory, { recursive: true });
  await writeFile(
    join(pluginDirectory, "package.json"),
    JSON.stringify({ type: "module", exports: "./index.js" }),
  );
  const filename = join(pluginDirectory, "index.js");
  await writeFile(
    filename,
    `
import { Effect } from ${JSON.stringify(import.meta.resolve("effect"))};
import { FetchHttpClient } from ${JSON.stringify(import.meta.resolve("effect/unstable/http"))};
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
export default {
  id: "acceptance.image-transport",
  effect: (ctx) => Effect.gen(function* () {
    yield* ctx.integration.transform((editor) => editor.method.update({
      integrationID: "openai",
      method: { id: "chatgpt-browser", type: "oauth", label: "Fixture ChatGPT" },
      authorize: () => Effect.succeed({
        mode: "auto", url: "https://example.invalid/fixture", instructions: "Fixture only",
        callback: Effect.succeed({ type: "oauth", methodID: "chatgpt-browser", access: "fixture-image-access", refresh: "fixture-image-refresh", expires: 9999999999999 })
      })
    }));
    yield* ctx.tool.transform((editor) => editor.update("image_generate", (tool) => {
      const execute = tool.execute;
      tool.execute = (input, context) => execute(input, context).pipe(
        Effect.provideService(FetchHttpClient.Fetch, async (url, init) => {
          const endpoint = new URL(url);
          if (endpoint.origin !== "https://chatgpt.com" || !/^\\/backend-api\\/codex\\/images\\/(generations|edits)$/.test(endpoint.pathname)) {
            throw new Error("Unexpected image fixture destination");
          }
          if (JSON.parse(await new Request(url, init).text()).prompt === "Concurrent destination") {
            await writeFile(join(ctx.location.directory, "acceptance-collision.png"), "unrelated content");
          }
          return fetch(${JSON.stringify(providerUrl)} + endpoint.pathname.replace("/backend-api/codex", ""), init);
        })
      );
    }));
  })
};
`,
  );
  return pathToFileURL(pluginDirectory + "/").href;
}
