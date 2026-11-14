import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { parse, requirePerm, badRequest } from "../lib/http.js";

const MAX_BYTES = 2_000_000;

/** Forge's learned memory, shared by everyone in the workspace (team learning). */
export const forgeRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app.deps;

  app.get("/brain", async (req) => {
    const a = requirePerm(req, "ai.use");
    const row = await db.one<{ data: unknown; updated_at: string }>(`SELECT data, updated_at FROM forge_brain WHERE workspace_id = $1`, [a.workspaceId]);
    return { data: row?.data ?? null, updatedAt: row?.updated_at ?? null };
  });

  app.put("/brain", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    // Viewers can use Forge but only editors and up shape the shared brain.
    const a = requirePerm(req, "projects.write");
    const { data } = parse(z.object({ data: z.record(z.string(), z.unknown()) }), req.body);
    const json = JSON.stringify(data);
    if (json.length > MAX_BYTES) throw badRequest("Brain snapshot too large");
    if (data.v !== 1) throw badRequest("Unsupported brain version");
    await db.query(
      `INSERT INTO forge_brain (workspace_id, data, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (workspace_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [a.workspaceId, json],
    );
    return { ok: true };
  });
};
