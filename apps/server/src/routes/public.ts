import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { HttpError } from "../lib/http.js";
import { runWorkflow, tickSchedules, triggerOf, type WorkflowRow } from "../lib/workflows.js";

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/** Unauthenticated endpoints: workflow webhooks (token in the URL) and the scheduler tick (CRON_SECRET). */
export const publicRoutes: FastifyPluginAsync = async (app) => {
  const { db, config } = app.deps;

  app.post("/hooks/:id/:token", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) => {
    const { id, token } = req.params as { id: string; token: string };
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "Not found");
    const w = await db.one<WorkflowRow & { webhook_token: string }>(`SELECT id, workspace_id, name, graph, enabled, environment, updated_at, webhook_token FROM workflows WHERE id = $1`, [id]);
    if (!w || !safeEqual(w.webhook_token, token)) throw new HttpError(404, "Not found");
    if (!w.enabled || triggerOf(w.graph)?.config?.mode !== "webhook") throw new HttpError(409, "This workflow isn't enabled for webhooks");
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => /^(content-type|user-agent|x-[\w-]+)$/i.test(k) && !/signature|token|auth/i.test(k)).map(([k, v]) => [k, String(v)]));
    const run = await runWorkflow(app.deps, w, { kind: "webhook", body: req.body ?? null, query: req.query as Record<string, unknown>, headers });
    return { ok: run?.status === "succeeded", runId: run?.id, status: run?.status };
  });

  const tick = async (req: { headers: Record<string, unknown>; query: unknown }) => {
    const auth = String(req.headers.authorization ?? "");
    const key = auth.startsWith("Bearer ") ? auth.slice(7) : String((req.query as { key?: string }).key ?? "");
    if (!config.cronSecret || !safeEqual(key, config.cronSecret)) throw new HttpError(401, "Invalid or missing CRON_SECRET");
    return { ok: true, ran: await tickSchedules(app.deps) };
  };
  app.get("/cron/tick", tick);
  app.post("/cron/tick", tick);
};
