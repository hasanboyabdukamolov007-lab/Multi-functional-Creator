import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { parse, requirePerm, notFound } from "../lib/http.js";
import { audit } from "../lib/audit.js";

export const PROJECT_KINDS = ["site", "panel", "app", "api", "scene3d"] as const;

const CreateBody = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(PROJECT_KINDS),
  data: z.record(z.string(), z.unknown()).optional(),
});
const UpdateBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export const projectRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app.deps;

  app.get("/", async (req) => {
    const a = requirePerm(req, "projects.read");
    const { kind } = req.query as { kind?: string };
    const projects = await db.query(
      `SELECT id, name, kind, created_at, updated_at FROM projects WHERE workspace_id = $1 AND ($2::text IS NULL OR kind = $2) ORDER BY updated_at DESC`,
      [a.workspaceId, kind ?? null],
    );
    return { projects };
  });

  app.post("/", async (req) => {
    const a = requirePerm(req, "projects.write");
    const body = parse(CreateBody, req.body);
    const id = crypto.randomUUID();
    const project = await db.one(
      `INSERT INTO projects (id, workspace_id, name, kind, data, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, kind, data, created_at, updated_at`,
      [id, a.workspaceId, body.name, body.kind, JSON.stringify(body.data ?? {}), req.user!.id],
    );
    await audit(db, req, "project.create", { targetType: "project", targetId: id, meta: { name: body.name, kind: body.kind } });
    return { project };
  });

  app.get("/:id", async (req) => {
    const a = requirePerm(req, "projects.read");
    const { id } = req.params as { id: string };
    const project = await db.one(`SELECT id, name, kind, data, created_at, updated_at FROM projects WHERE id = $1 AND workspace_id = $2`, [id, a.workspaceId]);
    if (!project) throw notFound("Project not found");
    return { project };
  });

  app.put("/:id", async (req) => {
    const a = requirePerm(req, "projects.write");
    const { id } = req.params as { id: string };
    const body = parse(UpdateBody, req.body);
    const project = await db.one(
      `UPDATE projects SET name = coalesce($3, name), data = coalesce($4::jsonb, data), updated_at = now() WHERE id = $1 AND workspace_id = $2 RETURNING id, name, kind, updated_at`,
      [id, a.workspaceId, body.name ?? null, body.data ? JSON.stringify(body.data) : null],
    );
    if (!project) throw notFound("Project not found");
    return { project };
  });

  app.delete("/:id", async (req) => {
    const a = requirePerm(req, "projects.write");
    const { id } = req.params as { id: string };
    const row = await db.one<{ name: string }>(`DELETE FROM projects WHERE id = $1 AND workspace_id = $2 RETURNING name`, [id, a.workspaceId]);
    if (!row) throw notFound("Project not found");
    await audit(db, req, "project.delete", { targetType: "project", targetId: id, meta: { name: row.name } });
    return { ok: true };
  });
};
