import type { FastifyRequest } from "fastify";
import type { Db } from "../db.js";

export async function audit(
  db: Pick<Db, "query">,
  req: FastifyRequest | null,
  action: string,
  opts: { workspaceId?: string | null; userId?: string | null; targetType?: string; targetId?: string; meta?: Record<string, unknown> } = {},
) {
  await db.query(
    `INSERT INTO audit_log (workspace_id, user_id, action, target_type, target_id, meta, ip) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      opts.workspaceId ?? req?.access?.workspaceId ?? null,
      opts.userId ?? req?.user?.id ?? null,
      action,
      opts.targetType ?? null,
      opts.targetId ?? null,
      JSON.stringify(opts.meta ?? {}),
      req?.ip ?? null,
    ],
  );
}
