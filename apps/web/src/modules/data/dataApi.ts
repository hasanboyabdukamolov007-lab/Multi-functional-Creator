import type { Environment } from "@mfc/core";
import { api } from "../../lib/api";
import { ws } from "../../lib/session";

export interface HttpReq {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
  environment: Environment;
}
export interface HttpRes {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  size: number;
  truncated: boolean;
  ms: number;
  url: string;
  redirects: number;
}
export interface SavedRequest extends HttpReq {
  id: string;
  name: string;
  updated_at: string;
}
export interface Connection {
  id: string;
  name: string;
  kind: "postgres" | "mysql" | "mongodb";
  secret_id: string;
  secret_name: string;
  environment: string;
}
export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  ms: number;
  command: string;
}
export interface SchemaTable {
  name: string;
  columns: Array<{ name: string; type: string; nullable: boolean }>;
}

export const httpApi = {
  send: (r: HttpReq) => api.post<HttpRes>(ws("/http/send"), r),
  list: () => api.get<{ requests: SavedRequest[] }>(ws("/http/requests")).then((r) => r.requests),
  create: (r: HttpReq & { name: string }) => api.post<{ id: string }>(ws("/http/requests"), r),
  update: (id: string, r: HttpReq & { name: string }) => api.put(ws(`/http/requests/${id}`), r),
  remove: (id: string) => api.del(ws(`/http/requests/${id}`)),
};

export const dataApi = {
  connections: () => api.get<{ connections: Connection[] }>(ws("/data/connections")).then((r) => r.connections),
  addConnection: (b: { name: string; kind: Connection["kind"]; secretId: string }) => api.post<{ id: string }>(ws("/data/connections"), b),
  removeConnection: (id: string) => api.del(ws(`/data/connections/${id}`)),
  schema: (id: string) => api.get<{ tables: SchemaTable[] }>(ws(`/data/connections/${id}/schema`)).then((r) => r.tables),
  query: (id: string, b: { sql?: string; mongo?: unknown; readOnly: boolean }) => api.post<QueryResult>(ws(`/data/connections/${id}/query`), b),
};

/** Turn an array of objects (e.g. a JSON API response) into table columns/rows. */
export function toTable(value: unknown): { columns: string[]; rows: string[][] } | null {
  const arr = Array.isArray(value) ? value : value && typeof value === "object" ? Object.values(value as object).find(Array.isArray) : null;
  if (!Array.isArray(arr) || !arr.length || typeof arr[0] !== "object" || arr[0] === null) return null;
  const columns = [...new Set(arr.slice(0, 50).flatMap((o) => Object.keys(o as object)))].slice(0, 8);
  const cell = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
  return { columns, rows: arr.slice(0, 100).map((o) => columns.map((c) => cell((o as Record<string, unknown>)[c]))) };
}

/** Rows as CSV (RFC 4180, formula-injection safe). */
export function toCsv(columns: string[], rows: unknown[][]): string {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
  };
  return [columns.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))].join("\r\n") + "\r\n";
}

export function curlFor(r: HttpReq): string {
  const parts = [`curl -X ${r.method} ${JSON.stringify(r.url)}`];
  for (const [k, v] of Object.entries(r.headers)) if (k.trim()) parts.push(`-H ${JSON.stringify(`${k}: ${v}`)}`);
  if (r.body && !["GET", "HEAD"].includes(r.method)) parts.push(`--data ${JSON.stringify(r.body)}`);
  return parts.join(" \\\n  ");
}

export function fetchFor(r: HttpReq): string {
  const init: Record<string, unknown> = { method: r.method };
  if (Object.keys(r.headers).length) init.headers = r.headers;
  if (r.body && !["GET", "HEAD"].includes(r.method)) init.body = r.body;
  return `const res = await fetch(${JSON.stringify(r.url)}, ${JSON.stringify(init, null, 2)});\nconst data = await res.json();`;
}
