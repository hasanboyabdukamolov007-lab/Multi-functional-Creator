import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { Role } from "@mfc/core";
import type { Config } from "./config.js";
import { openDb, type Db } from "./db.js";
import { loadKeyRing, sha256, type MasterKeyRing } from "./lib/vaultCrypto.js";
import { createMailer, type Mailer } from "./lib/mailer.js";
import { HttpError } from "./lib/http.js";
import { authRoutes, SESSION_COOKIE } from "./routes/auth.js";
import { workspaceRoutes } from "./routes/workspaces.js";
import { projectRoutes } from "./routes/projects.js";
import { secretRoutes } from "./routes/secrets.js";
import { auditRoutes } from "./routes/audit.js";
import { aiRoutes } from "./routes/ai.js";
import { httpRoutes } from "./routes/http.js";
import { dataRoutes } from "./routes/data.js";
import { workflowRoutes } from "./routes/workflows.js";
import { publicRoutes } from "./routes/public.js";
import { forgeRoutes } from "./routes/forge.js";
import { deployRoutes } from "./routes/deploy.js";
import { monitoringRoutes } from "./routes/monitoring.js";
import { assetPublicRoutes, assetRoutes, brandRoutes } from "./routes/assets.js";
import { collabRoutes, notificationRoutes } from "./routes/collab.js";
import { marketRoutes } from "./routes/market.js";
import { billingRoutes, billingWebhookRoutes } from "./routes/billing.js";
import { pushRoutes } from "./routes/push.js";
import { githubRoutes } from "./routes/github.js";
import { formPublicRoutes, formRoutes } from "./routes/forms.js";
import { telegramRoutes } from "./routes/telegram.js";
import { startScheduler } from "./lib/workflows.js";

export interface AppDeps {
  config: Config;
  db: Db;
  ring: MasterKeyRing;
  mailer: Mailer;
}

declare module "fastify" {
  interface FastifyInstance {
    deps: AppDeps;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const APP_VERSION = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? process.env.APP_VERSION ?? "dev";

export async function buildApp(config: Config, injected: Partial<AppDeps> = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.env === "test" ? false : { level: config.env === "production" ? "info" : "debug", redact: ["req.headers.cookie", "req.headers.authorization"] },
    bodyLimit: 32 * 1024 * 1024, // 3D scenes can embed imported models (up to 15 MB each)
    trustProxy: true,
  });
  const log = (m: string) => app.log.info(m);

  const db = injected.db ?? (await openDb({ databaseUrl: config.databaseUrl, dataDir: config.dataDir, inMemory: config.inMemoryDb, serverless: config.serverless }));
  const ring = injected.ring ?? loadKeyRing({ masterKey: config.vaultMasterKey, oldKeys: config.vaultOldKeys, dataDir: config.dataDir, env: config.env, log });
  const mailer = injected.mailer ?? (await createMailer(config, log));
  app.decorate("deps", { config, db, ring, mailer });
  app.addHook("onClose", async () => {
    if (!injected.db) await db.close();
  });

  await app.register(helmet, {
    contentSecurityPolicy: false, // the SPA sets its own CSP via meta; Monaco/three need workers + blob URLs
    crossOriginEmbedderPolicy: false,
  });
  if (config.corsOrigins.length) await app.register(cors, { origin: config.corsOrigins, credentials: true });
  await app.register(cookie);
  if (config.env !== "test") await app.register(rateLimit, { global: false });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message, code: err.code });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.status(status).send({ error: (err as Error).message });
    app.log.error(err);
    // The request id ties a user's error report to the exact log line.
    return reply.status(500).send({ error: "Internal server error", requestId: _req.id });
  });

  // CSRF defence: state-changing API calls must carry a custom header, which browsers only send
  // cross-origin after a successful CORS preflight (restricted to configured origins).
  app.addHook("onRequest", async (req) => {
    if (!req.url.startsWith("/api/")) return;
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
    // Webhooks and the cron tick are called by other servers and carry their own secret; no cookies involved.
    if (req.url.startsWith("/api/hooks/") || req.url.startsWith("/api/cron/") || req.url === "/api/collect" || req.url === "/api/billing/webhook" || req.url.startsWith("/api/f/")) return;
    if (req.headers["x-mfc-csrf"] !== "1") throw new HttpError(403, "Missing CSRF header", "csrf");
  });

  // Resolve the session cookie into req.user.
  app.addHook("preHandler", async (req) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) return;
    const row = await db.one<{ id: string; email: string; name: string | null; locale: string | null; prefs: Record<string, unknown> }>(
      `SELECT u.id, u.email, u.name, u.locale, u.prefs FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [sha256(token)],
    );
    if (row) {
      req.user = row;
      // Track activity for the sessions list, at most once a minute per session.
      void db.query(`UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1 AND last_seen_at < now() - interval '1 minute'`, [sha256(token)]).catch(() => undefined);
    }
  });

  // Workspace-scoped routes: /api/w/:workspaceId/... — resolve membership + role.
  app.addHook("preHandler", async (req) => {
    const m = /^\/api\/w\/([^/?]+)/.exec(req.url);
    if (!m) return;
    if (!req.user) throw new HttpError(401, "Sign in required", "unauthenticated");
    if (!UUID_RE.test(m[1])) throw new HttpError(404, "Workspace not found", "not_found");
    const row = await db.one<{ role: Role }>(`SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2`, [m[1], req.user.id]);
    if (!row) throw new HttpError(404, "Workspace not found", "not_found");
    req.access = { workspaceId: m[1], role: row.role };
  });

  const started = Date.now();
  app.get("/api/health", async (_req, reply) => {
    const t0 = performance.now();
    let dbOk = true;
    try {
      await db.query("SELECT 1");
    } catch {
      dbOk = false;
    }
    if (!dbOk) reply.status(503);
    return { ok: dbOk, db: db.kind, dbMs: Math.round((performance.now() - t0) * 10) / 10, version: APP_VERSION, uptimeS: Math.round((Date.now() - started) / 1000), time: new Date().toISOString() };
  });

  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(workspaceRoutes, { prefix: "/api" });
  await app.register(projectRoutes, { prefix: "/api/w/:workspaceId/projects" });
  await app.register(secretRoutes, { prefix: "/api/w/:workspaceId/secrets" });
  await app.register(auditRoutes, { prefix: "/api/w/:workspaceId/audit" });
  await app.register(aiRoutes, { prefix: "/api/w/:workspaceId/ai" });
  await app.register(httpRoutes, { prefix: "/api/w/:workspaceId/http" });
  await app.register(dataRoutes, { prefix: "/api/w/:workspaceId/data" });
  await app.register(workflowRoutes, { prefix: "/api/w/:workspaceId/workflows" });
  await app.register(forgeRoutes, { prefix: "/api/w/:workspaceId/forge" });
  await app.register(deployRoutes, { prefix: "/api/w/:workspaceId/deploy" });
  await app.register(monitoringRoutes, { prefix: "/api/w/:workspaceId/monitoring" });
  await app.register(assetRoutes, { prefix: "/api/w/:workspaceId/assets" });
  await app.register(brandRoutes, { prefix: "/api/w/:workspaceId/brand" });
  await app.register(assetPublicRoutes, { prefix: "/api" });
  await app.register(collabRoutes, { prefix: "/api/w/:workspaceId" });
  await app.register(notificationRoutes, { prefix: "/api" });
  await app.register(marketRoutes, { prefix: "/api/w/:workspaceId" });
  await app.register(publicRoutes, { prefix: "/api" });
  await app.register(billingRoutes, { prefix: "/api/w/:workspaceId/billing" });
  await app.register(billingWebhookRoutes, { prefix: "/api/billing" });
  await app.register(pushRoutes, { prefix: "/api/push" });
  await app.register(githubRoutes, { prefix: "/api/w/:workspaceId/github" });
  await app.register(formRoutes, { prefix: "/api/w/:workspaceId" });
  await app.register(telegramRoutes, { prefix: "/api/w/:workspaceId/telegram" });
  await app.register(formPublicRoutes, { prefix: "/api" });

  // What the web, desktop and mobile clients need to know about this server.
  // Public and credential-free, so the desktop / mobile connect screens may read it cross-origin.
  app.get("/api/app-info", async (_req, reply) => (reply.header("access-control-allow-origin", "*"), {
    name: "Multi-functional Creator",
    version: APP_VERSION,
    billing: !!config.billing.stripeKey,
    downloads: config.downloads,
    signInCode: true,
  }));
  app.options("/api/app-info", async (_req, reply) => reply.header("access-control-allow-origin", "*").header("access-control-allow-methods", "GET").status(204).send());

  if (config.scheduler) {
    const stop = startScheduler({ db, ring, mailer, config }, log);
    app.addHook("onClose", async () => stop());
  }

  // Serve the built web app (single-origin production deployment).
  if (config.webDist && fs.existsSync(path.join(config.webDist, "index.html"))) {
    const fastifyStatic = (await import("@fastify/static")).default;
    await app.register(fastifyStatic, {
      root: config.webDist,
      wildcard: true,
      index: false,
      setHeaders: (res, file) => {
        if (/[\\/]assets[\\/]/.test(file)) res.header("cache-control", "public, max-age=31536000, immutable");
        else if (file.endsWith("sw.js")) res.header("cache-control", "no-cache");
        if (file.endsWith(".webmanifest")) res.header("content-type", "application/manifest+json");
      },
    });
    // SPA fallback: client routes get index.html; missing API routes and asset files stay 404.
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/") || req.url.startsWith("/assets/")) return reply.status(404).send({ error: "Not found" });
      return reply.sendFile("index.html");
    });
    app.get("/", (_req, reply) => reply.sendFile("index.html"));
  }

  return app;
}
