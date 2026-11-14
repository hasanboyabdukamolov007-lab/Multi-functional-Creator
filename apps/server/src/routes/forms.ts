import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { parse, requirePerm, notFound, badRequest } from "../lib/http.js";
import { sendToChannel, type ChannelKind } from "../lib/notify.js";
import { notifyUser } from "../lib/push.js";
import { audit } from "../lib/audit.js";

const STATUSES = ["new", "contacted", "won", "lost"] as const;

/** /api/w/:workspaceId — order/contact forms for client sites and the leads they collect. */
export const formRoutes: FastifyPluginAsync = async (app) => {
  const { db, config } = app.deps;
  const endpoint = (id: string) => `${config.publicUrl}/api/f/${id}`;

  app.get("/forms", async (req) => {
    const a = requirePerm(req, "projects.read");
    const rows = await db.query<{ id: string; name: string; channel_id: string | null; channel: string | null; leads: number; created_at: string }>(
      `SELECT f.id, f.name, f.channel_id, c.name AS channel, (SELECT count(*)::int FROM leads l WHERE l.form_id = f.id) AS leads, f.created_at
       FROM forms f LEFT JOIN notification_channels c ON c.id = f.channel_id WHERE f.workspace_id = $1 ORDER BY f.created_at DESC`,
      [a.workspaceId],
    );
    return { forms: rows.map((f) => ({ ...f, endpoint: endpoint(f.id) })) };
  });

  app.post("/forms", async (req) => {
    const a = requirePerm(req, "projects.write");
    const b = parse(z.object({ name: z.string().trim().min(1).max(120), channelId: z.string().uuid().nullable().optional() }), req.body);
    if (b.channelId && !(await db.one(`SELECT 1 FROM notification_channels WHERE id = $1 AND workspace_id = $2`, [b.channelId, a.workspaceId]))) throw badRequest("Unknown channel");
    const id = crypto.randomUUID();
    await db.query(`INSERT INTO forms (id, workspace_id, name, channel_id) VALUES ($1,$2,$3,$4)`, [id, a.workspaceId, b.name, b.channelId ?? null]);
    return { id, endpoint: endpoint(id) };
  });

  app.delete("/forms/:id", async (req) => {
    const a = requirePerm(req, "projects.write");
    const row = await db.one(`DELETE FROM forms WHERE id = $1 AND workspace_id = $2 RETURNING id`, [(req.params as { id: string }).id, a.workspaceId]);
    if (!row) throw notFound("Form not found");
    return { ok: true };
  });

  app.get("/leads", async (req) => {
    const a = requirePerm(req, "projects.read");
    const q = req.query as { form?: string; status?: string };
    const leads = await db.query(
      `SELECT l.id, l.form_id, f.name AS form, l.data, l.page, l.status, l.created_at FROM leads l JOIN forms f ON f.id = l.form_id
       WHERE l.workspace_id = $1 AND ($2::uuid IS NULL OR l.form_id = $2) AND ($3::text IS NULL OR l.status = $3) ORDER BY l.created_at DESC LIMIT 500`,
      [a.workspaceId, q.form && /^[0-9a-f-]{36}$/i.test(q.form) ? q.form : null, q.status && (STATUSES as readonly string[]).includes(q.status) ? q.status : null],
    );
    return { leads };
  });

  app.patch("/leads/:id", async (req) => {
    const a = requirePerm(req, "projects.write");
    const { status } = parse(z.object({ status: z.enum(STATUSES) }), req.body);
    const row = await db.one(`UPDATE leads SET status = $3 WHERE id = $1 AND workspace_id = $2 RETURNING id`, [(req.params as { id: string }).id, a.workspaceId, status]);
    if (!row) throw notFound("Lead not found");
    return { ok: true };
  });

  app.delete("/leads/:id", async (req) => {
    const a = requirePerm(req, "projects.write");
    const row = await db.one(`DELETE FROM leads WHERE id = $1 AND workspace_id = $2 RETURNING id`, [(req.params as { id: string }).id, a.workspaceId]);
    if (!row) throw notFound("Lead not found");
    await audit(db, req, "lead.delete", { targetType: "lead", targetId: (req.params as { id: string }).id });
    return { ok: true };
  });
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** POST /api/f/:id — public endpoint that sites' forms submit to (plain HTML forms or fetch). */
export const formPublicRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app.deps;
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string", bodyLimit: 64 * 1024 }, (_req, body, done) => done(null, Object.fromEntries(new URLSearchParams(String(body)))));
  app.options("/f/:id", async (_req, reply) => reply.header("access-control-allow-origin", "*").header("access-control-allow-methods", "POST").header("access-control-allow-headers", "content-type").status(204).send());

  app.post("/f/:id", { bodyLimit: 64 * 1024, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    reply.header("access-control-allow-origin", "*");
    const { id } = req.params as { id: string };
    const form = /^[0-9a-f-]{36}$/i.test(id) ? await db.one<{ id: string; workspace_id: string; name: string; channel_id: string | null }>(`SELECT id, workspace_id, name, channel_id FROM forms WHERE id = $1`, [id]) : null;
    if (!form) return reply.status(404).send({ error: "Form not found" });
    const raw = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
    const wantsHtml = String(req.headers.accept ?? "").includes("text/html");
    const referer = String(req.headers.referer ?? "");
    const back = /^https?:\/\//.test(referer) ? referer.slice(0, 500) : "";
    const thanks = () =>
      reply.type("text/html; charset=utf-8").send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rahmat!</title><body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;padding:16px;text-align:center"><div><h1 style="font-size:28px">✅ Rahmat! / Спасибо! / Thank you!</h1><p>Xabaringiz yuborildi. Tez orada bog'lanamiz.</p>${back ? `<p><a href="${esc(back)}">← Ortga / Назад / Back</a></p>` : ""}</div></body>`);
    // Bots fill the hidden field; answer as if it worked so they don't retry.
    if (raw._gotcha) return wantsHtml ? thanks() : { ok: true };
    const data: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (k.startsWith("_") || Object.keys(data).length >= 20) continue;
      const val = String(v ?? "").trim().slice(0, 2000);
      if (val) data[k.slice(0, 80)] = val;
    }
    if (!Object.keys(data).length) return reply.status(400).send({ error: "Empty form" });
    const leadId = crypto.randomUUID();
    await db.query(`INSERT INTO leads (id, form_id, workspace_id, data, page) VALUES ($1,$2,$3,$4,$5)`, [leadId, form.id, form.workspace_id, JSON.stringify(data), back || null]);
    const text = Object.entries(data).map(([k, v]) => `${k}: ${v}`).join("\n");
    const title = `Yangi buyurtma — ${form.name}`;
    // Telegram (or any alert channel) and the owners' phones; delivery problems never lose the lead.
    if (form.channel_id) {
      const ch = await db.one<{ id: string; kind: ChannelKind; name: string; config: Record<string, string>; secret_id: string | null }>(`SELECT id, kind, name, config, secret_id FROM notification_channels WHERE id = $1 AND enabled`, [form.channel_id]);
      if (ch) void sendToChannel(app.deps, { ...ch, config: { ...ch.config, workspaceId: form.workspace_id } }, "test", { title, text: `${text}${back ? `\n\n${back}` : ""}`, level: "success" }).catch((e) => app.log.warn(e, "lead notification failed"));
    }
    const owners = await db.query<{ user_id: string }>(`SELECT user_id FROM memberships WHERE workspace_id = $1 AND role IN ('owner','admin')`, [form.workspace_id]);
    for (const o of owners) await notifyUser(app.deps, { userId: o.user_id, workspaceId: form.workspace_id, kind: "lead", title, body: text.slice(0, 280), link: "/leads" });
    return wantsHtml ? thanks() : { ok: true, id: leadId };
  });
};
