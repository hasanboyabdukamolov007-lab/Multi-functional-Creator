import crypto from "node:crypto";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import { parse, requirePerm, requireUser, notFound, badRequest, HttpError } from "../lib/http.js";
import { audit } from "../lib/audit.js";
import { notifyUser } from "../lib/push.js";
import { assertLimit } from "../lib/billing.js";

const COLORS = ["#e5484d", "#f76b15", "#ffc53d", "#30a46c", "#12a594", "#0090ff", "#6e56cf", "#d6409f"];
const colorFor = (id: string) => COLORS[parseInt(crypto.createHash("md5").update(id).digest("hex").slice(0, 6), 16) % COLORS.length];

/** Snapshot a project's current data into its version history. */
export async function snapshot(db: { query: (sql: string, params?: unknown[]) => Promise<unknown[]> }, projectId: string, workspaceId: string, userId: string | null, label: string | null, auto: boolean) {
  await db.query(
    `INSERT INTO project_versions (id, project_id, workspace_id, version, label, auto, data, created_by) SELECT $1, id, workspace_id, version, $3, $4, data, $5 FROM projects WHERE id = $2 AND workspace_id = $6`,
    [crypto.randomUUID(), projectId, label, auto, userId, workspaceId],
  );
  if (auto) await db.query(`DELETE FROM project_versions WHERE project_id = $1 AND auto AND id NOT IN (SELECT id FROM project_versions WHERE project_id = $1 AND auto ORDER BY created_at DESC LIMIT 50)`, [projectId]);
}

export const collabRoutes: FastifyPluginAsync = async (app) => {
  const { db, mailer, config } = app.deps;

  const project = async (ws: string, id: string) => {
    const p = await db.one<{ id: string; name: string; kind: string; version: number; branch_of: string | null; branch_name: string | null }>(`SELECT id, name, kind, version, branch_of, branch_name FROM projects WHERE id = $1 AND workspace_id = $2`, [id, ws]);
    if (!p) throw notFound("Project not found");
    return p;
  };

  // ------------------------------------------------------------------ presence + live events
  app.post("/projects/:id/presence", { config: { rateLimit: { max: 240, timeWindow: "1 minute" } } }, async (req) => {
    const a = requirePerm(req, "projects.read");
    const { id } = req.params as { id: string };
    await project(a.workspaceId, id);
    const b = parse(z.object({ selection: z.string().max(80).nullable().optional(), cursor: z.object({ x: z.number(), y: z.number() }).nullable().optional() }), req.body ?? {});
    const u = req.user!;
    await db.query(
      `INSERT INTO presence (project_id, user_id, workspace_id, name, color, selection, cursor, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now())
       ON CONFLICT (project_id, user_id) DO UPDATE SET selection = EXCLUDED.selection, cursor = EXCLUDED.cursor, name = EXCLUDED.name, updated_at = now()`,
      [id, u.id, a.workspaceId, u.name || u.email.split("@")[0], colorFor(u.id), b.selection ?? null, b.cursor ? JSON.stringify(b.cursor) : null],
    );
    return { ok: true };
  });
  app.delete("/projects/:id/presence", async (req) => {
    const a = requirePerm(req, "projects.read");
    await db.query(`DELETE FROM presence WHERE project_id = $1 AND user_id = $2 AND workspace_id = $3`, [(req.params as { id: string }).id, req.user!.id, a.workspaceId]);
    return { ok: true };
  });

  /**
   * Server-sent events for one project: who else is here (and what they selected), new versions saved by
   * others, and comment activity. Polls the database every 1.5 s so it works across serverless instances;
   * the stream ends after ~50 s and EventSource reconnects automatically.
   */
  app.get("/projects/:id/live", async (req, reply: FastifyReply) => {
    const a = requirePerm(req, "projects.read");
    const { id } = req.params as { id: string };
    await project(a.workspaceId, id);
    const me = req.user!.id;
    reply.raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
    const send = (event: string, data: unknown) => reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    let closed = false;
    req.raw.on("close", () => (closed = true));
    let last = { presence: "", version: -1, comments: "" };
    const started = Date.now();
    send("hello", { retry: 1000 });
    reply.raw.write("retry: 1000\n\n");
    while (!closed && Date.now() - started < 50_000) {
      const others = await db.query<{ user_id: string; name: string; color: string; selection: string | null; cursor: unknown }>(`SELECT user_id, name, color, selection, cursor FROM presence WHERE project_id = $1 AND user_id <> $2 AND updated_at > now() - interval '35 seconds' ORDER BY name`, [id, me]);
      const p = JSON.stringify(others);
      if (p !== last.presence) send("presence", others);
      const v = await db.one<{ version: number; updated_at: string }>(`SELECT version, updated_at FROM projects WHERE id = $1`, [id]);
      if (v && last.version !== -1 && v.version !== last.version) send("version", v);
      const c = await db.one<{ n: string; last: string | null }>(`SELECT count(*) AS n, max(updated_at) AS last FROM comments WHERE project_id = $1 AND NOT resolved`, [id]);
      const cs = `${c?.n}|${c?.last}`;
      if (last.comments && cs !== last.comments) send("comments", { open: Number(c?.n ?? 0) });
      last = { presence: p, version: v?.version ?? -1, comments: cs };
      await new Promise((r) => setTimeout(r, 1500));
    }
    reply.raw.end();
    return reply;
  });

  // ------------------------------------------------------------------ comments + mentions
  app.get("/projects/:id/comments", async (req) => {
    const a = requirePerm(req, "projects.read");
    const { id } = req.params as { id: string };
    await project(a.workspaceId, id);
    return {
      comments: await db.query(`SELECT c.id, c.node_id, c.parent_id, c.body, c.mentions, c.resolved, c.created_at, c.updated_at, c.author_id, coalesce(u.name, split_part(u.email, '@', 1)) AS author FROM comments c LEFT JOIN users u ON u.id = c.author_id WHERE c.project_id = $1 ORDER BY c.created_at`, [id]),
    };
  });
  app.post("/projects/:id/comments", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) => {
    const a = requirePerm(req, "comments.write");
    const { id } = req.params as { id: string };
    const p = await project(a.workspaceId, id);
    const b = parse(z.object({ body: z.string().trim().min(1).max(4000), nodeId: z.string().max(80).nullable().optional(), parentId: z.string().uuid().nullable().optional() }), req.body);
    // @mentions: @name, @email or @email-local-part of workspace members.
    const members = await db.query<{ id: string; email: string; name: string | null }>(`SELECT u.id, u.email, u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1`, [a.workspaceId]);
    const tags = [...b.body.matchAll(/@([\p{L}\p{N}._%+-]+(?:@[\w.-]+\.\w+)?)/gu)].map((m) => m[1].toLowerCase());
    const mentioned = members.filter((m) => m.id !== req.user!.id && tags.some((t) => t === m.email.toLowerCase() || t === m.email.split("@")[0].toLowerCase() || (m.name && t === m.name.toLowerCase().replace(/\s+/g, ""))));
    const cid = crypto.randomUUID();
    await db.query(`INSERT INTO comments (id, workspace_id, project_id, node_id, parent_id, author_id, body, mentions) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [cid, a.workspaceId, id, b.nodeId ?? null, b.parentId ?? null, req.user!.id, b.body, mentioned.map((m) => m.id)]);
    const who = req.user!.name || req.user!.email;
    const link = `/${p.kind === "scene3d" ? "studio" : p.kind === "api" || p.kind === "db" ? "data" : "builder"}?project=${id}&comment=${cid}`;
    // Notify mentioned people, plus the parent comment's author on replies.
    const notifyIds = new Set(mentioned.map((m) => m.id));
    if (b.parentId) {
      const parent = await db.one<{ author_id: string | null }>(`SELECT author_id FROM comments WHERE id = $1 AND project_id = $2`, [b.parentId, id]);
      if (parent?.author_id && parent.author_id !== req.user!.id) notifyIds.add(parent.author_id);
    }
    for (const uid of notifyIds) {
      const m = members.find((x) => x.id === uid);
      const isMention = mentioned.some((x) => x.id === uid);
      await notifyUser(app.deps, { userId: uid, workspaceId: a.workspaceId, kind: isMention ? "mention" : "reply", title: `${who} ${isMention ? "mentioned you" : "replied"} in ${p.name}`, body: b.body.slice(0, 280), link });
      if (m) void mailer.send(m.email, `${who} mentioned you in ${p.name}`, `${b.body}\n\nOpen: ${config.publicUrl}${link}`).catch(() => undefined);
    }
    await audit(db, req, "comment.create", { targetType: "project", targetId: id, meta: { mentions: mentioned.length } });
    return { id: cid, mentioned: mentioned.map((m) => m.email) };
  });
  app.patch("/comments/:cid", async (req) => {
    const a = requirePerm(req, "comments.write");
    const { cid } = req.params as { cid: string };
    const b = parse(z.object({ resolved: z.boolean().optional(), body: z.string().trim().min(1).max(4000).optional() }), req.body);
    const c = await db.one<{ author_id: string | null }>(`SELECT author_id FROM comments WHERE id = $1 AND workspace_id = $2`, [cid, a.workspaceId]);
    if (!c) throw notFound("Comment not found");
    if (b.body !== undefined && c.author_id !== req.user!.id) throw new HttpError(403, "Only the author can edit a comment");
    await db.query(`UPDATE comments SET resolved = coalesce($2, resolved), body = coalesce($3, body), updated_at = now() WHERE id = $1`, [cid, b.resolved ?? null, b.body ?? null]);
    return { ok: true };
  });
  app.delete("/comments/:cid", async (req) => {
    const a = requirePerm(req, "comments.write");
    const { cid } = req.params as { cid: string };
    const c = await db.one<{ author_id: string | null }>(`SELECT author_id FROM comments WHERE id = $1 AND workspace_id = $2`, [cid, a.workspaceId]);
    if (!c) throw notFound("Comment not found");
    if (c.author_id !== req.user!.id && !["owner", "admin"].includes(a.role)) throw new HttpError(403, "Only the author or an admin can delete a comment");
    await db.query(`DELETE FROM comments WHERE id = $1`, [cid]);
    return { ok: true };
  });

  app.get("/comments/recent", async (req) => {
    const a = requirePerm(req, "projects.read");
    return {
      comments: await db.query(
        `SELECT c.id, c.project_id, p.name AS project, p.kind, c.body, c.resolved, c.created_at, coalesce(u.name, split_part(u.email, '@', 1)) AS author
         FROM comments c JOIN projects p ON p.id = c.project_id LEFT JOIN users u ON u.id = c.author_id WHERE c.workspace_id = $1 ORDER BY c.created_at DESC LIMIT 50`,
        [a.workspaceId],
      ),
      online: await db.query(`SELECT pr.user_id, pr.name, pr.color, pr.project_id, p.name AS project, p.kind FROM presence pr JOIN projects p ON p.id = pr.project_id WHERE pr.workspace_id = $1 AND pr.updated_at > now() - interval '35 seconds' ORDER BY pr.name`, [a.workspaceId]),
    };
  });

  // ------------------------------------------------------------------ versions & branches
  app.get("/projects/:id/versions", async (req) => {
    const a = requirePerm(req, "projects.read");
    const { id } = req.params as { id: string };
    await project(a.workspaceId, id);
    return { versions: await db.query(`SELECT v.id, v.version, v.label, v.auto, v.created_at, coalesce(u.name, split_part(u.email, '@', 1)) AS author, length(v.data::text) AS size FROM project_versions v LEFT JOIN users u ON u.id = v.created_by WHERE v.project_id = $1 ORDER BY v.created_at DESC LIMIT 100`, [id]) };
  });
  app.get("/projects/:id/versions/:vid", async (req) => {
    const a = requirePerm(req, "projects.read");
    const { id, vid } = req.params as { id: string; vid: string };
    const v = await db.one(`SELECT id, version, label, data, created_at FROM project_versions WHERE id = $1 AND project_id = $2 AND workspace_id = $3`, [vid, id, a.workspaceId]);
    if (!v) throw notFound("Version not found");
    return { version: v };
  });
  app.post("/projects/:id/versions", async (req) => {
    const a = requirePerm(req, "projects.write");
    const { id } = req.params as { id: string };
    await project(a.workspaceId, id);
    const { label } = parse(z.object({ label: z.string().trim().min(1).max(80) }), req.body);
    await snapshot(db, id, a.workspaceId, req.user!.id, label, false);
    await audit(db, req, "project.version.save", { targetType: "project", targetId: id, meta: { label } });
    return { ok: true };
  });
  app.post("/projects/:id/versions/:vid/restore", async (req) => {
    const a = requirePerm(req, "projects.write");
    const { id, vid } = req.params as { id: string; vid: string };
    const v = await db.one<{ data: unknown; version: number; label: string | null }>(`SELECT data, version, label FROM project_versions WHERE id = $1 AND project_id = $2 AND workspace_id = $3`, [vid, id, a.workspaceId]);
    if (!v) throw notFound("Version not found");
    await snapshot(db, id, a.workspaceId, req.user!.id, "Before restore", false);
    const p = await db.one(`UPDATE projects SET data = $3, version = version + 1, updated_at = now() WHERE id = $1 AND workspace_id = $2 RETURNING version`, [id, a.workspaceId, JSON.stringify(v.data)]);
    await audit(db, req, "project.version.restore", { targetType: "project", targetId: id, meta: { from: v.version, label: v.label } });
    return { ok: true, project: p };
  });

  app.post("/projects/:id/branch", async (req) => {
    const a = requirePerm(req, "projects.write");
    const { id } = req.params as { id: string };
    const p = await project(a.workspaceId, id);
    if (p.branch_of) throw badRequest("Branch from the main project, not from another branch");
    const { name } = parse(z.object({ name: z.string().trim().min(1).max(60) }), req.body);
    await assertLimit(app.deps, a.workspaceId, "projects");
    const nid = crypto.randomUUID();
    const row = await db.one(
      `INSERT INTO projects (id, workspace_id, name, kind, data, created_by, branch_of, branch_name) SELECT $1, workspace_id, name || ' · ' || $3, kind, data, $4, id, $3 FROM projects WHERE id = $2 RETURNING id, name, kind, version`,
      [nid, id, name, req.user!.id],
    );
    await audit(db, req, "project.branch", { targetType: "project", targetId: nid, meta: { from: id, name } });
    return { project: row };
  });
  app.get("/projects/:id/branches", async (req) => {
    const a = requirePerm(req, "projects.read");
    const { id } = req.params as { id: string };
    const p = await project(a.workspaceId, id);
    const main = p.branch_of ?? id;
    return { main, branches: await db.query(`SELECT id, branch_name, version, updated_at FROM projects WHERE branch_of = $1 AND workspace_id = $2 ORDER BY updated_at DESC`, [main, a.workspaceId]) };
  });
  app.post("/projects/:id/merge", async (req) => {
    const a = requirePerm(req, "projects.write");
    const { id } = req.params as { id: string };
    const p = await project(a.workspaceId, id);
    if (!p.branch_of) throw badRequest("This project isn't a branch");
    await snapshot(db, p.branch_of, a.workspaceId, req.user!.id, `Before merging “${p.branch_name}”`, false);
    const merged = await db.one(`UPDATE projects SET data = (SELECT data FROM projects WHERE id = $1), version = version + 1, updated_at = now() WHERE id = $2 AND workspace_id = $3 RETURNING id, version`, [id, p.branch_of, a.workspaceId]);
    await audit(db, req, "project.merge", { targetType: "project", targetId: p.branch_of, meta: { branch: p.branch_name } });
    return { ok: true, project: merged };
  });
};

/** Per-user notifications (mentions, replies), across workspaces. */
export const notificationRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app.deps;
  app.get("/notifications", async (req) => {
    const u = requireUser(req);
    const items = await db.query(`SELECT id, workspace_id, kind, title, body, link, read_at, created_at FROM user_notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`, [u.id]);
    const [{ n }] = await db.query<{ n: string }>(`SELECT count(*) AS n FROM user_notifications WHERE user_id = $1 AND read_at IS NULL`, [u.id]);
    return { items, unread: Number(n) };
  });
  app.post("/notifications/read", async (req) => {
    const u = requireUser(req);
    const { ids } = parse(z.object({ ids: z.array(z.string().uuid()).max(200).optional() }), req.body ?? {});
    if (ids?.length) await db.query(`UPDATE user_notifications SET read_at = now() WHERE user_id = $1 AND id = ANY($2::uuid[]) AND read_at IS NULL`, [u.id, ids]);
    else await db.query(`UPDATE user_notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, [u.id]);
    return { ok: true };
  });
};
