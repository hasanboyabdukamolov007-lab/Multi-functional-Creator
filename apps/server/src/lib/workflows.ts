import crypto from "node:crypto";
import type { Db } from "../db.js";
import type { Config } from "../config.js";
import type { Mailer } from "./mailer.js";
import type { MasterKeyRing } from "./vaultCrypto.js";
import { decodeBody, guardedFetch } from "./netGuard.js";
import { renderRecord, renderString, renderValue } from "./templating.js";
import { secretResolver } from "./secretResolver.js";
import { lastOccurrence, parseCron } from "./cron.js";

export const NODE_TYPES = ["trigger", "http", "condition", "set", "delay", "email", "log", "transform"] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export interface WfNode {
  id: string;
  type: NodeType;
  name: string;
  config: Record<string, unknown>;
  next?: string | null;
  onTrue?: string | null;
  onFalse?: string | null;
  x?: number;
  y?: number;
}
export interface WfGraph {
  nodes: WfNode[];
}
export interface WorkflowRow {
  id: string;
  workspace_id: string;
  name: string;
  graph: WfGraph;
  enabled: boolean;
  environment: string;
  updated_at: string | Date;
}
export interface StepLog {
  nodeId: string;
  name: string;
  type: NodeType;
  status: "ok" | "error" | "skipped";
  ms: number;
  output?: string;
  error?: string;
}
export interface TriggerInput {
  kind: "manual" | "webhook" | "schedule" | "test";
  body?: unknown;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
  scheduledFor?: Date;
}
export interface WorkflowDeps {
  db: Db;
  ring: MasterKeyRing;
  mailer: Mailer;
  config: Config;
}

const MAX_STEPS = 50;
const DEADLINE_MS = 55_000; // stays inside a serverless function's time limit
const OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "exists", "truthy"] as const;

export function triggerOf(graph: WfGraph): WfNode | undefined {
  return graph.nodes?.find((n) => n.type === "trigger");
}

/** Structural validation; returns human-readable problems (empty = valid). */
export function validateGraph(graph: WfGraph): string[] {
  const problems: string[] = [];
  if (!graph || !Array.isArray(graph.nodes)) return ["The workflow has no steps"];
  const ids = new Set(graph.nodes.map((n) => n.id));
  const triggers = graph.nodes.filter((n) => n.type === "trigger");
  if (triggers.length !== 1) problems.push("A workflow needs exactly one trigger");
  for (const n of graph.nodes) {
    const label = n.name || n.id;
    if (!NODE_TYPES.includes(n.type)) problems.push(`${label}: unknown step type ${n.type}`);
    for (const ref of [n.next, n.onTrue, n.onFalse]) if (ref && !ids.has(ref)) problems.push(`${label}: points to a missing step`);
    const c = n.config ?? {};
    if (n.type === "trigger" && c.mode === "schedule") {
      try {
        parseCron(String(c.cron ?? ""));
      } catch (e) {
        problems.push(`${label}: ${(e as Error).message}`);
      }
    }
    if (n.type === "http" && !String(c.url ?? "").trim()) problems.push(`${label}: set a URL`);
    if (n.type === "condition" && !OPS.includes(c.op as never)) problems.push(`${label}: choose a comparison`);
    if (n.type === "email" && !String(c.to ?? "").trim()) problems.push(`${label}: set a recipient`);
  }
  return problems;
}

function compare(op: string, a: unknown, b: unknown): boolean {
  const na = Number(a), nb = Number(b);
  switch (op) {
    case "eq": return String(a) === String(b);
    case "neq": return String(a) !== String(b);
    case "gt": return na > nb;
    case "gte": return na >= nb;
    case "lt": return na < nb;
    case "lte": return na <= nb;
    case "contains": return Array.isArray(a) ? a.map(String).includes(String(b)) : String(a ?? "").includes(String(b ?? ""));
    case "exists": return a !== undefined && a !== null && a !== "";
    case "truthy": return !!a && a !== "false" && a !== "0";
    default: return false;
  }
}

const short = (v: unknown, max = 4000) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s && s.length > max ? `${s.slice(0, max)}… (${s.length - max} more chars)` : s;
};

/**
 * Execute a workflow. Scheduled runs are de-duplicated across server instances by a unique
 * (workflow, scheduled_for) index: if another instance already started this occurrence, returns null.
 */
export async function runWorkflow(deps: WorkflowDeps, wf: WorkflowRow, trigger: TriggerInput): Promise<{ id: string; status: string; log: StepLog[]; error: string | null } | null> {
  const { db, ring, mailer, config } = deps;
  const runId = crypto.randomUUID();
  const inserted = await db.one<{ id: string }>(
    `INSERT INTO workflow_runs (id, workflow_id, workspace_id, trigger, scheduled_for, status) VALUES ($1,$2,$3,$4,$5,'running')
     ON CONFLICT DO NOTHING RETURNING id`,
    [runId, wf.id, wf.workspace_id, trigger.kind, trigger.scheduledFor ?? null],
  );
  if (!inserted) return null;

  const secrets = secretResolver(db, ring, wf.workspace_id, wf.environment);
  const ctx: Record<string, unknown> = {
    trigger: { kind: trigger.kind, body: trigger.body ?? null, query: trigger.query ?? {}, headers: trigger.headers ?? {} },
    steps: {} as Record<string, unknown>,
    vars: {} as Record<string, unknown>,
    now: new Date().toISOString(),
    workflow: { id: wf.id, name: wf.name },
  };
  const log: StepLog[] = [];
  const started = Date.now();
  let error: string | null = null;
  const byId = new Map(wf.graph.nodes.map((n) => [n.id, n]));
  let current = triggerOf(wf.graph);

  try {
    const problems = validateGraph(wf.graph);
    if (problems.length) throw new Error(problems.join("; "));
    let steps = 0;
    while (current) {
      if (++steps > MAX_STEPS) throw new Error(`Stopped after ${MAX_STEPS} steps (is there a loop?)`);
      if (Date.now() - started > DEADLINE_MS) throw new Error("Stopped: the run took longer than 55 seconds");
      const node = current;
      const c = node.config ?? {};
      const t0 = Date.now();
      let output: unknown = null;
      let next: string | null | undefined = node.next;
      try {
        switch (node.type) {
          case "trigger":
            output = (ctx.trigger as Record<string, unknown>);
            break;
          case "http": {
            const url = await renderString(String(c.url ?? ""), ctx, secrets.resolve);
            const headers = await renderRecord(c.headers as Record<string, string>, ctx, secrets.resolve);
            const method = String(c.method ?? "GET").toUpperCase();
            const body = c.body ? await renderString(String(c.body), ctx, secrets.resolve) : undefined;
            if (body && !Object.keys(headers).some((h) => h.toLowerCase() === "content-type") && /^\s*[[{]/.test(body)) headers["content-type"] = "application/json";
            const res = await guardedFetch(url, { method, headers, body }, { allowPrivate: config.allowPrivateNetwork, timeoutMs: Math.min(30_000, Number(c.timeoutMs) || 20_000), maxBytes: 1024 * 1024 });
            output = { status: res.status, ok: res.status < 400, headers: { "content-type": res.headers["content-type"] ?? "" }, body: decodeBody(res), ms: res.ms };
            if (res.status >= 400 && c.failOnError !== false) throw new Error(`HTTP ${res.status} from ${new URL(res.url).host}`);
            break;
          }
          case "condition": {
            const left = await renderValue(String(c.left ?? ""), ctx, secrets.resolve);
            const right = await renderValue(String(c.right ?? ""), ctx, secrets.resolve);
            const result = compare(String(c.op), left, right);
            output = { result };
            next = result ? node.onTrue : node.onFalse;
            break;
          }
          case "set": {
            const vars = ctx.vars as Record<string, unknown>;
            for (const [k, v] of Object.entries((c.vars as Record<string, string>) ?? {})) if (k.trim()) vars[k.trim()] = await renderValue(String(v), ctx, secrets.resolve);
            output = { ...vars };
            break;
          }
          case "delay": {
            const seconds = Math.max(0, Math.min(25, Number(c.seconds) || 0));
            await new Promise((r) => setTimeout(r, seconds * 1000));
            output = { waited: seconds };
            break;
          }
          case "email": {
            if (!mailer.configured) throw new Error("Email isn't configured on this server (SMTP_URL)");
            const to = await renderString(String(c.to ?? ""), ctx, secrets.resolve);
            const subject = await renderString(String(c.subject ?? ""), ctx, secrets.resolve);
            const text = await renderString(String(c.text ?? ""), ctx, secrets.resolve);
            await mailer.send(to, subject, text);
            output = { to, subject };
            break;
          }
          case "log":
            output = { message: await renderString(String(c.message ?? ""), ctx, secrets.resolve) };
            break;
          case "transform": {
            const rendered = await renderString(String(c.template ?? ""), ctx, secrets.resolve);
            try {
              output = JSON.parse(rendered);
            } catch {
              output = rendered;
            }
            break;
          }
        }
        (ctx.steps as Record<string, unknown>)[node.id] = output;
        if (node.name) (ctx.steps as Record<string, unknown>)[node.name] = output;
        log.push({ nodeId: node.id, name: node.name, type: node.type, status: "ok", ms: Date.now() - t0, output: secrets.redact(short(output) ?? "") });
      } catch (e) {
        log.push({ nodeId: node.id, name: node.name, type: node.type, status: "error", ms: Date.now() - t0, error: secrets.redact((e as Error).message) });
        throw e;
      }
      current = next ? byId.get(next) : undefined;
    }
  } catch (e) {
    error = secrets.redact((e as Error).message);
  }
  const status = error ? "failed" : "succeeded";
  await db.query(`UPDATE workflow_runs SET status = $2, log = $3, error = $4, finished_at = now() WHERE id = $1`, [runId, status, JSON.stringify(log), error]);
  return { id: runId, status, log, error };
}

/** Run every enabled scheduled workflow whose latest cron occurrence hasn't run yet. */
export async function tickSchedules(deps: WorkflowDeps, now = new Date()): Promise<number> {
  const rows = await deps.db.query<WorkflowRow>(`SELECT id, workspace_id, name, graph, enabled, environment, updated_at FROM workflows WHERE enabled = true`);
  let ran = 0;
  for (const wf of rows) {
    const trig = triggerOf(wf.graph);
    if (trig?.config?.mode !== "schedule") continue;
    let due: Date | null;
    try {
      due = lastOccurrence(String(trig.config.cron ?? ""), now, 60);
    } catch {
      continue;
    }
    // Don't fire for occurrences from before the workflow was last saved/enabled.
    if (!due || due.getTime() < new Date(wf.updated_at).getTime() - 60_000) continue;
    const r = await runWorkflow(deps, wf, { kind: "schedule", scheduledFor: due }).catch(() => null);
    if (r) ran++;
  }
  return ran;
}

export function startScheduler(deps: WorkflowDeps, log: (m: string) => void): () => void {
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    tickSchedules(deps)
      .then((n) => n && log(`scheduler: ran ${n} workflow(s)`))
      .catch((e) => log(`scheduler error: ${(e as Error).message}`))
      .finally(() => (busy = false));
  }, 30_000);
  timer.unref();
  return () => clearInterval(timer);
}
