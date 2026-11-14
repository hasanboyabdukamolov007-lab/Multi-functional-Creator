import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { parse, requirePerm, notFound, badRequest, HttpError } from "../lib/http.js";
import { audit } from "../lib/audit.js";
import { assertLimit } from "../lib/billing.js";

const MAX_FILE = 15 * 1024 * 1024;
const QUOTA = 1024 * 1024 * 1024; // 1 GB per workspace
const ALLOWED = /^(image\/(png|jpeg|webp|avif|gif|svg\+xml)|model\/(gltf-binary|gltf\+json|obj|stl)|application\/(json|octet-stream|pdf)|font\/(woff2?|ttf|otf)|video\/(mp4|webm)|audio\/(mpeg|ogg|wav|webm)|text\/plain)$/;

const Upload = z.object({
  name: z.string().trim().min(1).max(200),
  mime: z.string().max(100),
  data: z.string().min(1),
  width: z.number().int().positive().max(20_000).nullable().optional(),
  height: z.number().int().positive().max(20_000).nullable().optional(),
  folder: z.string().max(100).default(""),
  tags: z.array(z.string().max(40)).max(20).default([]),
});

export const assetUrl = (id: string, name: string) => `/api/a/${id}/${encodeURIComponent(name.replace(/[/\\]/g, "-"))}`;

/** Workspace asset library (images, models, fonts, video, Lottie JSON). Files are served at unguessable public URLs. */
export const assetRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app.deps;

  app.get("/", async (req) => {
    const a = requirePerm(req, "projects.read");
    const q = req.query as { q?: string; kind?: string; folder?: string };
    const rows = await db.query<{ id: string; name: string; mime: string; size: number; width: number | null; height: number | null; folder: string; tags: string[]; created_at: string }>(
      `SELECT id, name, mime, size, width, height, folder, tags, created_at FROM assets WHERE workspace_id = $1
        AND ($2::text IS NULL OR name ILIKE '%' || $2 || '%' OR $2 = ANY(tags))
        AND ($3::text IS NULL OR mime LIKE $3 || '/%')
        AND ($4::text IS NULL OR folder = $4)
       ORDER BY created_at DESC LIMIT 500`,
      [a.workspaceId, q.q || null, q.kind || null, q.folder ?? null],
    );
    const [{ used }] = await db.query<{ used: string | null }>(`SELECT sum(size) AS used FROM assets WHERE workspace_id = $1`, [a.workspaceId]);
    return { assets: rows.map((r) => ({ ...r, url: assetUrl(r.id, r.name) })), used: Number(used ?? 0), quota: QUOTA };
  });

  app.post("/", { bodyLimit: Math.ceil(MAX_FILE * 1.4) + 4096, config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req) => {
    const a = requirePerm(req, "projects.write");
    const b = parse(Upload, req.body);
    if (!ALLOWED.test(b.mime)) throw badRequest(`File type ${b.mime} isn't allowed`);
    const data = Buffer.from(b.data, "base64");
    if (!data.length) throw badRequest("Empty file");
    if (data.length > MAX_FILE) throw badRequest("Files are limited to 15 MB");
    if (b.mime === "image/svg+xml" && /<script|\bon\w+\s*=|javascript:/i.test(data.toString("utf8"))) throw badRequest("SVG files with scripts aren't allowed");
    const [{ used }] = await db.query<{ used: string | null }>(`SELECT sum(size) AS used FROM assets WHERE workspace_id = $1`, [a.workspaceId]);
    if (Number(used ?? 0) + data.length > QUOTA) throw badRequest("Storage quota reached (1 GB)");
    await assertLimit(app.deps, a.workspaceId, "storageMb", data.length);
    const sha = crypto.createHash("sha256").update(data).digest("hex");
    const existing = await db.one<{ id: string; name: string }>(`SELECT id, name FROM assets WHERE workspace_id = $1 AND sha256 = $2`, [a.workspaceId, sha]);
    if (existing) return { id: existing.id, url: assetUrl(existing.id, existing.name), deduplicated: true };
    const id = crypto.randomUUID();
    await db.query(`INSERT INTO assets (id, workspace_id, name, mime, size, sha256, data, width, height, folder, tags, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [id, a.workspaceId, b.name, b.mime, data.length, sha, data, b.width ?? null, b.height ?? null, b.folder, b.tags, req.user!.id]);
    await audit(db, req, "asset.upload", { targetType: "asset", targetId: id, meta: { name: b.name, size: data.length } });
    return { id, url: assetUrl(id, b.name) };
  });

  app.patch("/:id", async (req) => {
    const a = requirePerm(req, "projects.write");
    const b = parse(z.object({ name: z.string().trim().min(1).max(200).optional(), folder: z.string().max(100).optional(), tags: z.array(z.string().max(40)).max(20).optional() }), req.body);
    const row = await db.one(`UPDATE assets SET name = coalesce($3, name), folder = coalesce($4, folder), tags = coalesce($5, tags) WHERE id = $1 AND workspace_id = $2 RETURNING id`, [(req.params as { id: string }).id, a.workspaceId, b.name ?? null, b.folder ?? null, b.tags ?? null]);
    if (!row) throw notFound("Asset not found");
    return { ok: true };
  });

  app.delete("/:id", async (req) => {
    const a = requirePerm(req, "projects.write");
    const row = await db.one(`DELETE FROM assets WHERE id = $1 AND workspace_id = $2 RETURNING id`, [(req.params as { id: string }).id, a.workspaceId]);
    if (!row) throw notFound("Asset not found");
    await audit(db, req, "asset.delete", { targetType: "asset", targetId: (req.params as { id: string }).id });
    return { ok: true };
  });
};

/** Public file serving: /api/a/:id/:name — immutable, cacheable by CDNs, embeddable from deployed sites. */
export const assetPublicRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app.deps;
  app.get("/a/:id/:name", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "Not found");
    const row = await db.one<{ mime: string; data: Buffer; sha256: string; name: string }>(`SELECT mime, data, sha256, name FROM assets WHERE id = $1`, [id]);
    if (!row) throw new HttpError(404, "Not found");
    if (req.headers["if-none-match"] === `"${row.sha256}"`) return reply.status(304).send();
    reply
      .header("content-type", row.mime)
      .header("cache-control", "public, max-age=31536000, immutable")
      .header("etag", `"${row.sha256}"`)
      .header("cross-origin-resource-policy", "cross-origin")
      .header("access-control-allow-origin", "*")
      .header("x-content-type-options", "nosniff");
    // SVGs can carry markup: serve them sandboxed.
    if (row.mime === "image/svg+xml") reply.header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    return reply.send(Buffer.from(row.data));
  });
};

export const brandRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app.deps;
  app.get("/", async (req) => {
    const a = requirePerm(req, "projects.read");
    const row = await db.one<{ data: unknown; updated_at: string }>(`SELECT data, updated_at FROM brand_kits WHERE workspace_id = $1`, [a.workspaceId]);
    return { brand: row?.data ?? null, updatedAt: row?.updated_at ?? null };
  });
  app.put("/", async (req) => {
    const a = requirePerm(req, "projects.write");
    const { brand } = parse(z.object({ brand: z.record(z.string(), z.unknown()) }), req.body);
    if (JSON.stringify(brand).length > 200_000) throw badRequest("Brand kit too large");
    await db.query(`INSERT INTO brand_kits (workspace_id, data, updated_at) VALUES ($1, $2, now()) ON CONFLICT (workspace_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`, [a.workspaceId, JSON.stringify(brand)]);
    await audit(db, req, "brand.update");
    return { ok: true };
  });
};
