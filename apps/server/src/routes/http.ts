import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ENVIRONMENTS } from "@mfc/core";
import { parse, requirePerm, notFound, HttpError } from "../lib/http.js";
import { audit } from "../lib/audit.js";
import { BlockedError, guardedFetch } from "../lib/netGuard.js";
import { renderRecord, renderString } from "../lib/templating.js";
import { secretResolver } from "../lib/secretResolver.js";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
const RequestBody = z.object({
  method: z.enum(METHODS),
  url: z.string().min(1).max(4000),
  headers: z.record(z.string(), z.string()).default({}),
  body: z.string().max(1024 * 1024).default(""),
  environment: z.enum(ENVIRONMENTS).default("development"),
  /** false = send the text exactly as given, never filling in {{ secrets.NAME }} (used for plugins). */
  templating: z.boolean().default(true),
});
const SavedBody = RequestBody.extend({ name: z.string().trim().min(1).max(120) });

export const httpRoutes: FastifyPluginAsync = async (app) => {
  const { db, ring, config } = app.deps;

  /** Proxy one request (avoids browser CORS limits) with {{ secrets.NAME }} substitution and SSRF protection. */
  app.post("/send", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) => {
    const a = requirePerm(req, "http.send");
    const body = parse(RequestBody, req.body);
    const secrets = secretResolver(db, ring, a.workspaceId, body.environment);
    let url: string, headers: Record<string, string>, payload: string;
    try {
      if (body.templating) {
        url = await renderString(body.url, {}, secrets.resolve);
        headers = await renderRecord(body.headers, {}, secrets.resolve);
        payload = await renderString(body.body, {}, secrets.resolve);
      } else {
        ({ url, headers, body: payload } = body);
      }
    } catch (e) {
      throw new HttpError(400, (e as Error).message, "template");
    }
    try {
      const res = await guardedFetch(url, { method: body.method, headers, body: payload || undefined }, { allowPrivate: config.allowPrivateNetwork, timeoutMs: 30_000 });
      const text = res.body.toString("utf8");
      await audit(db, req, "http.send", { meta: { method: body.method, host: new URL(res.url).host, status: res.status, secrets: [...secrets.used] } });
      return {
        status: res.status,
        statusText: res.statusText,
        headers: Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k, secrets.redact(v)])),
        body: secrets.redact(text),
        size: res.body.length,
        truncated: res.truncated,
        ms: res.ms,
        url: secrets.redact(res.url),
        redirects: res.redirects,
      };
    } catch (e) {
      if (e instanceof BlockedError) throw new HttpError(400, `${e.message}. Self-hosted admins can allow internal addresses with ALLOW_PRIVATE_NETWORK=1.`, "blocked_address");
      throw new HttpError(502, secrets.redact((e as Error).message), "upstream");
    }
  });

  app.get("/requests", async (req) => {
    const a = requirePerm(req, "projects.read");
    return { requests: await db.query(`SELECT id, name, method, url, headers, body, environment, updated_at FROM saved_requests WHERE workspace_id = $1 ORDER BY name`, [a.workspaceId]) };
  });

  app.post("/requests", async (req) => {
    const a = requirePerm(req, "http.send");
    const b = parse(SavedBody, req.body);
    const id = crypto.randomUUID();
    await db.query(`INSERT INTO saved_requests (id, workspace_id, name, method, url, headers, body, environment, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [id, a.workspaceId, b.name, b.method, b.url, JSON.stringify(b.headers), b.body, b.environment, req.user!.id]);
    return { id };
  });

  app.put("/requests/:id", async (req) => {
    const a = requirePerm(req, "http.send");
    const { id } = req.params as { id: string };
    const b = parse(SavedBody, req.body);
    const row = await db.one(`UPDATE saved_requests SET name=$3, method=$4, url=$5, headers=$6, body=$7, environment=$8, updated_at=now() WHERE id=$1 AND workspace_id=$2 RETURNING id`, [id, a.workspaceId, b.name, b.method, b.url, JSON.stringify(b.headers), b.body, b.environment]);
    if (!row) throw notFound("Request not found");
    return { ok: true };
  });

  app.delete("/requests/:id", async (req) => {
    const a = requirePerm(req, "http.send");
    const { id } = req.params as { id: string };
    const row = await db.one(`DELETE FROM saved_requests WHERE id=$1 AND workspace_id=$2 RETURNING id`, [id, a.workspaceId]);
    if (!row) throw notFound("Request not found");
    return { ok: true };
  });
};
