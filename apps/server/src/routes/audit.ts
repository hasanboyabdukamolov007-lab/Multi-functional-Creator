import type { FastifyPluginAsync } from "fastify";
import { requirePerm } from "../lib/http.js";

export const auditRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app.deps;
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
