/**
 * Agent Control Server
 *
 * Starts a tiny HTTP server alongside the CLI so an external agent (e.g. Copilot)
 * can drive the session without needing stdin piping or a secondary process.
 *
 * Endpoints:
 *   GET  /status        → { running: true }
 *   GET  /output        → { output: "<text since last poll>" }
 *   POST /input         → { text: "..." }  injects a line into the CLI readline
 *
 * Usage:
 *   pnpm -C packages/player-cli start -- --scenario solo-fighter --control-port 3002
 *
 * Then from another terminal (or agent tool calls):
 *   Invoke-WebRequest http://127.0.0.1:3002/output -UseBasicParsing
 *   Invoke-WebRequest http://127.0.0.1:3002/input -Method POST `
 *     -ContentType "application/json" -Body '{"text":"15"}' -UseBasicParsing
 */

import * as http from "node:http";
import { PassThrough } from "node:stream";

// Strip ANSI escape codes so the agent reads clean text.
const ANSI_RE = /\x1B(?:\[[0-9;]*[mGKHFJA]|\][^\x07]*\x07)/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

export interface AgentControl {
  /** Use this as the `input` for readline.createInterface(). */
  stream: PassThrough;
  close(): void;
}

export function startAgentControl(port: number): AgentControl {
  const stream = new PassThrough();
  const outputChunks: string[] = [];
  const sseClients = new Set<http.ServerResponse>();

  // Intercept stdout so we can buffer and stream everything the CLI prints.
  const origWrite = process.stdout.write.bind(process.stdout) as typeof process.stdout.write;
  // @ts-ignore — patching write for agent output capture
  process.stdout.write = (chunk: string | Uint8Array, encodingOrCb?: unknown, cb?: unknown) => {
    const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    const clean = stripAnsi(text);
    // Buffer for /output polling
    outputChunks.push(clean);
    // Push immediately to all SSE subscribers
    if (sseClients.size > 0) {
      const event = `data: ${JSON.stringify({ text: clean })}\n\n`;
      for (const client of sseClients) {
        try { client.write(event); } catch { sseClients.delete(client); }
      }
    }
    // Always call original so the terminal still shows output live.
    if (typeof encodingOrCb === "function") {
      return origWrite(chunk, encodingOrCb as () => void);
    } else if (typeof encodingOrCb === "string" && typeof cb === "function") {
      return origWrite(chunk, encodingOrCb as BufferEncoding, cb as () => void);
    }
    return origWrite(chunk);
  };

  const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");

    if (req.method === "GET" && req.url === "/status") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ running: true }));

    } else if (req.method === "GET" && req.url === "/output") {
      // One-shot drain of buffered output since last poll.
      res.setHeader("Content-Type", "application/json");
      const output = outputChunks.splice(0).join("");
      res.end(JSON.stringify({ output }));

    } else if (req.method === "GET" && req.url === "/stream") {
      // SSE stream — pushes output chunks immediately as the CLI writes them.
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });
      res.write("retry: 500\n\n");
      // Flush any buffered output to the new subscriber immediately.
      if (outputChunks.length > 0) {
        const buffered = outputChunks.splice(0).join("");
        res.write(`data: ${JSON.stringify({ text: buffered })}\n\n`);
      }
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));

    } else if (req.method === "POST" && req.url === "/input") {
      res.setHeader("Content-Type", "application/json");
      let body = "";
      req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      req.on("end", () => {
        try {
          const { text } = JSON.parse(body) as { text: string };
          if (typeof text !== "string") throw new Error("text must be a string");
          stream.write(text + "\n");
          res.end(JSON.stringify({ ok: true, sent: text }));
        } catch (e) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : "Bad request" }));
        }
      });

    } else {
      res.setHeader("Content-Type", "application/json");
      res.writeHead(404);
      res.end(JSON.stringify({
        error: "Not found",
        available: ["GET /status", "GET /output", "GET /stream (SSE)", "POST /input"],
      }));
    }
  });

  server.listen(port, "127.0.0.1", () => {
    process.stderr.write(`[agent-control] HTTP control server on http://127.0.0.1:${port}\n`);
    process.stderr.write(`[agent-control]   GET  /stream  — SSE stream of CLI output (recommended)\n`);
    process.stderr.write(`[agent-control]   GET  /output  — poll/drain buffered output\n`);
    process.stderr.write(`[agent-control]   POST /input   — send { "text": "..." }\n`);
  });

  return {
    stream,
    close() {
      for (const client of sseClients) { try { client.end(); } catch { /* ignore */ } }
      sseClients.clear();
      process.stdout.write = origWrite;
      server.close();
      stream.end();
    },
  };
}
