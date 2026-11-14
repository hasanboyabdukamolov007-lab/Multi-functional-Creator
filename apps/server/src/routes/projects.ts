import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { parse, requirePerm, notFound, HttpError } from "../lib/http.js";
import { audit } from "../lib/audit.js";
import { snapshot } from "./collab.js";

export const PROJECT_KINDS = ["site", "panel", "app", "api", "scene3d", "db"] as const;

const CreateBody = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(PROJECT_KINDS),
  data: z.record(z.string(), z.unknown()).optional(),
});
const UpdateBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  /** Optimistic concurrency: the version the client last saw. A mismatch returns 409. */
  baseVersion: z.number().int().positive().optional(),
});

export const projectRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app.deps;

  app.get("/", async (req) => {
    const a = requirePerm(req, "projects.read");
    const { kind } = req.query as { kind?: string };
    const projects = await db.query(
      `SELECT id, name, kind, version, created_at, updated_at FROM projects WHERE workspace_id = $1 AND ($2::text IS NULL OR kind = $2) ORDER BY updated_at DESC`,
      [a.workspaceId, kind ?? null],
    );
    return { projects };
  });

  app.post("/", async (req) => {
    const a = requirePerm(req, "projects.write");
    const body = parse(CreateBody, req.body);
    const id = crypto.randomUUID();
    const project = await db.one(
      `INSERT INTO projects (id, workspace_id, name, kind, data, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, kind, data, version, created_at, updated_at`,
      [id, a.workspaceId, body.name, body.kind, JSON.stringify(body.data ?? {}), req.user!.id],
    );
    await audit(db, req, "project.create", { targetType: "project", targetId: id, meta: { name: body.name, kind: body.kind } });
    return { project };
  });

  app.get("/:id", async (req) => {
    const a = requirePerm(req, "projects.read");
    const { id } = req.params as { id: string };
    const project = await db.one(`SELECT id, name, kind, data, version, created_at, updated_at FROM projects WHERE id = $1 AND workspace_id = $2`, [id, a.workspaceId]);
    if (!project) throw notFound("Project not found");
    return { project };
  });

  app.put("/:id", async (req) => {
    const a = requirePerm(req, "projects.write");
    const { id } = req.params as { id: string };
    const body = parse(UpdateBody, req.body);
    // Automatic version history: before replacing the data, keep the previous state (at most every 10 minutes).
    if (body.data) {
      const recent = await db.one(`SELECT 1 FROM project_versions WHERE project_id = $1 AND auto AND created_at > now() - interval '10 minutes'`, [id]);
      if (!recent) await snapshot(db, id, a.workspaceId, req.user!.id, null, true);
    }
    const project = await db.one(
      `UPDATE projects SET name = coalesce($3, name), data = coalesce($4::jsonb, data), version = version + CASE WHEN $4::jsonb IS NULL THEN 0 ELSE 1 END, updated_at = now()
       WHERE id = $1 AND workspace_id = $2 AND ($5::int IS NULL OR version = $5::int) RETURNING id, name, kind, version, updated_at`,
      [id, a.workspaceId, body.name ?? null, body.data ? JSON.stringify(body.data) : null, body.baseVersion ?? null],
    );
    if (!project) {
      const cur = await db.one<{ version: number }>(`SELECT version FROM projects WHERE id = $1 AND workspace_id = $2`, [id, a.workspaceId]);
      if (!cur) throw notFound("Project not found");
      throw new HttpError(409, "This project was changed in another tab or by a teammate. Reload to get the latest version.", "conflict");
    }
    if (body.name) await audit(db, req, "project.rename", { targetType: "project", targetId: id, meta: { name: body.name } });
    return { project };
  });

  app.post("/:id/duplicate", async (req) => {
    const a = requirePerm(req, "projects.write");
    const { id } = req.params as { id: string };
    const { name } = parse(z.object({ name: z.string().trim().min(1).max(120).optional() }), req.body ?? {});
    const src = await db.one<{ name: string; kind: string; data: unknown }>(`SELECT name, kind, data FROM projects WHERE id = $1 AND workspace_id = $2`, [id, a.workspaceId]);
    if (!src) throw notFound("Project not found");
    const newId = crypto.randomUUID();
    const project = await db.one(
      `INSERT INTO projects (id, workspace_id, name, kind, data, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, kind, version, created_at, updated_at`,
      [newId, a.workspaceId, name ?? `${src.name} (copy)`, src.kind, JSON.stringify(src.data), req.user!.id],
    );
    await audit(db, req, "project.duplicate", { targetType: "project", targetId: newId, meta: { from: id } });
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
