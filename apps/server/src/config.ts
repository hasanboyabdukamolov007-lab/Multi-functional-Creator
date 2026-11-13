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
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const env = (process.env.NODE_ENV === "production" ? "production" : process.env.NODE_ENV === "test" ? "test" : "development") as Config["env"];
  const root = path.resolve(process.cwd());
  const base: Config = {
    env,
    host: process.env.HOST ?? "0.0.0.0",
    port: Number(process.env.PORT ?? 8787),
    publicUrl: (process.env.PUBLIC_URL ?? (env === "production" ? "http://localhost:8787" : "http://localhost:5173")).replace(/\/$/, ""),
    corsOrigins: (process.env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    databaseUrl: process.env.DATABASE_URL || undefined,
    dataDir: path.resolve(root, process.env.DATA_DIR ?? "data"),
    vaultMasterKey: process.env.VAULT_MASTER_KEY || undefined,
    vaultOldKeys: process.env.VAULT_OLD_KEYS || undefined,
    smtpUrl: process.env.SMTP_URL || undefined,
    mailFrom: process.env.MAIL_FROM ?? "Multi-functional Creator <no-reply@localhost>",
    magicLinkConsole: process.env.MAGIC_LINK_CONSOLE === "1" || env !== "production",
    webDist: process.env.WEB_DIST ? path.resolve(root, process.env.WEB_DIST) : path.resolve(root, "../web/dist"),
    cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "1" : env === "production",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
  };
  return { ...base, ...overrides };
}
