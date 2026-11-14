import path from "node:path";

export interface Config {
  env: "development" | "production" | "test";
  host: string;
  port: number;
  /** Public base URL of the web app (used in magic links). */
  publicUrl: string;
  /** Extra allowed CORS origins (same-origin needs none). */
  corsOrigins: string[];
  databaseUrl?: string;
  dataDir: string;
  /** "memory" for tests: in-memory embedded Postgres. */
  inMemoryDb?: boolean;
  vaultMasterKey?: string;
  vaultOldKeys?: string;
  smtpUrl?: string;
  mailFrom: string;
  /** Print magic links to the server log (for self-hosting without SMTP). */
  magicLinkConsole: boolean;
  /** Serve the built web app from this directory, if it exists. */
  webDist?: string;
  cookieSecure: boolean;
  anthropicApiKey?: string;
  /** Let the API tester and workflows reach private/internal network addresses (off by default: SSRF protection). */
  allowPrivateNetwork: boolean;
  /** Shared secret for the scheduler tick endpoint (external cron / Vercel Cron). */
  cronSecret?: string;
  /** Provider API bases (overridable for self-hosted GitHub Enterprise, proxies and tests). */
  providers: { vercel: string; netlify: string; github: string; telegram: string };
  /** Run the in-process workflow scheduler (self-hosted). */
  scheduler: boolean;
  /** Running as a serverless function (Vercel): no local disk, so an external database is required. */
  serverless?: boolean;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const env = (process.env.NODE_ENV === "production" ? "production" : process.env.NODE_ENV === "test" ? "test" : "development") as Config["env"];
  const root = path.resolve(process.cwd());
  const onVercel = !!process.env.VERCEL;
  // On Vercel the production domain is known, so magic links work without setting PUBLIC_URL.
  const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  const base: Config = {
    env,
    host: process.env.HOST ?? "0.0.0.0",
    port: Number(process.env.PORT ?? 8787),
    publicUrl: (process.env.PUBLIC_URL ?? (vercelUrl ? `https://${vercelUrl}` : env === "production" ? "http://localhost:8787" : "http://localhost:5173")).replace(/\/$/, ""),
    corsOrigins: (process.env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    databaseUrl: process.env.DATABASE_URL || process.env.POSTGRES_URL || undefined,
    dataDir: onVercel ? "/tmp/mfc-data" : path.resolve(root, process.env.DATA_DIR ?? "data"),
    serverless: onVercel,
    allowPrivateNetwork: process.env.ALLOW_PRIVATE_NETWORK === "1",
    cronSecret: process.env.CRON_SECRET || undefined,
    providers: {
      vercel: process.env.MFC_VERCEL_API ?? "https://api.vercel.com",
      netlify: process.env.MFC_NETLIFY_API ?? "https://api.netlify.com",
      github: process.env.MFC_GITHUB_API ?? "https://api.github.com",
      telegram: process.env.MFC_TELEGRAM_API ?? "https://api.telegram.org",
    },
    scheduler: !onVercel && env !== "test" && process.env.SCHEDULER !== "0",
    vaultMasterKey: process.env.VAULT_MASTER_KEY || undefined,
    vaultOldKeys: process.env.VAULT_OLD_KEYS || undefined,
    smtpUrl: process.env.SMTP_URL || undefined,
    mailFrom: process.env.MAIL_FROM ?? "Multi-functional Creator <no-reply@localhost>",
    magicLinkConsole: process.env.MAGIC_LINK_CONSOLE === "1" || env !== "production",
    webDist: process.env.WEB_DIST ? path.resolve(root, process.env.WEB_DIST) : path.resolve(root, "../web/dist"),
    cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "1" : env === "production",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
  };
  const cfg = { ...base, ...overrides };
  if (cfg.serverless && !cfg.databaseUrl) throw new Error("DATABASE_URL is required on Vercel (connect a Postgres database, e.g. Neon from the Vercel Storage tab)");
  return cfg;
}
