import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { can } from "@mfc/core";
import { parse, requirePerm, notFound, badRequest, HttpError } from "../lib/http.js";
import { audit } from "../lib/audit.js";

export const MARKET_KINDS = ["template", "scene", "schema", "api", "workflow", "brand", "plugin"] as const;
export const PLUGIN_PERMISSIONS = ["builder.read", "builder.write", "studio.write", "toast", "storage", "http"] as const;

export const PluginManifest = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/, "Plugin id: 2–40 lowercase letters, digits or dashes"),
  name: z.string().trim().min(1).max(60),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "Use semantic versioning, e.g. 1.0.0"),
  description: z.string().max(400).default(""),
  author: z.string().max(80).optional(),
  permissions: z.array(z.enum(PLUGIN_PERMISSIONS)).max(PLUGIN_PERMISSIONS.length).default([]),
  functions: z.array(z.object({ id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/), title: z.string().trim().min(1).max(80), keywords: z.array(z.string().max(30)).max(10).optional() })).min(1).max(30),
});
const PluginBody = z.object({ manifest: PluginManifest, code: z.string().min(1).max(200_000) });
const MAX_DATA = 1_500_000;

export const marketRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app.deps;

  // ------------------------------------------------------------------ marketplace
  app.get("/market", async (req) => {
    const a = requirePerm(req, "projects.read");
    const q = req.query as { kind?: string; q?: string; scope?: string };
    const rows = await db.query(
      `SELECT i.id, i.kind, i.name, i.description, i.tags, i.visibility, i.installs, i.created_at, i.workspace_id = $1 AS mine, coalesce(u.name, split_part(u.email, '@', 1)) AS author, w.name AS workspace
       FROM market_items i LEFT JOIN users u ON u.id = i.author_id LEFT JOIN workspaces w ON w.id = i.workspace_id
       WHERE (i.workspace_id = $1 OR i.visibility = 'public')
         AND ($2::text IS NULL OR i.kind = $2)
         AND ($3::text IS NULL OR i.name ILIKE '%' || $3 || '%' OR i.description ILIKE '%' || $3 || '%' OR $3 = ANY(i.tags))
         AND ($4::text IS NULL OR ($4 = 'mine' AND i.workspace_id = $1) OR ($4 = 'public' AND i.visibility = 'public'))
       ORDER BY i.installs DESC, i.created_at DESC LIMIT 200`,
      [a.workspaceId, q.kind || null, q.q || null, q.scope || null],
    );
    return { items: rows };
  });

  app.post("/market", { bodyLimit: MAX_DATA + 10_000 }, async (req) => {
    const a = requirePerm(req, "projects.write");
    const b = parse(z.object({ kind: z.enum(MARKET_KINDS), name: z.string().trim().min(1).max(80), description: z.string().max(600).default(""), tags: z.array(z.string().trim().toLowerCase().max(30)).max(10).default([]), visibility: z.enum(["workspace", "public"]).default("workspace"), data: z.record(z.string(), z.unknown()) }), req.body);
    if (b.kind === "plugin") {
      if (!can(a.role, "plugins.manage")) throw new HttpError(403, "Only admins can publish plugins");
      parse(PluginBody, b.data);
    }
    if (b.visibility === "public" && !["owner", "admin"].includes(a.role)) throw new HttpError(403, "Only owners and admins can publish publicly");
    if (JSON.stringify(b.data).length > MAX_DATA) throw badRequest("Item is too large (1.5 MB max)");
    const id = crypto.randomUUID();
    await db.query(`INSERT INTO market_items (id, workspace_id, author_id, kind, name, description, tags, visibility, data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [id, a.workspaceId, req.user!.id, b.kind, b.name, b.description, b.tags, b.visibility, JSON.stringify(b.data)]);
    await audit(db, req, "market.publish", { targetType: "market_item", targetId: id, meta: { kind: b.kind, visibility: b.visibility } });
    return { id };
  });

  app.delete("/market/:id", async (req) => {
    const a = requirePerm(req, "projects.write");
    const row = await db.one<{ author_id: string | null }>(`SELECT author_id FROM market_items WHERE id = $1 AND workspace_id = $2`, [(req.params as { id: string }).id, a.workspaceId]);
    if (!row) throw notFound("Item not found");
    if (row.author_id !== req.user!.id && !["owner", "admin"].includes(a.role)) throw new HttpError(403, "Only the author or an admin can remove this");
    await db.query(`DELETE FROM market_items WHERE id = $1`, [(req.params as { id: string }).id]);
    return { ok: true };
  });

  app.post("/market/:id/install", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const a = requirePerm(req, "projects.write");
    const { id } = req.params as { id: string };
    const item = await db.one<{ kind: (typeof MARKET_KINDS)[number]; name: string; data: Record<string, unknown> }>(`SELECT kind, name, data FROM market_items WHERE id = $1 AND (workspace_id = $2 OR visibility = 'public')`, [id, a.workspaceId]);
    if (!item) throw notFound("Item not found");
    await db.query(`UPDATE market_items SET installs = installs + 1 WHERE id = $1`, [id]);
    await audit(db, req, "market.install", { targetType: "market_item", targetId: id, meta: { kind: item.kind } });
    const projectKind: Record<string, string> = { template: String(item.data.projectKind ?? "site"), scene: "scene3d", schema: "db", api: "api" };
    if (projectKind[item.kind]) {
      const pid = crypto.randomUUID();
      const project = await db.one(`INSERT INTO projects (id, workspace_id, name, kind, data, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, kind`, [pid, a.workspaceId, item.name, projectKind[item.kind], JSON.stringify(item.data.doc ?? item.data), req.user!.id]);
      return { kind: item.kind, project };
    }
    if (item.kind === "workflow") {
      if (!can(a.role, "workflows.manage")) throw new HttpError(403, "You can't create workflows");
      const wid = crypto.randomUUID();
      await db.query(`INSERT INTO workflows (id, workspace_id, name, graph, enabled, environment, webhook_token, created_by) VALUES ($1,$2,$3,$4,false,'production',$5,$6)`, [wid, a.workspaceId, item.name, JSON.stringify(item.data.graph ?? { nodes: [] }), crypto.randomBytes(24).toString("base64url"), req.user!.id]);
      return { kind: item.kind, workflowId: wid };
    }
    if (item.kind === "plugin") {
      if (!can(a.role, "plugins.manage")) throw new HttpError(403, "Only admins can install plugins");
      const { manifest, code } = parse(PluginBody, item.data);
      const pid = await upsertPlugin(a.workspaceId, req.user!.id, manifest, code);
      return { kind: item.kind, pluginId: pid };
    }
    return { kind: item.kind, data: item.data };
  });

  // ------------------------------------------------------------------ plugins
  async function upsertPlugin(ws: string, userId: string, manifest: z.infer<typeof PluginManifest>, code: string) {
    const row = await db.one<{ id: string }>(
      `INSERT INTO plugins (id, workspace_id, slug, manifest, code, installed_by) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (workspace_id, slug) DO UPDATE SET manifest = EXCLUDED.manifest, code = EXCLUDED.code, updated_at = now() RETURNING id`,
      [crypto.randomUUID(), ws, manifest.id, JSON.stringify(manifest), code, userId],
    );
    return row!.id;
  }

  app.get("/plugins", async (req) => {
    const a = requirePerm(req, "projects.read");
    return { plugins: await db.query(`SELECT id, slug, manifest, code, enabled, updated_at FROM plugins WHERE workspace_id = $1 ORDER BY created_at`, [a.workspaceId]) };
  });
  app.post("/plugins", { bodyLimit: 260_000 }, async (req) => {
    const a = requirePerm(req, "plugins.manage");
    const { manifest, code } = parse(PluginBody, req.body);
    const id = await upsertPlugin(a.workspaceId, req.user!.id, manifest, code);
    await audit(db, req, "plugin.install", { targetType: "plugin", targetId: id, meta: { slug: manifest.id, version: manifest.version, permissions: manifest.permissions } });
    return { id };
  });
  app.patch("/plugins/:id", async (req) => {
    const a = requirePerm(req, "plugins.manage");
    const { enabled } = parse(z.object({ enabled: z.boolean() }), req.body);
    const row = await db.one(`UPDATE plugins SET enabled = $3, updated_at = now() WHERE id = $1 AND workspace_id = $2 RETURNING id`, [(req.params as { id: string }).id, a.workspaceId, enabled]);
    if (!row) throw notFound("Plugin not found");
    await audit(db, req, enabled ? "plugin.enable" : "plugin.disable", { targetType: "plugin", targetId: (req.params as { id: string }).id });
    return { ok: true };
  });
  app.delete("/plugins/:id", async (req) => {
    const a = requirePerm(req, "plugins.manage");
    const row = await db.one(`DELETE FROM plugins WHERE id = $1 AND workspace_id = $2 RETURNING id`, [(req.params as { id: string }).id, a.workspaceId]);
    if (!row) throw notFound("Plugin not found");
    await audit(db, req, "plugin.remove", { targetType: "plugin", targetId: (req.params as { id: string }).id });
    return { ok: true };
  });
};
