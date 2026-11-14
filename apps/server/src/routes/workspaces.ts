import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ROLES, roleRank, type Role } from "@mfc/core";
import { parse, requirePerm, requireUser, forbidden, notFound, badRequest } from "../lib/http.js";
import { audit } from "../lib/audit.js";
import { assertLimit } from "../lib/billing.js";

const NameBody = z.object({ name: z.string().trim().min(1).max(80) });
const InviteBody = z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(ROLES) });
const RoleBody = z.object({ role: z.enum(ROLES) });

export const workspaceRoutes: FastifyPluginAsync = async (app) => {
  const { db, config, mailer } = app.deps;

  app.post("/workspaces", async (req) => {
    const user = requireUser(req);
    const { name } = parse(NameBody, req.body);
    const id = crypto.randomUUID();
    const plan = config.billing.stripeKey ? "free" : "team";
    await db.tx(async (t) => {
      await t.query(`INSERT INTO workspaces (id, name, created_by, plan) VALUES ($1, $2, $3, $4)`, [id, name, user.id, plan]);
      await t.query(`INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, [id, user.id]);
      await t.query(`INSERT INTO ai_settings (workspace_id) VALUES ($1)`, [id]);
    });
    await audit(db, req, "workspace.create", { workspaceId: id, targetType: "workspace", targetId: id, meta: { name } });
    return { workspace: { id, name, plan, role: "owner" } };
  });

  app.patch("/w/:workspaceId", async (req) => {
    const a = requirePerm(req, "workspace.manage");
    const { name } = parse(NameBody, req.body);
    await db.query(`UPDATE workspaces SET name = $2 WHERE id = $1`, [a.workspaceId, name]);
    await audit(db, req, "workspace.rename", { targetType: "workspace", targetId: a.workspaceId, meta: { name } });
    return { ok: true };
  });

  app.get("/w/:workspaceId/members", async (req) => {
    const a = requirePerm(req, "projects.read");
    const members = await db.query(
      `SELECT u.id, u.email, u.name, m.role, m.created_at, u.last_login_at FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1 ORDER BY m.created_at`,
      [a.workspaceId],
    );
    return { members };
  });

  app.post("/w/:workspaceId/members", async (req) => {
    const a = requirePerm(req, "members.manage");
    const { email, role } = parse(InviteBody, req.body);
    if (roleRank(role) > roleRank(a.role)) throw forbidden("You cannot grant a role higher than your own");
    await assertLimit(app.deps, a.workspaceId, "members");
    const userId = await db.tx(async (t) => {
      let u = await t.one<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email]);
      if (!u) {
        u = { id: crypto.randomUUID() };
        await t.query(`INSERT INTO users (id, email) VALUES ($1, $2)`, [u.id, email]);
      }
      const exists = await t.one(`SELECT 1 FROM memberships WHERE workspace_id = $1 AND user_id = $2`, [a.workspaceId, u.id]);
      if (exists) throw badRequest("That person is already a member");
      await t.query(`INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, $3)`, [a.workspaceId, u.id, role]);
      return u.id;
    });
    await audit(db, req, "member.invite", { targetType: "user", targetId: userId, meta: { email, role } });
    await mailer
      .send(email, "You were invited to a workspace", `You were added to a Multi-functional Creator workspace as ${role}.\nSign in at ${config.publicUrl}/login with this email address.`)
      .catch(() => false);
    return { ok: true, userId };
  });

  app.patch("/w/:workspaceId/members/:userId", async (req) => {
    const a = requirePerm(req, "members.manage");
    const { userId } = req.params as { userId: string };
    const { role } = parse(RoleBody, req.body);
    const target = await db.one<{ role: Role }>(`SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2`, [a.workspaceId, userId]);
    if (!target) throw notFound("Member not found");
    if (roleRank(target.role) > roleRank(a.role) || roleRank(role) > roleRank(a.role)) throw forbidden("You cannot change a role above your own");
    if (target.role === "owner" && role !== "owner") {
      const owners = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM memberships WHERE workspace_id = $1 AND role = 'owner'`, [a.workspaceId]);
      if ((owners?.n ?? 0) <= 1) throw badRequest("A workspace needs at least one owner");
    }
    await db.query(`UPDATE memberships SET role = $3 WHERE workspace_id = $1 AND user_id = $2`, [a.workspaceId, userId, role]);
    await audit(db, req, "member.role", { targetType: "user", targetId: userId, meta: { from: target.role, to: role } });
    return { ok: true };
  });

  app.delete("/w/:workspaceId/members/:userId", async (req) => {
    const a = requirePerm(req, "members.manage");
    const { userId } = req.params as { userId: string };
    const target = await db.one<{ role: Role }>(`SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2`, [a.workspaceId, userId]);
    if (!target) throw notFound("Member not found");
    if (roleRank(target.role) > roleRank(a.role)) throw forbidden();
    if (target.role === "owner") {
      const owners = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM memberships WHERE workspace_id = $1 AND role = 'owner'`, [a.workspaceId]);
      if ((owners?.n ?? 0) <= 1) throw badRequest("A workspace needs at least one owner");
    }
    await db.query(`DELETE FROM memberships WHERE workspace_id = $1 AND user_id = $2`, [a.workspaceId, userId]);
    await audit(db, req, "member.remove", { targetType: "user", targetId: userId });
    return { ok: true };
  });
};
