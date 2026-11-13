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

export async function buildApp(config: Config, injected: Partial<AppDeps> = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.env === "test" ? false : { level: config.env === "production" ? "info" : "debug", redact: ["req.headers.cookie", "req.headers.authorization"] },
    bodyLimit: 8 * 1024 * 1024,
    trustProxy: true,
  });
  const log = (m: string) => app.log.info(m);

  const db = injected.db ?? (await openDb({ databaseUrl: config.databaseUrl, dataDir: config.dataDir, inMemory: config.inMemoryDb }));
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
    return reply.status(500).send({ error: "Internal server error" });
  });

  // CSRF defence: state-changing API calls must carry a custom header, which browsers only send
  // cross-origin after a successful CORS preflight (restricted to configured origins).
  app.addHook("onRequest", async (req) => {
    if (!req.url.startsWith("/api/")) return;
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
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
    if (row) req.user = row;
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

  app.get("/api/health", async () => ({ ok: true, db: db.kind, time: new Date().toISOString() }));

  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(workspaceRoutes, { prefix: "/api" });
  await app.register(projectRoutes, { prefix: "/api/w/:workspaceId/projects" });
  await app.register(secretRoutes, { prefix: "/api/w/:workspaceId/secrets" });
  await app.register(auditRoutes, { prefix: "/api/w/:workspaceId/audit" });
  await app.register(aiRoutes, { prefix: "/api/w/:workspaceId/ai" });

  // Serve the built web app (single-origin production deployment).
  if (config.webDist && fs.existsSync(path.join(config.webDist, "index.html"))) {
    const fastifyStatic = (await import("@fastify/static")).default;
    await app.register(fastifyStatic, { root: config.webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.status(404).send({ error: "Not found" });
      return reply.sendFile("index.html");
    });
  }

  return app;
}
