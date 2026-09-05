import { spawn, execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { createServer } from "node:https";
import { request } from "node:http";

const execute = promisify(execFile);
const require = createRequire(import.meta.url);

export async function testCertificate(directory) {
  const key = join(directory, "test.key");
  const cert = join(directory, "test.crt");
  await execute("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-keyout",
    key,
    "-out",
    cert,
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ]);
  return { key: await readFile(key), cert: await readFile(cert) };
}

export async function startServer(profile, project, corsOrigin) {
  const password = "browser-acceptance-only";
  const child = spawn(
    require.resolve("@opencode-ai/cli/bin/opencode2.exe"),
    ["serve", "--hostname", "127.0.0.1", "--port", "0", "--cors", corsOrigin],
    {
      cwd: project,
      env: { ...profile.env, OPENCODE_SERVER_PASSWORD: password },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const exited = new Promise((resolve) => {
    child.once("exit", resolve);
    child.once("error", resolve);
  });
  const close = async () => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    const force = setTimeout(() => child.kill("SIGKILL"), 10_000);
    try {
      await exited;
    } finally {
      clearTimeout(force);
    }
  };
  let output = "";
  const url = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Server startup timed out: ${output}`));
    }, 30_000);
    const fail = (error) => {
      clearTimeout(timeout);
      reject(error);
    };
    child.once("error", fail);
    child.once("exit", (code) => fail(new Error(`Server exited ${code}: ${output}`)));
    const read = (chunk) => {
      output += chunk.toString();
      const match = /http:\/\/127\.0\.0\.1:(\d+)/u.exec(output);
      if (match) {
        clearTimeout(timeout);
        resolve(match[0]);
      }
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
  }).catch(async (error) => {
    await close();
    throw error;
  });
  const headers = {
    Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
  };
  return {
    url,
    password,
    headers,
    health: () => fetch(`${url}/api/health`, { headers }).then((response) => response.json()),
    close,
  };
}

// TLS terminates only in this test fixture; production browser security is unchanged.
export async function startTlsProxy(tls, upstream) {
  let unavailable = false;
  const connections = new Set();
  const server = createServer(tls, (incoming, outgoing) => {
    if (unavailable) {
      outgoing.destroy();
      return;
    }
    const forwarded = request(
      new URL(incoming.url, upstream),
      {
        method: incoming.method,
        headers: incoming.headers,
      },
      (response) => {
        outgoing.writeHead(response.statusCode, response.headers);
        response.pipe(outgoing);
      },
    );
    forwarded.on("error", () => outgoing.destroy());
    outgoing.on("close", () => forwarded.destroy());
    incoming.pipe(forwarded);
  });
  server.on("connection", (socket) => {
    connections.add(socket);
    socket.once("close", () => connections.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `https://127.0.0.1:${server.address().port}`,
    disconnect: () => {
      unavailable = true;
      for (const socket of connections) socket.destroy();
    },
    reconnect: () => {
      unavailable = false;
    },
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  };
}
