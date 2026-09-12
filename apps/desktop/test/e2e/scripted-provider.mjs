import { createServer } from "node:http";

const model = (name) => ({
  name,
  capabilities: { tools: true, input: ["text"], output: ["text"] },
  limit: { context: 32768, output: 2048 },
});

// The real pinned OpenCode server consumes this local OpenAI chat-completion endpoint.
// Scenarios are selected by the latest user turn, so transcript history cannot retrigger them.
export async function startScriptedProvider() {
  const requests = [];
  let cancelledStreams = 0;
  const server = createServer(async (request, response) => {
    if (serveBrowserFixture(request, response)) return;
    if (request.url === "/_state") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ requests, cancelledStreams }));
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const messages = body.messages ?? [];
      const lastUser = messages.findLastIndex((message) => message.role === "user");
      const prompt = JSON.stringify(messages[lastUser]?.content ?? "");
      const afterUser = messages.slice(lastUser + 1);
      const toolReply = afterUser.find((message) => message.role === "tool");
      requests.push({ model: body.model, prompt, toolReply: toolReply?.content });
      console.log(`[acceptance provider] ${body.model}: ${prompt.slice(0, 100)}`);
      if (prompt.includes("E2E_PROVIDER_ERROR") && body.model !== "title") {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            error: {
              message: "Acceptance provider rejected this prompt",
              type: "invalid_request_error",
              code: "acceptance_rejection",
            },
          }),
        );
        return;
      }
      response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      const id = `chatcmpl-acceptance-${requests.length}`;
      const send = (delta, finish = null) =>
        response.write(
          `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
        );
      const finish = (reason = "stop") => {
        send({}, reason);
        response.end("data: [DONE]\n\n");
      };
      send({ role: "assistant", content: "" });
      if (body.model === "title") {
        send({ content: "Acceptance conversation" });
        finish();
        return;
      }
      if (prompt.includes("E2E_STOP")) {
        send({ content: "Acceptance stream is waiting for cancellation." });
        const keepAlive = setInterval(() => response.write(": waiting\n\n"), 1000);
        response.once("close", () => {
          clearInterval(keepAlive);
          cancelledStreams += 1;
        });
        return;
      }
      if (respondBrowser(prompt, toolReply, body, send, finish, requests.length)) return;
      if (respondQuestion(prompt, toolReply, body, send, finish, requests.length)) return;
      if (toolReply) {
        send({
          content: `Acceptance question resolved: ${JSON.stringify(toolReply.content)}`,
        });
        finish();
        return;
      }
      send({ content: "Acceptance first streamed fragment. " });
      const complete = setTimeout(() => {
        send({ content: `Acceptance completed with ${body.model}.` });
        finish();
      }, 1200);
      response.once("close", () => clearTimeout(complete));
    } catch (cause) {
      console.error("Acceptance provider failed", cause);
      response.destroy(cause instanceof Error ? cause : undefined);
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url,
    config: {
      model: "acceptance/stream",
      default_agent: "build",
      autoupdate: false,
      share: "disabled",
      warming: false,
      permissions: [{ action: "execute", resource: "*", effect: "allow" }],
      agents: {
        title: { model: "acceptance/title" },
        "acceptance-agent": {
          mode: "primary",
          description: "Local acceptance agent",
          model: "acceptance/alternate",
        },
      },
      providers: {
        acceptance: {
          name: "Acceptance local provider",
          package: "@opencode-ai/ai/providers/openai-compatible",
          settings: { baseURL: `${url}/v1`, apiKey: "local-acceptance-only" },
          models: {
            stream: model("Acceptance Stream"),
            alternate: model("Acceptance Alternate"),
            title: model("Acceptance Title"),
          },
        },
      },
    },
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

function serveBrowserFixture(request, response) {
  if (request.url === "/browser-test") {
    response.setHeader("Content-Type", "text/html");
    response.end(`<!doctype html><html lang="en"><head><title>Browser acceptance</title></head>
        <body><h1>Browser acceptance</h1><label>Name <input id="name"></label>
        <button onclick="document.querySelector('output').textContent='Hello '+document.querySelector('input').value">Greet</button>
        <output aria-live="polite"></output><label>Upload screenshot <input type="file" id="upload"></label></body></html>`);
    return true;
  }
  if (request.url === "/browser-data") {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ source: "connected-server" }));
    return true;
  }
  return false;
}

function respondBrowser(prompt, toolReply, body, send, finish, requestID) {
  if (!prompt.includes("E2E_BROWSER")) return false;
  if (toolReply) {
    send({ content: `Acceptance browser resolved: ${JSON.stringify(toolReply.content)}` });
    finish();
    return true;
  }
  {
    if (!body.tools?.some((tool) => tool.function?.name === "execute")) {
      throw new Error("Pinned OpenCode did not offer its execute tool");
    }
    const pageUrl = prompt.match(/https?:\/\/[^\s]+\/browser-test/)?.[0];
    if (!pageUrl) throw new Error("Browser acceptance URL missing");
    const code = `
          await tools.browser.tabs.open({url: ${JSON.stringify(pageUrl)}});
          const tabs = await tools.browser.tabs.list({});
          const tabID = tabs.focusedTabID;
          if (!tabID) throw new Error("No focused browser tab");
          const name = await tools.browser.find({tabID, text: "Name"});
          const ref = name.content.match(/@e[0-9]+/)[0];
          await tools.browser.fill({tabID, ref, text: "Ocui"});
          const button = await tools.browser.find({tabID, text: "Greet"});
          await tools.browser.click({tabID, ref: button.content.match(/@e[0-9]+/)[0]});
          const snapshot = await tools.browser.snapshot({tabID});
          if (!snapshot.content.includes("Hello Ocui")) throw new Error(snapshot.content);
          const data = await tools.browser.evaluate({tabID, script: "console.log('Browser acceptance log'); fetch('/browser-data').then(r=>r.json())"});
          const logs = await tools.browser.console({tabID});
          const requests = await tools.browser.network.list({tabID, urlContains: "/browser-data"});
          const network = await tools.browser.network.get({tabID, id: requests.requests.at(-1).id, includeBody: true});
          const screenshot = await tools.browser.screenshot({tabID, maxWidth: 320});
          const upload = await tools.browser.find({tabID, text: "Upload screenshot"});
          await tools.browser.files.upload({tabID, ref: upload.content.match(/@e[0-9]+/)[0], paths: [screenshot.files[0].path]});
          const uploaded = await tools.browser.evaluate({tabID, script: "document.querySelector('#upload').files[0].size"});
          const files = await tools.browser.files.list({tabID});
          const exported = await tools.browser.files.get({tabID, fileID: files.files.at(-1).id});
          await tools.browser.trace.start({tabID, durationMs: 5000});
          await tools.browser.cpu.start({tabID});
          await tools.browser.evaluate({tabID, script: "Array.from({length:10000},(_,i)=>Math.sqrt(i)).reduce((a,b)=>a+b,0)"});
          const cpu = await tools.browser.cpu.stop({tabID});
          const trace = await tools.browser.trace.stop({tabID});
          const cpuAnalysis = await tools.browser.cpu.analyze({tabID, fileID: cpu.files[0].id});
          const traceAnalysis = await tools.browser.trace.analyze({tabID, fileID: trace.files[0].id});
          const audit = await tools.browser.lighthouse({tabID});
          return {
            verified: "browser-roundtrip", data, screenshot, uploaded, exported,
            logs: { messages: logs.messages }, network: { responseBody: network.responseBody },
            cpuAnalysis: { durationMs: cpuAnalysis.durationMs },
            traceAnalysis: { metrics: traceAnalysis.metrics }, audit: { files: audit.files }
          };
        `;
    send({
      tool_calls: [
        {
          index: 0,
          id: `call-browser-${requestID}`,
          type: "function",
          function: { name: "execute", arguments: JSON.stringify({ code }) },
        },
      ],
    });
    finish("tool_calls");
    return true;
  }
}

function respondQuestion(prompt, toolReply, body, send, finish, requestID) {
  if (prompt.includes("E2E_QUESTION") && !toolReply) {
    if (!body.tools?.some((tool) => tool.function?.name === "question")) {
      throw new Error("Pinned OpenCode did not offer its question tool");
    }
    send({
      tool_calls: [
        {
          index: 0,
          id: `call-question-${requestID}`,
          type: "function",
          function: {
            name: "question",
            arguments: JSON.stringify({
              questions: [
                {
                  header: "Acceptance choice",
                  question: "Which acceptance option should continue?",
                  options: [
                    { label: "Alpha", description: "Continue with Alpha." },
                    { label: "Beta", description: "Continue with Beta." },
                  ],
                },
              ],
            }),
          },
        },
      ],
    });
    finish("tool_calls");
    return true;
  }
  return false;
}
