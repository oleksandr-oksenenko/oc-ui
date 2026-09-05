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
      if (prompt.includes("E2E_QUESTION") && !toolReply) {
        if (!body.tools?.some((tool) => tool.function?.name === "question")) {
          throw new Error("Pinned OpenCode did not offer its question tool");
        }
        send({
          tool_calls: [
            {
              index: 0,
              id: `call-question-${requests.length}`,
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
        return;
      }
      if (toolReply) {
        send({ content: `Acceptance question resolved: ${JSON.stringify(toolReply.content)}` });
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
