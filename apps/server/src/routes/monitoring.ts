import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { parse, requirePerm, notFound, badRequest } from "../lib/http.js";
import { audit } from "../lib/audit.js";
import { assertSafeUrl } from "../lib/netGuard.js";
import { checkOnce, recordCheck, uptimeSummary } from "../lib/monitoring.js";
import { CHANNEL_KINDS, EVENTS, sendToChannel } from "../lib/notify.js";

const MonitorBody = z.object({
  name: z.string().trim().min(1).max(80),
  url: z.string().url().max(2000),
  method: z.enum(["GET", "HEAD", "POST"]).default("GET"),
  intervalS: z.number().int().min(60).max(86_400).default(300),
  timeoutMs: z.number().int().min(1000).max(30_000).default(10_000),
  expectStatus: z.number().int().min(100).max(599).nullable().optional(),
  keyword: z.string().max(200).nullable().optional(),
  public: z.boolean().default(false),
  enabled: z.boolean().default(true),
});
const ChannelBody = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(CHANNEL_KINDS),
  config: z.record(z.string().max(64), z.string().max(1000)).default({}),
  secretId: z.string().uuid().nullable().optional(),
  events: z.array(z.enum(EVENTS)).max(EVENTS.length).default(["monitor.down", "monitor.up", "deploy.failed"]),
  enabled: z.boolean().default(true),
});
const RANGES: Record<string, { interval: string; bucket: "hour" | "day"; points: number }> = {
  "24h": { interval: "24 hours", bucket: "hour", points: 24 },
  "7d": { interval: "7 days", bucket: "day", points: 7 },
  "30d": { interval: "30 days", bucket: "day", points: 30 },
};

export const monitoringRoutes: FastifyPluginAsync = async (app) => {
  const { db, config } = app.deps;

  // ------------------------------------------------------------------ monitors
  app.get("/monitors", async (req) => {
    const a = requirePerm(req, "projects.read");
    const rows = await db.query<{ id: string }>(
      `SELECT m.id, m.name, m.url, m.method, m.interval_s, m.timeout_ms, m.expect_status, m.keyword, m.public, m.enabled, m.state, m.last_checked_at,
        (SELECT json_agg(json_build_object('at', c.at, 'ok', c.ok, 'ms', c.ms, 'status', c.status) ORDER BY c.at) FROM (SELECT at, ok, ms, status FROM monitor_checks WHERE monitor_id = m.id ORDER BY at DESC LIMIT 48) c) AS recent
       FROM monitors m WHERE m.workspace_id = $1 ORDER BY m.created_at`,
      [a.workspaceId],
    );
    const out = [];
    for (const r of rows) out.push({ ...r, summary: await uptimeSummary(app.deps, r.id, 30) });
    return { monitors: out };
  });

  const guardUrl = (url: string) => {
    try {
      assertSafeUrl(url, config.allowPrivateNetwork);
    } catch (e) {
      throw badRequest((e as Error).message);
    }
  };

  app.post("/monitors", async (req) => {
    const a = requirePerm(req, "monitoring.manage");
    const b = parse(MonitorBody, req.body);
    guardUrl(b.url);
    const id = crypto.randomUUID();
    await db.query(`INSERT INTO monitors (id, workspace_id, name, url, method, interval_s, timeout_ms, expect_status, keyword, public, enabled) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [id, a.workspaceId, b.name, b.url, b.method, b.intervalS, b.timeoutMs, b.expectStatus ?? null, b.keyword ?? null, b.public, b.enabled]);
    await audit(db, req, "monitor.create", { targetType: "monitor", targetId: id, meta: { url: b.url } });
    return { id };
  });

  app.put("/monitors/:id", async (req) => {
    const a = requirePerm(req, "monitoring.manage");
    const b = parse(MonitorBody, req.body);
    guardUrl(b.url);
    const row = await db.one(`UPDATE monitors SET name=$3, url=$4, method=$5, interval_s=$6, timeout_ms=$7, expect_status=$8, keyword=$9, public=$10, enabled=$11 WHERE id=$1 AND workspace_id=$2 RETURNING id`, [(req.params as { id: string }).id, a.workspaceId, b.name, b.url, b.method, b.intervalS, b.timeoutMs, b.expectStatus ?? null, b.keyword ?? null, b.public, b.enabled]);
    if (!row) throw notFound("Monitor not found");
    return { ok: true };
  });

  app.delete("/monitors/:id", async (req) => {
    const a = requirePerm(req, "monitoring.manage");
    const row = await db.one(`DELETE FROM monitors WHERE id=$1 AND workspace_id=$2 RETURNING id`, [(req.params as { id: string }).id, a.workspaceId]);
    if (!row) throw notFound("Monitor not found");
    await audit(db, req, "monitor.delete", { targetType: "monitor", targetId: (req.params as { id: string }).id });
    return { ok: true };
  });

  app.post("/monitors/:id/check", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const a = requirePerm(req, "monitoring.manage");
    const m = await db.one<Parameters<typeof recordCheck>[1]>(`SELECT id, workspace_id, name, url, method, interval_s, timeout_ms, expect_status, keyword, state, fail_streak FROM monitors WHERE id = $1 AND workspace_id = $2`, [(req.params as { id: string }).id, a.workspaceId]);
    if (!m) throw notFound("Monitor not found");
    const r = await checkOnce(app.deps, m);
    const state = await recordCheck(app.deps, m, r);
    return { ...r, state };
  });

  app.get("/incidents", async (req) => {
    const a = requirePerm(req, "projects.read");
    return { incidents: await db.query(`SELECT i.id, i.title, i.cause, i.started_at, i.resolved_at, i.monitor_id FROM incidents i WHERE i.workspace_id = $1 ORDER BY i.started_at DESC LIMIT 50`, [a.workspaceId]) };
  });

  // ------------------------------------------------------------------ status page
  app.get("/status-page", async (req) => {
    const a = requirePerm(req, "projects.read");
    return { page: await db.one(`SELECT slug, title, description, enabled FROM status_pages WHERE workspace_id = $1`, [a.workspaceId]) };
  });
  app.put("/status-page", async (req) => {
    const a = requirePerm(req, "monitoring.manage");
    const b = parse(z.object({ slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,40}$/, "Use 2–41 lowercase letters, digits or dashes"), title: z.string().trim().min(1).max(80), description: z.string().max(400).default(""), enabled: z.boolean().default(true) }), req.body);
    const taken = await db.one(`SELECT workspace_id FROM status_pages WHERE slug = $1 AND workspace_id <> $2`, [b.slug, a.workspaceId]);
    if (taken) throw badRequest("That address is taken");
    await db.query(`INSERT INTO status_pages (workspace_id, slug, title, description, enabled) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (workspace_id) DO UPDATE SET slug=$2, title=$3, description=$4, enabled=$5`, [a.workspaceId, b.slug, b.title, b.description, b.enabled]);
    return { ok: true, url: `${config.publicUrl}/status/${b.slug}` };
  });

  // ------------------------------------------------------------------ analytics
  app.get("/sites", async (req) => {
    const a = requirePerm(req, "projects.read");
    return { sites: await db.query(`SELECT id, name, key, domains, project_id, created_at FROM analytics_sites WHERE workspace_id = $1 ORDER BY created_at`, [a.workspaceId]), collectUrl: `${config.publicUrl}/api/collect.js` };
  });
  app.post("/sites", async (req) => {
    const a = requirePerm(req, "monitoring.manage");
    const b = parse(z.object({ name: z.string().trim().min(1).max(80), domains: z.array(z.string().trim().toLowerCase().max(253)).max(20).default([]), projectId: z.string().uuid().nullable().optional() }), req.body);
    const id = crypto.randomUUID();
    const key = `site_${crypto.randomBytes(9).toString("base64url")}`;
    await db.query(`INSERT INTO analytics_sites (id, workspace_id, name, key, domains, project_id) VALUES ($1,$2,$3,$4,$5,$6)`, [id, a.workspaceId, b.name, key, b.domains, b.projectId ?? null]);
    return { id, key };
  });
  app.delete("/sites/:id", async (req) => {
    const a = requirePerm(req, "monitoring.manage");
    const row = await db.one(`DELETE FROM analytics_sites WHERE id=$1 AND workspace_id=$2 RETURNING id`, [(req.params as { id: string }).id, a.workspaceId]);
    if (!row) throw notFound("Site not found");
    return { ok: true };
  });

  app.get("/sites/:id/stats", async (req) => {
    const a = requirePerm(req, "projects.read");
    const { id } = req.params as { id: string };
    const range = RANGES[(req.query as { range?: string }).range ?? "7d"] ?? RANGES["7d"];
    const site = await db.one(`SELECT id FROM analytics_sites WHERE id = $1 AND workspace_id = $2`, [id, a.workspaceId]);
    if (!site) throw notFound("Site not found");
    const since = `now() - interval '${range.interval}'`;
    const [totals] = await db.query<{ views: string; visitors: string; errors: string; events: string }>(
      `SELECT count(*) FILTER (WHERE type='pageview') AS views, count(DISTINCT visitor) FILTER (WHERE type='pageview') AS visitors, count(*) FILTER (WHERE type='error') AS errors, count(*) FILTER (WHERE type='event') AS events FROM analytics_events WHERE site_id = $1 AND ts >= ${since}`,
      [id],
    );
    const series = await db.query<{ t: string; views: string; visitors: string }>(
      `SELECT to_char(date_trunc('${range.bucket}', ts), 'YYYY-MM-DD"T"HH24:00') AS t, count(*) AS views, count(DISTINCT visitor) AS visitors FROM analytics_events WHERE site_id = $1 AND type = 'pageview' AND ts >= ${since} GROUP BY 1 ORDER BY 1`,
      [id],
    );
    const top = async (col: string, type = "pageview", limit = 8) =>
      (await db.query<{ k: string | null; n: string }>(`SELECT ${col} AS k, count(*) AS n FROM analytics_events WHERE site_id = $1 AND type = '${type}' AND ts >= ${since} GROUP BY 1 ORDER BY 2 DESC LIMIT ${limit}`, [id])).map((r) => ({ key: r.k ?? "(none)", count: Number(r.n) }));
    const vitals = await db.query<{ name: string; p75: string; n: string }>(
      `SELECT name, percentile_cont(0.75) WITHIN GROUP (ORDER BY value) AS p75, count(*) AS n FROM analytics_events WHERE site_id = $1 AND type = 'vital' AND ts >= ${since} AND value IS NOT NULL GROUP BY name`,
      [id],
    );
    const errors = await db.query<{ name: string; n: string; last: string; stack: string | null; path: string | null }>(
      `SELECT name, count(*) AS n, max(ts) AS last, (array_agg(meta->>'stack' ORDER BY ts DESC))[1] AS stack, (array_agg(path ORDER BY ts DESC))[1] AS path FROM analytics_events WHERE site_id = $1 AND type = 'error' AND ts >= ${since} GROUP BY name ORDER BY 2 DESC LIMIT 20`,
      [id],
    );
    return {
      range: (req.query as { range?: string }).range ?? "7d",
      totals: { views: Number(totals?.views ?? 0), visitors: Number(totals?.visitors ?? 0), errors: Number(totals?.errors ?? 0), events: Number(totals?.events ?? 0) },
      series: series.map((s) => ({ t: s.t, views: Number(s.views), visitors: Number(s.visitors) })),
      pages: await top("path"),
      referrers: await top("referrer"),
      devices: await top("device"),
      browsers: await top("browser"),
      countries: await top("country"),
      events: await top("name", "event"),
      vitals: vitals.map((v) => ({ name: v.name, p75: Number(v.p75), samples: Number(v.n) })),
      errors: errors.map((e) => ({ message: e.name, count: Number(e.n), last: e.last, stack: e.stack, path: e.path })),
    };
  });

  // ------------------------------------------------------------------ notification channels
  app.get("/channels", async (req) => {
    const a = requirePerm(req, "projects.read");
    return { channels: await db.query(`SELECT c.id, c.name, c.kind, c.config, c.secret_id, c.events, c.enabled, s.name AS secret_name FROM notification_channels c LEFT JOIN secrets s ON s.id = c.secret_id WHERE c.workspace_id = $1 ORDER BY c.created_at`, [a.workspaceId]), events: EVENTS };
  });
  const checkSecret = async (ws: string, id?: string | null) => {
    if (id && !(await db.one(`SELECT id FROM secrets WHERE id = $1 AND workspace_id = $2`, [id, ws]))) throw badRequest("That secret isn't in this workspace's vault");
  };
  app.post("/channels", async (req) => {
    const a = requirePerm(req, "notifications.manage");
    const b = parse(ChannelBody, req.body);
    await checkSecret(a.workspaceId, b.secretId);
    if (b.kind === "webhook") guardUrl(b.config.url ?? "");
    const id = crypto.randomUUID();
    await db.query(`INSERT INTO notification_channels (id, workspace_id, name, kind, config, secret_id, events, enabled) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, a.workspaceId, b.name, b.kind, JSON.stringify(b.config), b.secretId ?? null, b.events, b.enabled]);
    await audit(db, req, "channel.create", { targetType: "channel", targetId: id, meta: { kind: b.kind } });
    return { id };
  });
  app.put("/channels/:id", async (req) => {
    const a = requirePerm(req, "notifications.manage");
    const b = parse(ChannelBody, req.body);
    await checkSecret(a.workspaceId, b.secretId);
    const row = await db.one(`UPDATE notification_channels SET name=$3, kind=$4, config=$5, secret_id=$6, events=$7, enabled=$8 WHERE id=$1 AND workspace_id=$2 RETURNING id`, [(req.params as { id: string }).id, a.workspaceId, b.name, b.kind, JSON.stringify(b.config), b.secretId ?? null, b.events, b.enabled]);
    if (!row) throw notFound("Channel not found");
    return { ok: true };
  });
  app.delete("/channels/:id", async (req) => {
    const a = requirePerm(req, "notifications.manage");
    const row = await db.one(`DELETE FROM notification_channels WHERE id=$1 AND workspace_id=$2 RETURNING id`, [(req.params as { id: string }).id, a.workspaceId]);
    if (!row) throw notFound("Channel not found");
    return { ok: true };
  });
  app.post("/channels/:id/test", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const a = requirePerm(req, "notifications.manage");
    const ch = await db.one<{ id: string; kind: (typeof CHANNEL_KINDS)[number]; name: string; config: Record<string, string>; secret_id: string | null }>(`SELECT id, kind, name, config, secret_id FROM notification_channels WHERE id = $1 AND workspace_id = $2`, [(req.params as { id: string }).id, a.workspaceId]);
    if (!ch) throw notFound("Channel not found");
    try {
      await sendToChannel(app.deps, ch, "test", { title: "Test notification", text: "If you can read this, the channel works.", url: config.publicUrl, level: "info" });
      return { ok: true };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  });
};
