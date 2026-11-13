import fs from "node:fs";
import path from "node:path";
import { MIGRATIONS } from "./migrations.js";

export interface Db {
  kind: "postgres" | "pglite";
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  tx<R>(fn: (q: Pick<Db, "query" | "one">) => Promise<R>): Promise<R>;
  close(): Promise<void>;
}

type Querier = { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> };

function wrap(q: Querier): Pick<Db, "query" | "one"> {
  return {
    async query<T>(sql: string, params?: unknown[]) {
      return (await q.query(sql, params)).rows as T[];
    },
    async one<T>(sql: string, params?: unknown[]) {
      return (await q.query(sql, params)).rows[0] as T | undefined;
    },
  };
}

export async function openDb(opts: { databaseUrl?: string; dataDir: string; inMemory?: boolean }): Promise<Db> {
  let db: Db;
  if (opts.databaseUrl) {
    const pg = await import("pg");
    const pool = new pg.default.Pool({ connectionString: opts.databaseUrl, max: 10 });
    const w = wrap(pool);
    db = {
      kind: "postgres",
      ...w,
      async tx(fn) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const r = await fn(wrap(client));
          await client.query("COMMIT");
          return r;
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    let dir: string | undefined;
    if (!opts.inMemory) {
      dir = path.join(opts.dataDir, "pglite");
      fs.mkdirSync(dir, { recursive: true });
    }
    const lite = dir ? new PGlite(dir) : new PGlite();
    await lite.waitReady;
    const w = wrap(lite as unknown as Querier);
    db = {
      kind: "pglite",
      ...w,
      tx: (fn) => lite.transaction((t) => fn(wrap(t as unknown as Querier))),
      close: () => lite.close(),
    };
  }
  await migrate(db);
  return db;
}

async function migrate(db: Db) {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (id integer PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await db.query<{ id: number }>(`SELECT id FROM schema_migrations`)).map((r) => r.id));
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    await db.tx(async (t) => {
      for (const stmt of m.sql.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) await t.query(stmt);
      await t.query(`INSERT INTO schema_migrations (id, name) VALUES ($1, $2)`, [m.id, m.name]);
    });
  }
}
