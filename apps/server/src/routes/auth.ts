import crypto from "node:crypto";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { parse, requireUser, HttpError } from "../lib/http.js";
import { randomToken, sha256 } from "../lib/vaultCrypto.js";
import { audit } from "../lib/audit.js";
import type { Db } from "../db.js";

export const SESSION_COOKIE = "mfc_session";
const LINK_TTL_MIN = 15;
const SESSION_TTL_DAYS = 30;

const EmailBody = z.object({ email: z.string().trim().toLowerCase().email().max(254) });
const VerifyBody = z.object({ token: z.string().min(20).max(200) });
const CodeBody = z.object({ email: z.string().trim().toLowerCase().email().max(254), code: z.string().trim().regex(/^\d{6}$/) });
const MAX_CODE_ATTEMPTS = 5;
/** The code is bound to the email so a guessed code is useless for another address. */
const codeHash = (email: string, code: string) => sha256(`code:${email}:${code}`);
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
      // A 6-digit code works where the link can't: the desktop and mobile apps, or another device.
      const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
      await db.query(`INSERT INTO magic_links (token_hash, email, expires_at, code_hash) VALUES ($1, $2, now() + ($3 || ' minutes')::interval, $4)`, [
        sha256(token),
        email,
        String(LINK_TTL_MIN),
        codeHash(email, code),
      ]);
      const link = `${config.publicUrl}/auth/verify?token=${encodeURIComponent(token)}`;
      const sent = await mailer
        .send(
          email,
          "Your sign-in link",
          `Sign in to Multi-functional Creator:\n\n${link}\n\nOr enter this code in the app: ${code}\n\nThe link and code expire in ${LINK_TTL_MIN} minutes and can be used once. If you did not request them, ignore this email.`,
          `<p>Sign in to <b>Multi-functional Creator</b>:</p><p><a href="${link}">Sign in</a></p><p>Or enter this code in the desktop or mobile app:</p><p style="font-size:28px;letter-spacing:6px;font-weight:700;font-family:monospace">${code}</p><p style="color:#666">The link and code expire in ${LINK_TTL_MIN} minutes and can be used once. If you did not request them, ignore this email.</p>`,
        )
        .catch((e) => {
          app.log.error(e, "magic link email failed");
          return false;
        });
      if (!sent && config.magicLinkConsole) app.log.warn(`[magic-link] ${email}: ${link} (code ${code})`);
      // In development without SMTP, hand the link to the UI so a single developer can sign in.
      const devLink = !sent && config.env !== "production" ? link : undefined;
      if (!sent && !devLink && !config.magicLinkConsole) throw new HttpError(503, "Email delivery is not configured (set SMTP_URL)", "mail_unconfigured");
      return { ok: true, delivered: sent, devLink, devCode: devLink ? code : undefined };
    },
  );

  type Tx = Pick<Db, "query" | "one">;
  /** Find or create the user (with a first workspace) and open a session. */
  const openSession = async (t: Tx, email: string, userAgent: string) => {
    let user = await t.one<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email]);
    let isNew = false;
    if (!user) {
      isNew = true;
      user = { id: crypto.randomUUID() };
      await t.query(`INSERT INTO users (id, email) VALUES ($1, $2)`, [user.id, email]);
    }
    await t.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]);
    const hasWs = await t.one(`SELECT 1 FROM memberships WHERE user_id = $1 LIMIT 1`, [user.id]);
    if (!hasWs) {
      const wsId = crypto.randomUUID();
      const wsName = `${email.split("@")[0]}'s workspace`;
      // With SaaS billing on, new workspaces start on the Free plan.
      await t.query(`INSERT INTO workspaces (id, name, created_by, plan) VALUES ($1, $2, $3, $4)`, [wsId, wsName, user.id, config.billing.stripeKey ? "free" : "team"]);
      await t.query(`INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, [wsId, user.id]);
      await t.query(`INSERT INTO ai_settings (workspace_id) VALUES ($1)`, [wsId]);
    }
    const session = randomToken(32);
    await t.query(`INSERT INTO sessions (token_hash, id, user_id, expires_at, user_agent) VALUES ($1, substr($1, 1, 16), $2, now() + ($3 || ' days')::interval, $4)`, [
      sha256(session),
      user.id,
      String(SESSION_TTL_DAYS),
      userAgent.slice(0, 300),
    ]);
    return { userId: user.id, session, isNew };
  };
  const finish = async (req: FastifyRequest, reply: FastifyReply, result: { userId: string; session: string; isNew: boolean }, method: string) => {
    await audit(db, req, "auth.login", { userId: result.userId, meta: { newUser: result.isNew, method } });
    reply.setCookie(SESSION_COOKIE, result.session, {
      httpOnly: true,
      sameSite: "lax",
      secure: config.cookieSecure,
      path: "/",
      maxAge: SESSION_TTL_DAYS * 86400,
    });
    return { ok: true, isNew: result.isNew };
  };

  app.post("/verify", { config: { rateLimit: { max: 20, timeWindow: "15 minutes" } } }, async (req, reply) => {
    const { token } = parse(VerifyBody, req.body);
    const result = await db.tx(async (t) => {
      const link = await t.one<{ email: string }>(
        `UPDATE magic_links SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING email`,
        [sha256(token)],
      );
      if (!link) return null;
      return openSession(t, link.email, String(req.headers["user-agent"] ?? ""));
    });
    if (!result) throw new HttpError(400, "This sign-in link is invalid, expired or already used. Request a new one.", "invalid_link");
    return finish(req, reply, result, "link");
  });

  /** Sign in with the 6-digit code from the email (desktop and mobile apps, other devices). */
  app.post("/verify-code", { config: { rateLimit: { max: 20, timeWindow: "15 minutes" } } }, async (req, reply) => {
    const { email, code } = parse(CodeBody, req.body);
    const outcome = await db.tx(async (t) => {
      // Only the newest unused code for this address counts, and it allows a few attempts.
      const link = await t.one<{ token_hash: string; code_hash: string | null; attempts: number }>(
        `SELECT token_hash, code_hash, attempts FROM magic_links WHERE email = $1 AND used_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [email],
      );
      if (!link?.code_hash || link.attempts >= MAX_CODE_ATTEMPTS) return { error: "expired" as const };
      const ok = crypto.timingSafeEqual(Buffer.from(link.code_hash), Buffer.from(codeHash(email, code)));
      if (!ok) {
        const n = link.attempts + 1;
        // Burn the link after too many wrong guesses.
        await t.query(`UPDATE magic_links SET attempts = $2::int, used_at = CASE WHEN $2::int >= $3::int THEN now() ELSE used_at END WHERE token_hash = $1`, [link.token_hash, n, MAX_CODE_ATTEMPTS]);
        return { error: "wrong" as const, left: MAX_CODE_ATTEMPTS - n };
      }
      await t.query(`UPDATE magic_links SET used_at = now() WHERE token_hash = $1`, [link.token_hash]);
      return { result: await openSession(t, email, String(req.headers["user-agent"] ?? "")) };
    });
    if ("error" in outcome) {
      if (outcome.error === "wrong" && outcome.left > 0) throw new HttpError(400, `That code isn't right. ${outcome.left} attempt(s) left.`, "invalid_code");
      throw new HttpError(400, "This code has expired or was used too many times. Request a new one.", "code_expired");
    }
    return finish(req, reply, outcome.result, "code");
  });

  app.post("/logout", async (req, reply) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) await db.query(`DELETE FROM sessions WHERE token_hash = $1`, [sha256(token)]);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  /** Active sessions of the signed-in user (devices), so they can sign out other devices. */
  app.get("/sessions", async (req) => {
    const user = requireUser(req);
    const current = sha256(req.cookies?.[SESSION_COOKIE] ?? "").slice(0, 16);
    const sessions = await db.query<{ id: string; user_agent: string | null; created_at: string; last_seen_at: string; expires_at: string }>(
      `SELECT id, user_agent, created_at, last_seen_at, expires_at FROM sessions WHERE user_id = $1 AND expires_at > now() ORDER BY last_seen_at DESC`,
      [user.id],
    );
    return { sessions: sessions.map((s) => ({ ...s, current: s.id === current })) };
  });

  app.delete("/sessions/:id", async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const row = await db.one(`DELETE FROM sessions WHERE id = $1 AND user_id = $2 RETURNING id`, [id, user.id]);
    if (!row) throw new HttpError(404, "Session not found", "not_found");
    await audit(db, req, "auth.session.revoke", { meta: { session: id } });
    return { ok: true };
  });

  app.post("/sessions/revoke-others", async (req) => {
    const user = requireUser(req);
    const current = sha256(req.cookies?.[SESSION_COOKIE] ?? "");
    const rows = await db.query(`DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2 RETURNING id`, [user.id, current]);
    await audit(db, req, "auth.session.revoke_others", { meta: { count: rows.length } });
    return { ok: true, revoked: rows.length };
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
