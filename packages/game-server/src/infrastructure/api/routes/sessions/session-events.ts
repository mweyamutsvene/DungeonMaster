/**
 * Session Events Routes
 *
 * Handles event streaming (SSE) and event retrieval.
 *
 * Endpoints:
 * - GET /sessions/:id/events - SSE stream for real-time events
 * - GET /sessions/:id/events-json - JSON endpoint for events (testing)
 */

import type { FastifyInstance } from "fastify";
import type { SessionRouteDeps } from "./types.js";

export function registerSessionEventsRoutes(app: FastifyInstance, deps: SessionRouteDeps): void {
  /**
   * GET /sessions/:id/events
   * Server-Sent Events (SSE) stream for real-time game events.
   */
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    "/sessions/:id/events",
    async (req, reply) => {
      const sessionId = req.params.id;

      // SSE headers
      reply.raw.setHeader("Content-Type", "text/event-stream");
      reply.raw.setHeader("Cache-Control", "no-cache");
      reply.raw.setHeader("Connection", "keep-alive");
      reply.raw.setHeader("X-Accel-Buffering", "no");
      reply.raw.setHeader("Access-Control-Allow-Origin", "*");

      if (typeof reply.raw.flushHeaders === "function") {
        reply.raw.flushHeaders();
      }

      reply.raw.write(": connected\n\n");

      const limit = req.query.limit ? Number(req.query.limit) : 50;
      const backlog = await deps.events.listBySession(sessionId, { limit });
      for (const ev of backlog) {
        const payload = JSON.stringify({ type: ev.type, payload: ev.payload, createdAt: ev.createdAt });
        reply.raw.write(`event: ${ev.type}\n`);
        reply.raw.write(`data: ${payload}\n\n`);
      }

      const heartbeat = setInterval(() => {
        try {
          reply.raw.write(": ping\n\n");
        } catch {
          // ignore
        }
      }, 15000);

      const unsubscribe = app.sseBroker.subscribe(sessionId, (event) => {
        const payload = JSON.stringify(event);
        reply.raw.write(`event: ${event.type}\n`);
        reply.raw.write(`data: ${payload}\n\n`);
      });

      req.raw.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
      });

      return reply;
    },
  );

  /**
   * GET /sessions/:id/events-json
   * JSON endpoint for retrieving events (useful for testing).
   */
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    "/sessions/:id/events-json",
    async (req) => {
      const sessionId = req.params.id;
      const limit = req.query.limit ? Number(req.query.limit) : 50;
      return deps.events.listBySession(sessionId, { limit });
    },
  );
}
