import type { Environment } from "@mfc/core";
import { api } from "../../lib/api";
import { ws } from "../../lib/session";

export const NODE_TYPES = ["trigger", "http", "condition", "set", "delay", "email", "log", "transform"] as const;
export type NodeType = (typeof NODE_TYPES)[number];
export const OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "exists", "truthy"] as const;

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
export interface Workflow {
  id: string;
  name: string;
  graph: WfGraph;
  enabled: boolean;
  environment: Environment;
  trigger: "manual" | "webhook" | "schedule";
  webhookPath: string;
  nextRun: string | null;
  updated_at: string;
  lastRun?: { status: string; started_at: string } | null;
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
export interface WfRun {
  id: string;
  trigger: string;
  scheduled_for: string | null;
  status: "running" | "succeeded" | "failed";
  log: StepLog[];
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export const workflowApi = {
  list: () => api.get<{ workflows: Workflow[] }>(ws("/workflows")).then((r) => r.workflows),
  get: (id: string) => api.get<{ workflow: Workflow; problems: string[] }>(ws(`/workflows/${id}`)),
  create: (name: string, graph?: WfGraph) => api.post<{ id: string }>(ws("/workflows"), graph ? { name, graph } : { name }).then((r) => r.id),
  save: (id: string, w: { name: string; graph: WfGraph; enabled: boolean; environment: Environment }) => api.put<{ ok: true; problems: string[] }>(ws(`/workflows/${id}`), w),
  remove: (id: string) => api.del(ws(`/workflows/${id}`)),
  run: (id: string, input?: unknown) => api.post<{ run: { id: string; status: string; log: StepLog[]; error: string | null } | null }>(ws(`/workflows/${id}/run`), input === undefined ? {} : { input }).then((r) => r.run),
  runs: (id: string) => api.get<{ runs: WfRun[] }>(ws(`/workflows/${id}/runs`)).then((r) => r.runs),
  rotateWebhook: (id: string) => api.post<{ webhookPath: string }>(ws(`/workflows/${id}/rotate-webhook`)).then((r) => r.webhookPath),
};

/** Mirrors the server's structural validation so problems show while editing. */
export function validateGraph(graph: WfGraph): string[] {
  const problems: string[] = [];
  const ids = new Set(graph.nodes.map((n) => n.id));
  if (graph.nodes.filter((n) => n.type === "trigger").length !== 1) problems.push("A workflow needs exactly one trigger");
  const names = new Set<string>();
  for (const n of graph.nodes) {
    const label = n.name || n.id;
    if (n.name && names.has(n.name)) problems.push(`Two steps are named "${n.name}"`);
    names.add(n.name);
    for (const ref of [n.next, n.onTrue, n.onFalse]) if (ref && !ids.has(ref)) problems.push(`${label}: points to a missing step`);
    const c = n.config ?? {};
    if (n.type === "trigger" && c.mode === "schedule" && String(c.cron ?? "").trim().split(/\s+/).length !== 5 && !String(c.cron ?? "").startsWith("@")) problems.push(`${label}: a schedule needs 5 cron fields`);
    if (n.type === "http" && !String(c.url ?? "").trim()) problems.push(`${label}: set a URL`);
    if (n.type === "condition" && !OPS.includes(c.op as never)) problems.push(`${label}: choose a comparison`);
    if (n.type === "email" && !String(c.to ?? "").trim()) problems.push(`${label}: set a recipient`);
  }
  return problems;
}

const DEFAULTS: Record<NodeType, Record<string, unknown>> = {
  trigger: { mode: "manual" },
  http: { method: "GET", url: "https://", headers: {}, body: "", failOnError: true },
  condition: { left: "{{ steps.request.status }}", op: "eq", right: "200" },
  set: { vars: { key: "value" } },
  delay: { seconds: 5 },
  email: { to: "", subject: "Workflow {{ workflow.name }}", text: "Finished at {{ now }}" },
  log: { message: "Hello from {{ workflow.name }}" },
  transform: { template: '{ "count": "{{ steps.request.body.length }}" }' },
};

export function newNode(type: NodeType, existing: WfNode[], x = 40, y = 40): WfNode {
  let i = 1;
  const base = type === "http" ? "request" : type;
  let name = base;
  while (existing.some((n) => n.name === name || n.id === name)) name = `${base}_${++i}`;
  return { id: `${name}_${Math.random().toString(36).slice(2, 6)}`, type, name, config: structuredClone(DEFAULTS[type]), next: null, x, y };
}

/** Removes a node and re-links every edge that pointed at it to its successor. */
export function removeNode(graph: WfGraph, id: string): WfGraph {
  const gone = graph.nodes.find((n) => n.id === id);
  const succ = gone?.next ?? null;
  const fix = (r?: string | null) => (r === id ? succ : r ?? null);
  return { nodes: graph.nodes.filter((n) => n.id !== id).map((n) => ({ ...n, next: fix(n.next), onTrue: fix(n.onTrue), onFalse: fix(n.onFalse) })) };
}

export const CRON_PRESETS: Array<[string, string]> = [
  ["*/5 * * * *", "every 5 min"],
  ["0 * * * *", "hourly"],
  ["0 9 * * *", "daily 09:00 UTC"],
  ["0 9 * * 1-5", "weekdays 09:00 UTC"],
  ["0 0 * * 0", "weekly (Sun)"],
  ["0 0 1 * *", "monthly"],
];
