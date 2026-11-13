import type { IncomingMessage, ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

/**
 * Vercel serverless entry. The Fastify app is built once per function instance and reused
 * across invocations; requests are handed to Fastify's internal HTTP handler.
 */
let ready: Promise<FastifyInstance> | null = null;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    ready ??= buildApp(loadConfig({ webDist: undefined })).then(async (app) => {
      await app.ready();
      return app;
    });
    const app = await ready;
    app.server.emit("request", req, res);
  } catch (err) {
    ready = null; // retry initialisation on the next request (e.g. after fixing env vars)
    console.error(err);
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: `Server is not configured correctly: ${(err as Error).message}`, code: "server_config" }));
  }
}
