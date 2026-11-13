import type { FastifyPluginAsync } from "fastify";
import { requirePerm } from "../lib/http.js";

export const auditRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app.deps;
  app.get("/export.csv", async (req, reply) => {
    const a = requirePerm(req, "audit.read");
    const rows = await db.query<Record<string, unknown>>(
      `SELECT l.created_at, u.email AS user_email, l.action, l.target_type, l.target_id, l.ip, l.meta
       FROM audit_log l LEFT JOIN users u ON u.id = l.user_id WHERE l.workspace_id = $1 ORDER BY l.id DESC LIMIT 10000`,
      [a.workspaceId],
    );
    const cell = (v: unknown) => {
      const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
      // Quote every cell and neutralise spreadsheet formulas (CSV injection).
      return `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
    };
    const header = ["time", "user", "action", "target_type", "target_id", "ip", "details"];
    const body = rows.map((r) => [r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at, r.user_email, r.action, r.target_type, r.target_id, r.ip, r.meta].map(cell).join(","));
    reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="audit-log.csv"`);
    return [header.join(","), ...body].join("\r\n") + "\r\n";
  });

  app.get("/", async (req) => {
    const a = requirePerm(req, "audit.read");
    const q = req.query as { limit?: string; before?: string; action?: string };
    const limit = Math.min(200, Math.max(1, Number(q.limit ?? 50)));
    const events = await db.query(
      `SELECT l.id::text AS id, l.action, l.target_type, l.target_id, l.meta, l.ip, l.created_at, u.email AS user_email
       FROM audit_log l LEFT JOIN users u ON u.id = l.user_id
       WHERE l.workspace_id = $1 AND ($2::bigint IS NULL OR l.id < $2::bigint) AND ($3::text IS NULL OR l.action LIKE $3 || '%')
       ORDER BY l.id DESC LIMIT $4`,
      [a.workspaceId, q.before ?? null, q.action ?? null, limit],
    );
    return { events };
  });
};
