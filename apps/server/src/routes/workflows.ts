import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ENVIRONMENTS } from "@mfc/core";
import { parse, requirePerm, notFound, badRequest } from "../lib/http.js";
import { audit } from "../lib/audit.js";
import { runWorkflow, triggerOf, validateGraph, type WfGraph, type WorkflowRow } from "../lib/workflows.js";
import { nextOccurrence } from "../lib/cron.js";

const Graph = z.object({ nodes: z.array(z.object({ id: z.string().min(1).max(64), type: z.string(), name: z.string().max(80), config: z.record(z.string(), z.unknown()).default({}), next: z.string().nullable().optional(), onTrue: z.string().nullable().optional(), onFalse: z.string().nullable().optional(), x: z.number().optional(), y: z.number().optional() })).max(100) });
const Body = z.object({ name: z.string().trim().min(1).max(120), graph: Graph, enabled: z.boolean().default(false), environment: z.enum(ENVIRONMENTS).default("production") });

const starter: WfGraph = {
  nodes: [
    { id: "trigger", type: "trigger", name: "trigger", config: { mode: "manual" }, next: "log", x: 40, y: 60 },
    { id: "log", type: "log", name: "log", config: { message: "Workflow started at {{ now }}" }, next: null, x: 320, y: 60 },
  ],
};

export const workflowRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app.deps;
  const cols = `id, workspace_id, name, graph, enabled, environment, webhook_token, created_at, updated_at`;
  const describe = (w: WorkflowRow & { webhook_token: string }) => {
    const trig = triggerOf(w.graph);
    const cron = trig?.config?.mode === "schedule" ? String(trig.config.cron ?? "") : null;
    let next: string | null = null;
    try {
      next = cron && w.enabled ? nextOccurrence(cron, new Date())?.toISOString() ?? null : null;
    } catch {
      next = null;
    }
    return { ...w, trigger: trig?.config?.mode ?? "manual", webhookPath: `/api/hooks/${w.id}/${w.webhook_token}`, nextRun: next };
  };

  app.get("/", async (req) => {
    const a = requirePerm(req, "projects.read");
    const rows = await db.query<WorkflowRow & { webhook_token: string }>(`SELECT ${cols} FROM workflows WHERE workspace_id = $1 ORDER BY updated_at DESC`, [a.workspaceId]);
    const last = await db.query<{ workflow_id: string; status: string; started_at: string }>(`SELECT DISTINCT ON (workflow_id) workflow_id, status, started_at FROM workflow_runs WHERE workspace_id = $1 ORDER BY workflow_id, started_at DESC`, [a.workspaceId]);
    return { workflows: rows.map((w) => ({ ...describe(w), lastRun: last.find((l) => l.workflow_id === w.id) ?? null })) };
  });

  app.post("/", async (req) => {
    const a = requirePerm(req, "workflows.manage");
    const b = parse(Body.partial({ graph: true }), req.body);
    const graph = (b.graph as WfGraph | undefined) ?? starter;
    const id = crypto.randomUUID();
    await db.query(`INSERT INTO workflows (id, workspace_id, name, graph, enabled, environment, webhook_token, created_by) VALUES ($1,$2,$3,$4,false,$5,$6,$7)`, [id, a.workspaceId, b.name, JSON.stringify(graph), b.environment, crypto.randomBytes(24).toString("base64url"), req.user!.id]);
    await audit(db, req, "workflow.create", { targetType: "workflow", targetId: id, meta: { name: b.name } });
    return { id };
  });

  app.get("/:id", async (req) => {
    const a = requirePerm(req, "projects.read");
    const { id } = req.params as { id: string };
    const w = await db.one<WorkflowRow & { webhook_token: string }>(`SELECT ${cols} FROM workflows WHERE id = $1 AND workspace_id = $2`, [id, a.workspaceId]);
    if (!w) throw notFound("Workflow not found");
    return { workflow: describe(w), problems: validateGraph(w.graph) };
  });

  app.put("/:id", async (req) => {
    const a = requirePerm(req, "workflows.manage");
    const { id } = req.params as { id: string };
    const b = parse(Body, req.body);
    const problems = validateGraph(b.graph as WfGraph);
    if (b.enabled && problems.length) throw badRequest(`Fix these before enabling: ${problems.join("; ")}`);
    const row = await db.one(`UPDATE workflows SET name=$3, graph=$4, enabled=$5, environment=$6, updated_at=now() WHERE id=$1 AND workspace_id=$2 RETURNING id`, [id, a.workspaceId, b.name, JSON.stringify(b.graph), b.enabled, b.environment]);
    if (!row) throw notFound("Workflow not found");
    await audit(db, req, "workflow.update", { targetType: "workflow", targetId: id, meta: { name: b.name, enabled: b.enabled } });
    return { ok: true, problems };
  });

  app.post("/:id/rotate-webhook", async (req) => {
    const a = requirePerm(req, "workflows.manage");
    const { id } = req.params as { id: string };
    const token = crypto.randomBytes(24).toString("base64url");
    const row = await db.one(`UPDATE workflows SET webhook_token=$3 WHERE id=$1 AND workspace_id=$2 RETURNING id`, [id, a.workspaceId, token]);
    if (!row) throw notFound("Workflow not found");
    await audit(db, req, "workflow.webhook.rotate", { targetType: "workflow", targetId: id });
    return { webhookPath: `/api/hooks/${id}/${token}` };
  });

  app.delete("/:id", async (req) => {
    const a = requirePerm(req, "workflows.manage");
    const { id } = req.params as { id: string };
    const row = await db.one(`DELETE FROM workflows WHERE id=$1 AND workspace_id=$2 RETURNING name`, [id, a.workspaceId]);
    if (!row) throw notFound("Workflow not found");
    await audit(db, req, "workflow.delete", { targetType: "workflow", targetId: id });
    return { ok: true };
  });

  app.post("/:id/run", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const a = requirePerm(req, "workflows.manage");
    const { id } = req.params as { id: string };
    const { input } = parse(z.object({ input: z.unknown().optional() }), req.body ?? {});
    const w = await db.one<WorkflowRow>(`SELECT ${cols} FROM workflows WHERE id = $1 AND workspace_id = $2`, [id, a.workspaceId]);
    if (!w) throw notFound("Workflow not found");
    const run = await runWorkflow(app.deps, w, { kind: "manual", body: input ?? null });
    await audit(db, req, "workflow.run", { targetType: "workflow", targetId: id, meta: { status: run?.status } });
    return { run };
  });

  app.get("/:id/runs", async (req) => {
    const a = requirePerm(req, "projects.read");
    const { id } = req.params as { id: string };
    return { runs: await db.query(`SELECT id, trigger, scheduled_for, status, log, error, started_at, finished_at FROM workflow_runs WHERE workflow_id = $1 AND workspace_id = $2 ORDER BY started_at DESC LIMIT 50`, [id, a.workspaceId]) };
  });
};
