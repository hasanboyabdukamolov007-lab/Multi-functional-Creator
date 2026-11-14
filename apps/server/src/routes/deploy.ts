import crypto from "node:crypto";
import zlib from "node:zlib";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ENVIRONMENTS } from "@mfc/core";
import { parse, requirePerm, notFound, badRequest } from "../lib/http.js";
import { audit } from "../lib/audit.js";
import { readValue, resolveForDeploy } from "../lib/secretsStore.js";
import { deploy, testTarget, TARGET_KINDS, type DeployFile, type TargetKind } from "../lib/deployers.js";
import { notify } from "../lib/notify.js";
import { assertLimit } from "../lib/billing.js";

const Config = z.record(z.string().max(64), z.string().max(2000)).default({});
const TargetBody = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(TARGET_KINDS),
  config: Config,
  secretId: z.string().uuid().nullable().optional(),
  environment: z.enum(ENVIRONMENTS).default("production"),
});
const DeployBody = z.object({
  projectId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(120),
  files: z.array(z.object({ path: z.string().min(1).max(300), data: z.string() })).min(1).max(3000),
  injectSecrets: z.boolean().default(false),
  analyticsSiteId: z.string().uuid().nullable().optional(),
});

const MAX_BYTES = 25 * 1024 * 1024;

interface TargetRow {
  id: string;
  workspace_id: string;
  name: string;
  kind: TargetKind;
  config: Record<string, string>;
  secret_id: string | null;
  environment: string;
}

function cleanPath(p: string): string {
  const s = p.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!s || s.split("/").some((seg) => seg === ".." || seg === "." || seg === "") || /[\0<>:"|?*]/.test(s)) throw badRequest(`Invalid file path: ${p}`);
  return s;
}

export const deployRoutes: FastifyPluginAsync = async (app) => {
  const { db, ring, config } = app.deps;

  app.get("/targets", async (req) => {
    const a = requirePerm(req, "projects.read");
    const rows = await db.query(`SELECT t.id, t.name, t.kind, t.config, t.secret_id, t.environment, t.updated_at, s.name AS secret_name FROM deploy_targets t LEFT JOIN secrets s ON s.id = t.secret_id WHERE t.workspace_id = $1 ORDER BY t.created_at`, [a.workspaceId]);
    return { targets: rows };
  });

  const checkSecret = async (ws: string, id?: string | null) => {
    if (!id) return;
    const s = await db.one(`SELECT id FROM secrets WHERE id = $1 AND workspace_id = $2`, [id, ws]);
    if (!s) throw badRequest("That secret isn't in this workspace's vault");
  };

  app.post("/targets", async (req) => {
    const a = requirePerm(req, "deploy.targets");
    const b = parse(TargetBody, req.body);
    await assertLimit(app.deps, a.workspaceId, "deployTargets");
    await checkSecret(a.workspaceId, b.secretId);
    const id = crypto.randomUUID();
    await db.query(`INSERT INTO deploy_targets (id, workspace_id, name, kind, config, secret_id, environment, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, a.workspaceId, b.name, b.kind, JSON.stringify(b.config), b.secretId ?? null, b.environment, req.user!.id]);
    await audit(db, req, "deploy.target.create", { targetType: "deploy_target", targetId: id, meta: { name: b.name, kind: b.kind } });
    return { id };
  });

  app.put("/targets/:id", async (req) => {
    const a = requirePerm(req, "deploy.targets");
    const { id } = req.params as { id: string };
    const b = parse(TargetBody, req.body);
    await checkSecret(a.workspaceId, b.secretId);
    const row = await db.one(`UPDATE deploy_targets SET name=$3, kind=$4, config=$5, secret_id=$6, environment=$7, updated_at=now() WHERE id=$1 AND workspace_id=$2 RETURNING id`, [id, a.workspaceId, b.name, b.kind, JSON.stringify(b.config), b.secretId ?? null, b.environment]);
    if (!row) throw notFound("Target not found");
    await audit(db, req, "deploy.target.update", { targetType: "deploy_target", targetId: id });
    return { ok: true };
  });

  app.delete("/targets/:id", async (req) => {
    const a = requirePerm(req, "deploy.targets");
    const { id } = req.params as { id: string };
    const row = await db.one(`DELETE FROM deploy_targets WHERE id=$1 AND workspace_id=$2 RETURNING id`, [id, a.workspaceId]);
    if (!row) throw notFound("Target not found");
    await audit(db, req, "deploy.target.delete", { targetType: "deploy_target", targetId: id });
    return { ok: true };
  });

  const loadTarget = async (ws: string, id: string) => {
    const t = await db.one<TargetRow>(`SELECT id, workspace_id, name, kind, config, secret_id, environment FROM deploy_targets WHERE id = $1 AND workspace_id = $2`, [id, ws]);
    if (!t) throw notFound("Target not found");
    return t;
  };
  const ctxFor = async (t: TargetRow, log: (m: string) => void, env: Array<{ key: string; value: string }> = []) => {
    const token = t.secret_id ? await readValue(db, ring, t.secret_id) : "";
    if (!token && t.kind !== "webhook") throw badRequest("This target has no credentials — pick a vault secret");
    return { token, config: t.config, environment: t.environment, env, log, allowPrivate: config.allowPrivateNetwork, api: config.providers };
  };

  app.post("/targets/:id/test", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const a = requirePerm(req, "deploy.targets");
    const t = await loadTarget(a.workspaceId, (req.params as { id: string }).id);
    const ctx = await ctxFor(t, () => undefined);
    try {
      return { ok: true, message: await testTarget(t.kind, ctx) };
    } catch (e) {
      return { ok: false, message: (e as Error).message.split(ctx.token).join("•••") };
    }
  });

  async function run(ws: string, userId: string, t: TargetRow, files: DeployFile[], name: string, projectId: string | null, opts: { injectSecrets: boolean; analyticsSiteId?: string | null; redeployOf?: string }) {
    const id = crypto.randomUUID();
    const total = files.reduce((n, f) => n + f.data.length, 0);
    const bundle = zlib.gzipSync(Buffer.from(JSON.stringify(files.map((f) => ({ p: f.path, d: f.data.toString("base64") })))));
    await db.query(`INSERT INTO deployments (id, workspace_id, target_id, project_id, name, status, files_count, bytes, bundle, redeploy_of, created_by) VALUES ($1,$2,$3,$4,$5,'building',$6,$7,$8,$9,$10)`, [id, ws, t.id, projectId, name, files.length, total, bundle.length <= 8 * 1024 * 1024 ? bundle : null, opts.redeployOf ?? null, userId]);
    const log: Array<{ at: string; msg: string }> = [];
    let secretsToHide: string[] = [];
    const add = (msg: string) => {
      let m = msg;
      for (const s of secretsToHide) if (s.length >= 4) m = m.split(s).join("•••");
      log.push({ at: new Date().toISOString(), msg: m });
    };
    try {
      let out = files;
      if (opts.analyticsSiteId) {
        const site = await db.one<{ key: string }>(`SELECT key FROM analytics_sites WHERE id = $1 AND workspace_id = $2`, [opts.analyticsSiteId, ws]);
        if (site) {
          const tag = `<script defer src="${config.publicUrl}/api/collect.js" data-site="${site.key}"></script>`;
          out = files.map((f) => (/\.html?$/.test(f.path) ? { ...f, data: Buffer.from(f.data.toString("utf8").replace(/<\/head>/i, `  ${tag}\n</head>`)) } : f));
          add(`Added analytics, Web Vitals and error tracking to ${out.filter((f) => /\.html?$/.test(f.path)).length} page(s).`);
        }
      }
      let env: Array<{ key: string; value: string }> = [];
      if (opts.injectSecrets) {
        if (t.kind === "vercel") {
          const resolved = await resolveForDeploy(db, ring, ws, projectId, t.environment, true);
          env = resolved.map((r) => ({ key: r.name, value: r.value! }));
          secretsToHide = env.map((e) => e.value);
          add(`Injecting ${env.length} vault secret(s) for ${t.environment}: ${env.map((e) => e.key).join(", ") || "none"}.`);
        } else add("Secret injection only applies to server-side environments (Vercel); static files never receive secrets.");
      }
      const ctx = await ctxFor(t, add, env);
      secretsToHide.push(ctx.token);
      add(`Deploying ${out.length} files (${Math.round(total / 1024)} KB) to ${t.kind} target “${t.name}”…`);
      const r = await deploy(t.kind, out, ctx);
      if (r.configPatch && Object.keys(r.configPatch).length) await db.query(`UPDATE deploy_targets SET config = config || $2::jsonb WHERE id = $1`, [t.id, JSON.stringify(r.configPatch)]);
      add(r.url ? `Live at ${r.url}` : "Deployed.");
      await db.query(`UPDATE deployments SET status='ready', url=$2, provider_id=$3, log=$4, finished_at=now() WHERE id=$1`, [id, r.url ?? null, r.providerId ?? null, JSON.stringify(log)]);
      void notify(app.deps, ws, "deploy.ready", { title: `Deployed ${name}`, text: `${files.length} files to ${t.name} (${t.kind}, ${t.environment})`, url: r.url, level: "success" });
    } catch (e) {
      let msg = (e as Error).message;
      for (const s of secretsToHide) if (s.length >= 4) msg = msg.split(s).join("•••");
      add(`Failed: ${msg}`);
      await db.query(`UPDATE deployments SET status='failed', error=$2, log=$3, finished_at=now() WHERE id=$1`, [id, msg, JSON.stringify(log)]);
      void notify(app.deps, ws, "deploy.failed", { title: `Deploy failed: ${name}`, text: `${t.name} (${t.kind}): ${msg}`, level: "error" });
    }
    return db.one(`SELECT id, target_id, project_id, name, status, url, files_count, bytes, log, error, started_at, finished_at FROM deployments WHERE id = $1`, [id]);
  }

  app.post("/targets/:id/deploy", { bodyLimit: 34 * 1024 * 1024, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const a = requirePerm(req, "deploy.run");
    const t = await loadTarget(a.workspaceId, (req.params as { id: string }).id);
    const b = parse(DeployBody, req.body);
    const files = b.files.map((f) => ({ path: cleanPath(f.path), data: Buffer.from(f.data, "base64") }));
    if (files.reduce((n, f) => n + f.data.length, 0) > MAX_BYTES) throw badRequest("Deploys are limited to 25 MB");
    if (b.projectId) {
      const p = await db.one(`SELECT id FROM projects WHERE id = $1 AND workspace_id = $2`, [b.projectId, a.workspaceId]);
      if (!p) throw badRequest("Project not found");
    }
    await audit(db, req, "deploy.run", { targetType: "deploy_target", targetId: t.id, meta: { name: b.name, files: files.length, injectSecrets: b.injectSecrets } });
    return { deployment: await run(a.workspaceId, req.user!.id, t, files, b.name, b.projectId ?? null, { injectSecrets: b.injectSecrets, analyticsSiteId: b.analyticsSiteId }) };
  });

  app.get("/deployments", async (req) => {
    const a = requirePerm(req, "projects.read");
    const q = req.query as { projectId?: string; limit?: string };
    const rows = await db.query(
      `SELECT d.id, d.target_id, d.project_id, d.name, d.status, d.url, d.files_count, d.bytes, d.error, d.started_at, d.finished_at, d.redeploy_of, (d.bundle IS NOT NULL) AS can_redeploy, t.name AS target_name, t.kind AS target_kind
       FROM deployments d LEFT JOIN deploy_targets t ON t.id = d.target_id WHERE d.workspace_id = $1 AND ($2::uuid IS NULL OR d.project_id = $2::uuid) ORDER BY d.started_at DESC LIMIT $3`,
      [a.workspaceId, q.projectId ?? null, Math.min(200, Number(q.limit) || 50)],
    );
    return { deployments: rows };
  });

  app.get("/deployments/:id", async (req) => {
    const a = requirePerm(req, "projects.read");
    const d = await db.one(`SELECT id, target_id, project_id, name, status, url, files_count, bytes, log, error, started_at, finished_at FROM deployments WHERE id = $1 AND workspace_id = $2`, [(req.params as { id: string }).id, a.workspaceId]);
    if (!d) throw notFound("Deployment not found");
    return { deployment: d };
  });

  app.post("/deployments/:id/redeploy", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const a = requirePerm(req, "deploy.run");
    const { id } = req.params as { id: string };
    const { targetId } = parse(z.object({ targetId: z.string().uuid().optional() }), req.body ?? {});
    const d = await db.one<{ id: string; target_id: string | null; project_id: string | null; name: string; bundle: Buffer | null }>(`SELECT id, target_id, project_id, name, bundle FROM deployments WHERE id = $1 AND workspace_id = $2`, [id, a.workspaceId]);
    if (!d) throw notFound("Deployment not found");
    if (!d.bundle) throw badRequest("This deployment's files weren't kept (over 8 MB) — deploy again from the project");
    const t = await loadTarget(a.workspaceId, targetId ?? d.target_id ?? "");
    const files = (JSON.parse(zlib.gunzipSync(Buffer.from(d.bundle)).toString("utf8")) as Array<{ p: string; d: string }>).map((f) => ({ path: f.p, data: Buffer.from(f.d, "base64") }));
    await audit(db, req, "deploy.redeploy", { targetType: "deployment", targetId: id, meta: { target: t.id } });
    return { deployment: await run(a.workspaceId, req.user!.id, t, files, d.name, d.project_id, { injectSecrets: false, redeployOf: d.id }) };
  });
};
