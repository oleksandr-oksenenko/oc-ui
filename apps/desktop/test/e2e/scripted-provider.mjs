import { createServer } from "node:http";
import { serveImageFixture } from "./image-tools-fixture.mjs";

const model = (name) => ({
  name,
  capabilities: { tools: true, input: ["text"], output: ["text"] },
  limit: { context: 32768, output: 2048 },
});

/**
 * The composer sends CommonMark, so a model reads backslash escapes as the
 * punctuation they escape; scenario matching works on that text.
 */
const markdownText = (value) => value.replace(/\\([!"#$%&'()*+,-./:;<=>?@[\\\]^_`{|}~])/gu, "$1");

const toolNames = (body) => body.tools?.map((tool) => tool.function?.name);

// The real pinned OpenCode server consumes this local OpenAI chat-completion endpoint.
// Scenarios are selected by the latest user turn, so transcript history cannot retrigger them.
export async function startScriptedProvider() {
  const requests = [];
  const held = new Set();
  const completeResponse = (prompt, response, complete) => {
    if (prompt.includes("E2E_QUEUE_HOLD")) {
      held.add(complete);
      response.once("close", () => held.delete(complete));
    } else if (prompt.includes("E2E_STREAM")) {
      const timer = setTimeout(() => complete(), 1200);
      response.once("close", () => clearTimeout(timer));
    } else complete();
  };
  let cancelledStreams = 0;
  const server = createServer(async (request, response) => {
    if (serveBrowserFixture(request, response)) return;
    if (await serveImageFixture(request, response, requests)) return;
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
      const content = messages[lastUser]?.content;
      const prompt = markdownText(
        Array.isArray(content) ? JSON.stringify(content) : (content ?? ""),
      );
      const afterUser = messages.slice(lastUser + 1);
      const toolReply = afterUser.find((message) => message.role === "tool");
      requests.push({
        model: body.model,
        prompt,
        toolReply: toolReply?.content,
        tools: toolNames(body),
      });
      console.log(`[acceptance provider] ${body.model}: ${prompt.slice(0, 100)}`);
      if (respondRetry(prompt, body.model, requests, response)) return;
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
      if (
        respondScriptedPrompt({
          modelName: body.model,
          prompt,
          response,
          send,
          finish,
          onCancel: () => {
            cancelledStreams += 1;
          },
        })
      )
        return;
      if (respondBrowser(prompt, toolReply, body, send, finish, requests.length)) return;
      if (
        respondTool(
          prompt,
          toolReply,
          body,
          send,
          finish,
          requests.length,
          response,
          completeResponse,
        )
      )
        return;
      send({ content: "Acceptance first streamed fragment. " });
      const complete = () => {
        send({ content: `Acceptance completed with ${body.model}.` });
        finish();
      };
      completeResponse(prompt, response, complete);
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
    releaseHeld: () => {
      for (const complete of held) complete();
      held.clear();
    },
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
          package: "@opencode/ai/providers/openai-compatible",
          settings: { baseURL: `${url}/v1`, apiKey: "local-acceptance-only" },
          models: {
            stream: { ...model("Acceptance Stream"), variants: [{ id: "high" }] },
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

function respondRetry(prompt, modelName, requests, response) {
  if (!prompt.includes("E2E_PROVIDER_RETRY") || modelName === "title") return false;
  if (requests.filter((item) => item.prompt === prompt && item.model !== "title").length !== 1)
    return false;
  response.writeHead(503, { "Content-Type": "application/json", "Retry-After": "5" });
  response.end(
    JSON.stringify({ error: { message: "Acceptance provider is temporarily unavailable" } }),
  );
  return true;
}

function respondScriptedPrompt({ modelName, prompt, response, send, finish, onCancel }) {
  if (modelName === "title") {
    send({
      content: prompt.includes("Independent acceptance task")
        ? "Independent acceptance task"
        : "Acceptance conversation",
    });
    finish();
    return true;
  }
  if (prompt.includes("E2E_STOP")) {
    send({ content: "Acceptance stream is waiting for cancellation." });
    const keepAlive = setInterval(() => response.write(": waiting\n\n"), 1000);
    response.once("close", () => {
      clearInterval(keepAlive);
      onCancel();
    });
    return true;
  }
  if (prompt.includes("E2E_SYNTAX")) {
    send({ content: "```ts\nconst answer = " });
    send({ content: "42;\n\nconsole.log(answer);\n```" });
    finish();
    return true;
  }
  if (prompt.includes("E2E_FILE_LINK")) {
    const target = prompt.match(/E2E_FILE_LINK ([^\s"\\]+)/u)?.[1];
    if (!target) throw new Error("File link target missing from prompt");
    send({ content: `[Download the file](<${decodeURIComponent(target)}>)` });
    finish();
    return true;
  }
  if (prompt.includes("E2E_FILE_IMAGE")) {
    const fileUrl = prompt.match(/file:\/\/[^\s"\\]+/u)?.[0];
    if (!fileUrl) throw new Error("File image URL missing from prompt");
    send({ content: `Here is the capture: ![Tool states](${fileUrl})` });
    finish();
    return true;
  }
  return false;
}

function toolSurfaceCall(prompt) {
  if (prompt.includes("E2E_TOOL_SURFACE")) {
    const denied = prompt.includes("denied");
    const url = prompt.match(/https?:\/\/[^\s]+\/browser-data/u)?.[0];
    return {
      name: "execute",
      input: {
        code: denied
          ? `const catalog = search({query: "grep", limit: 100});
             if (catalog.items.some(item => item.path === "tools.grep")) throw new Error("Denied grep is discoverable");
             try { await tools.grep({pattern: "working", include: "working.txt"}); }
             catch { return {denied: true}; }
             throw new Error("Denied grep executed");`
          : `const catalog = search({limit: 100});
             const paths = catalog.items.map(item => item.path);
             for (const name of ["glob", "grep", "webfetch", "websearch", "question", "skill", "subagent", "session.create"])
               if (!paths.includes("tools." + name)) throw new Error("Missing Code Mode tool: " + name);
             const files = await tools.glob({pattern: "working.txt"});
             const matches = await tools.grep({pattern: "working content", include: "working.txt"});
             const page = await tools.webfetch({url: ${JSON.stringify(url)}, format: "text"});
             const skill = await tools.skill({id: "review"});
             return {paths, files, matches, page, skill};`,
      },
    };
  }
  return undefined;
}

function sessionToolCall(prompt) {
  if (prompt.includes("E2E_SESSION_NATIVE ")) {
    const sessionID = prompt.split("E2E_SESSION_NATIVE ")[1].trim();
    return {
      name: "execute",
      input: {
        code: `
      const target = await tools.session.get({sessionID: ${JSON.stringify(sessionID)}});
      const admission = await tools.session.send({sessionID: target.id, text: "Packaged follow up"});
      const settled = await tools.session.wait({sessionID: target.id, timeoutSeconds: 10});
      const interrupted = await tools.session.interrupt({sessionID: target.id});
      const deleted = await tools.session.delete({sessionID: target.id});
      return {verified: "native-session-management", admission, settled, interrupted, deleted};
    `,
      },
    };
  }
  if (prompt.includes("E2E_MANAGED_CHILD"))
    return {
      name: "execute",
      input: {
        code: 'return await tools.subagent({agent: "explore", description: "Managed child fixture", prompt: "Managed child fixture"});',
      },
    };
  if (prompt.includes("E2E_SESSION_MANAGEMENT ")) {
    const targets = JSON.parse(prompt.split("E2E_SESSION_MANAGEMENT ")[1]);
    return {
      name: "execute",
      input: {
        code: `const catalog = search({namespace: "session", limit: 100});
          for (const name of ["create", "list", "messages", "get", "send", "wait", "interrupt", "delete", "rename", "move"])
            if (!catalog.items.some(item => item.path === "tools.session." + name)) throw new Error("Missing " + name);
          const caller = await tools.session.get({});
          const rejected = [];
          for (const name of ["wait", "interrupt", "delete"]) {
            try { await tools.session[name]({sessionID: caller.id}); }
            catch (error) { rejected.push(name); }
          }
          const target = await tools.session.get({sessionID: ${JSON.stringify(targets.targetID)}});
          const blocked = await tools.session.wait({sessionID: target.id, timeoutSeconds: 1});
          const admitted = await tools.session.send({sessionID: target.id, text: "Managed queued follow up"});
          const retried = await tools.session.send({sessionID: target.id, text: "Retry must not replace the original", messageID: admitted.messageID, delivery: "steer"});
          const interrupted = await tools.session.interrupt({sessionID: target.id});
          const settled = await tools.session.wait({sessionID: target.id, timeoutSeconds: 10});
          const completedAdmission = await tools.session.send({sessionID: ${JSON.stringify(targets.idleID)}, text: "Managed completed follow up", delivery: "steer"});
          const completed = await tools.session.wait({sessionID: completedAdmission.sessionID, timeoutSeconds: 10});
          const completedRetry = await tools.session.send({sessionID: completedAdmission.sessionID, messageID: completedAdmission.messageID, text: "Delivered retry must not replace the original", delivery: "queue"});
          const deleted = await tools.session.delete({sessionID: ${JSON.stringify(targets.deleteID)}});
          let failedAdmission;
          try { await tools.session.send({sessionID: deleted.sessionID, text: "Cannot admit to a deleted session"}); }
          catch (error) { failedAdmission = error.message; }
          return {caller, target, blocked, admitted, retried, interrupted, settled, completedAdmission, completedRetry, completed, deleted, rejected, failedAdmission};`,
      },
    };
  }
  if (prompt.includes("E2E_SESSION_READS")) {
    return {
      name: "execute",
      input: {
        code: `const catalog = search({ namespace: "session", limit: 100 });
          for (const name of ["create", "list", "messages", "rename", "move"])
            if (!catalog.items.some(item => item.path === "tools.session." + name))
              throw new Error("Session tool missing from catalog: " + name);
          const first = await tools.session.list({ search: "Session read fixture", limit: 1, order: "asc" });
          const second = await tools.session.list({ cursor: first.cursor.next, limit: 1 });
          const messages = await tools.session.messages({ sessionID: first.data[0].id, limit: 1, order: "asc" });
          const nextMessages = await tools.session.messages({ sessionID: first.data[0].id, cursor: messages.cursor.next, limit: 1 });
          return { listedIDs: [first.data[0].id, second.data[0].id],
            messages: [...messages.data, ...nextMessages.data],
            timestampsAreNumbers: typeof first.data[0].time.updated === "number" };`,
      },
    };
  }
  return undefined;
}

function requestedTool(prompt) {
  const surface = toolSurfaceCall(prompt) ?? sessionToolCall(prompt);
  if (surface) return surface;
  if (prompt.includes("E2E_IMAGE")) {
    if (prompt.includes("permission"))
      return {
        name: "execute",
        input: {
          code: 'return await tools.image_generate({prompt: "An authorized otter", outputPath: "authorized/otter.png"});',
        },
      };
    if (prompt.includes("external"))
      return {
        name: "execute",
        input: {
          code: `return await tools.image_generate({prompt: "An external reference", outputPath: "external-edit.png", referencePaths: [${JSON.stringify(prompt.split("E2E_IMAGE external ")[1])}]});`,
        },
      };
    if (prompt.includes("read"))
      return {
        name: "execute",
        input: {
          code: 'return await tools.image_generate({prompt: "An internal reference", outputPath: "read-edit.png", referencePaths: ["acceptance-generated.png"]});',
        },
      };
    if (prompt.includes("url"))
      return {
        name: "execute",
        input: {
          code: 'await tools.image_generate({prompt: "URL-only response"}); throw new Error("Unreachable after URL-only failure");',
        },
      };
    if (prompt.includes("collision"))
      return {
        name: "execute",
        input: {
          code: 'return await tools.image_generate({prompt: "Concurrent destination", outputPath: "acceptance-collision.png"});',
        },
      };
    if (prompt.includes("error"))
      return {
        name: "execute",
        input: {
          code: 'await tools.image_generate({prompt: "An otter before a JavaScript error"}); throw new Error("Intentional post-image failure");',
        },
      };
    if (prompt.includes("batch"))
      return {
        name: "execute",
        input: {
          code: 'return await Promise.all([tools.image_generate({prompt: "First acceptance otter", outputPath: "first/otter.png"}), tools.image_generate({prompt: "Second acceptance otter", outputPath: "second/otter.png"})]);',
        },
      };
    const input = { prompt: "An acceptance otter", outputPath: "acceptance-generated.png" };
    if (prompt.includes("edit")) {
      input.outputPath = "acceptance-edited.png";
      input.referencePaths = ["acceptance-generated.png"];
    }
    return {
      name: "execute",
      input: { code: `return await tools.image_generate(${JSON.stringify(input)});` },
    };
  }
  if (prompt.includes("E2E_BACKGROUND_PROCESS")) {
    return {
      name: "shell",
      input: { command: "printf 'Background acceptance output\\n'", background: true },
    };
  }
  if (prompt.includes("E2E_TOOL_SCROLL")) {
    const path = prompt.match(/E2E_TOOL_SCROLL ([^\s"\\]+)/u)?.[1];
    if (!path) throw new Error("Tool scroll fixture path missing");
    return { name: "read", input: { path } };
  }
  if (prompt.includes("E2E_CREATE_SESSION")) {
    return { name: "session.create", input: { prompt: "Independent acceptance task" } };
  }
  if (prompt.includes("E2E_SUBAGENT_BUBBLE")) {
    return {
      name: "subagent",
      input: {
        agent: "explore",
        description: "Bubble probe",
        prompt: "E2E_BUBBLE_CHILD",
      },
    };
  }
  if (prompt.includes("E2E_BUBBLE_CHILD")) {
    return { name: "read", input: { path: "/acceptance-external/bubble.txt" } };
  }
  if (prompt.includes("E2E_QUESTION")) {
    return {
      name: "question",
      input: {
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
      },
    };
  }
  return undefined;
}

function toolCall(tools, requested, index) {
  if (!tools?.some((tool) => tool.function?.name === requested.name)) {
    throw new Error(`Pinned OpenCode did not offer ${requested.name}`);
  }
  return {
    tool_calls: [
      {
        index: 0,
        id: `call-${requested.name}-${index}`,
        type: "function",
        function: { name: requested.name, arguments: JSON.stringify(requested.input) },
      },
    ],
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

function respondTool(prompt, toolReply, body, send, finish, requestID, response, completeResponse) {
  if (toolReply && prompt.includes("E2E_TOOL_SCROLL")) {
    send({ content: "Acceptance tool scroll stream is waiting." });
    completeResponse(prompt, response, () => {
      send({
        content: `\n\n${"Appended transcript paragraph.\n\n".repeat(40)}Tool scroll complete.`,
      });
      finish();
    });
    return true;
  }
  const requested = requestedTool(prompt);
  if (requested && !toolReply) {
    if (
      prompt.includes("E2E_IMAGE") &&
      body.tools?.some((tool) => tool.function?.name === "image_generate")
    )
      throw new Error("Image generation must only be offered through Code Mode");
    const direct = ["read", "shell", "execute"].includes(requested.name);
    if (!direct && body.tools?.some((tool) => tool.function?.name === requested.name))
      throw new Error(`${requested.name} must only be offered through Code Mode`);
    send(
      toolCall(
        body.tools,
        direct
          ? requested
          : {
              name: "execute",
              input: {
                code: `return await tools.${requested.name}(${JSON.stringify(requested.input)});`,
              },
            },
        requestID,
      ),
    );
    finish("tool_calls");
    return true;
  }
  if (toolReply) {
    send({ content: toolReplyText(prompt, toolReply.content) });
    finish();
    return true;
  }
  return false;
}

function toolReplyText(prompt, content) {
  const label = prompt.includes("E2E_TOOL_SURFACE")
    ? "Acceptance tool surface resolved"
    : prompt.includes("E2E_BACKGROUND_PROCESS")
      ? "Acceptance background process started"
      : prompt.includes("E2E_IMAGE")
        ? `Acceptance image ${prompt.match(/E2E_IMAGE\s+(\w+)/)?.[1] ?? "generate"} completed`
        : prompt.includes("E2E_CREATE_SESSION")
          ? "Acceptance session created"
          : prompt.includes("E2E_SUBAGENT_BUBBLE")
            ? "Acceptance bubbling verified"
            : "Acceptance question resolved";
  let images = "";
  if (prompt.includes("E2E_IMAGE") && !prompt.includes("edit")) {
    try {
      // The text-only fixture model receives a capability note after the JSON.
      const output = JSON.parse(content.split("\nERROR: Cannot read ")[0]);
      images = (Array.isArray(output) ? output : [output])
        .filter((result) => result.attachment)
        .map((result, index) => `![Acceptance generated image ${index + 1}](${result.attachment})`)
        .join("\n\n");
    } catch {
      // A post-generation Code Mode error deliberately exercises visible fallback.
    }
  }
  return images
    ? `${label}\n\n${images}\n\nImage shown inline.`
    : `${label}: ${JSON.stringify(content)}`;
}
