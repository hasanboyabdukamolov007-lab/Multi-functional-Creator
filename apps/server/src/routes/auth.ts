import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { parse, requireUser, HttpError } from "../lib/http.js";
import { randomToken, sha256 } from "../lib/vaultCrypto.js";
import { audit } from "../lib/audit.js";

export const SESSION_COOKIE = "mfc_session";
const LINK_TTL_MIN = 15;
const SESSION_TTL_DAYS = 30;

const EmailBody = z.object({ email: z.string().trim().toLowerCase().email().max(254) });
const VerifyBody = z.object({ token: z.string().min(20).max(200) });
const PrefsBody = z.object({
  name: z.string().trim().max(120).optional(),
  locale: z.string().max(10).optional(),
  prefs: z.record(z.string(), z.unknown()).optional(),
});

export const authRoutes: FastifyPluginAsync = async (app) => {
  const { db, config, mailer } = app.deps;

  app.post(
    "/magic-link",
    { config: { rateLimit: { max: 20, timeWindow: "15 minutes" } } },
    async (req) => {
      const { email } = parse(EmailBody, req.body);
      const recent = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM magic_links WHERE email = $1 AND created_at > now() - interval '15 minutes'`, [email]);
      if ((recent?.n ?? 0) >= 5) throw new HttpError(429, "Too many sign-in links requested for this email. Try again in a few minutes.", "rate_limited");
      const token = randomToken(32);
      await db.query(`INSERT INTO magic_links (token_hash, email, expires_at) VALUES ($1, $2, now() + ($3 || ' minutes')::interval)`, [
        sha256(token),
        email,
        String(LINK_TTL_MIN),
      ]);
      const link = `${config.publicUrl}/auth/verify?token=${encodeURIComponent(token)}`;
      const sent = await mailer
        .send(
          email,
          "Your sign-in link",
          `Sign in to Multi-functional Creator:\n\n${link}\n\nThis link expires in ${LINK_TTL_MIN} minutes and can be used once. If you did not request it, ignore this email.`,
          `<p>Sign in to <b>Multi-functional Creator</b>:</p><p><a href="${link}">Sign in</a></p><p style="color:#666">This link expires in ${LINK_TTL_MIN} minutes and can be used once. If you did not request it, ignore this email.</p>`,
        )
        .catch((e) => {
          app.log.error(e, "magic link email failed");
          return false;
        });
      if (!sent && config.magicLinkConsole) app.log.warn(`[magic-link] ${email}: ${link}`);
      // In development without SMTP, hand the link to the UI so a single developer can sign in.
      const devLink = !sent && config.env !== "production" ? link : undefined;
      if (!sent && !devLink && !config.magicLinkConsole) throw new HttpError(503, "Email delivery is not configured (set SMTP_URL)", "mail_unconfigured");
      return { ok: true, delivered: sent, devLink };
    },
  );

  app.post("/verify", { config: { rateLimit: { max: 20, timeWindow: "15 minutes" } } }, async (req, reply) => {
    const { token } = parse(VerifyBody, req.body);
    const result = await db.tx(async (t) => {
      const link = await t.one<{ email: string }>(
        `UPDATE magic_links SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING email`,
        [sha256(token)],
      );
      if (!link) return null;
      let user = await t.one<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [link.email]);
      let isNew = false;
      if (!user) {
        isNew = true;
        user = { id: crypto.randomUUID() };
        await t.query(`INSERT INTO users (id, email) VALUES ($1, $2)`, [user.id, link.email]);
      }
      await t.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]);
      const hasWs = await t.one(`SELECT 1 FROM memberships WHERE user_id = $1 LIMIT 1`, [user.id]);
      if (!hasWs) {
        const wsId = crypto.randomUUID();
        const wsName = `${link.email.split("@")[0]}'s workspace`;
        await t.query(`INSERT INTO workspaces (id, name, created_by) VALUES ($1, $2, $3)`, [wsId, wsName, user.id]);
        await t.query(`INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, [wsId, user.id]);
        await t.query(`INSERT INTO ai_settings (workspace_id) VALUES ($1)`, [wsId]);
      }
      const session = randomToken(32);
      await t.query(`INSERT INTO sessions (token_hash, user_id, expires_at, user_agent) VALUES ($1, $2, now() + ($3 || ' days')::interval, $4)`, [
        sha256(session),
        user.id,
        String(SESSION_TTL_DAYS),
        String(req.headers["user-agent"] ?? "").slice(0, 300),
      ]);
      return { userId: user.id, session, isNew };
    });
    if (!result) throw new HttpError(400, "This sign-in link is invalid, expired or already used. Request a new one.", "invalid_link");
    await audit(db, req, "auth.login", { userId: result.userId, meta: { newUser: result.isNew } });
    reply.setCookie(SESSION_COOKIE, result.session, {
      httpOnly: true,
      sameSite: "lax",
      secure: config.cookieSecure,
      path: "/",
      maxAge: SESSION_TTL_DAYS * 86400,
    });
    return { ok: true, isNew: result.isNew };
  });

  app.post("/logout", async (req, reply) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) await db.query(`DELETE FROM sessions WHERE token_hash = $1`, [sha256(token)]);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/me", async (req) => {
    // Anonymous visitors get 200 with user: null so the sign-in page doesn't log errors.
    if (!req.user) return { user: null, workspaces: [] };
    const user = requireUser(req);
    const workspaces = await db.query(
      `SELECT w.id, w.name, w.plan, m.role FROM memberships m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = $1 ORDER BY w.created_at`,
      [user.id],
    );
    return { user, workspaces };
  });

  app.patch("/me", async (req) => {
    const user = requireUser(req);
    const body = parse(PrefsBody, req.body);
    const row = await db.one(
      `UPDATE users SET name = coalesce($2, name), locale = coalesce($3, locale), prefs = CASE WHEN $4::jsonb IS NULL THEN prefs ELSE prefs || $4::jsonb END
       WHERE id = $1 RETURNING id, email, name, locale, prefs`,
      [user.id, body.name ?? null, body.locale ?? null, body.prefs ? JSON.stringify(body.prefs) : null],
    );
    return { user: row };
  });
};
