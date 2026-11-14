/**
 * Database access for the data browser. Each call opens a short-lived connection (no pools held per
 * workspace), defaults to read-only transactions, applies statement timeouts and caps returned rows.
 */
export type DataKind = "postgres" | "mysql" | "mongodb";

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  ms: number;
  command: string;
}
export interface SchemaTable {
  name: string;
  columns: Array<{ name: string; type: string; nullable: boolean; pk?: boolean; default?: string | null; references?: { table: string; column: string } | null }>;
}

const MAX_ROWS = 1000;
const TIMEOUT_MS = 15_000;

function tabular(objects: Array<Record<string, unknown>>, ms: number, command: string, total?: number): QueryResult {
  const cols: string[] = [];
  for (const o of objects.slice(0, MAX_ROWS)) for (const k of Object.keys(o)) if (!cols.includes(k)) cols.push(k);
  const rows = objects.slice(0, MAX_ROWS).map((o) => cols.map((c) => normalize(o[c])));
  return { columns: cols, rows, rowCount: total ?? objects.length, truncated: objects.length > MAX_ROWS, ms, command };
}

function normalize(v: unknown): unknown {
  if (v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return v.toString();
  if (Buffer.isBuffer(v)) return `<${v.length} bytes>`;
  if (v && typeof v === "object" && "toHexString" in v && typeof (v as { toHexString: unknown }).toHexString === "function") return (v as { toHexString: () => string }).toHexString();
  return v;
}

export async function runQuery(kind: DataKind, url: string, input: { sql?: string; mongo?: MongoCommand }, readOnly: boolean): Promise<QueryResult> {
  const started = Date.now();
  if (kind === "postgres") {
    const pg = (await import("pg")).default;
    const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 8000, statement_timeout: TIMEOUT_MS, query_timeout: TIMEOUT_MS + 2000 });
    await client.connect();
    try {
      if (readOnly) await client.query("BEGIN READ ONLY");
      type PgResult = { fields?: Array<{ name: string }>; rows?: unknown[]; rowCount?: number | null; command?: string };
      // A multi-statement query returns one result per statement; show the last one.
      // Read-only runs use the extended protocol, which accepts exactly one statement: "COMMIT; DELETE …"
      // can't end the read-only transaction and then write.
      const res = (await client.query({ text: input.sql ?? "", rowMode: "array", ...(readOnly ? { queryMode: "extended" as const } : {}) })) as unknown as PgResult | PgResult[];
      const last: PgResult = Array.isArray(res) ? res[res.length - 1] : res;
      if (readOnly) await client.query("ROLLBACK");
      const fields: string[] = (last.fields ?? []).map((f) => f.name);
      const rows: unknown[][] = (last.rows ?? []) as unknown[][];
      return { columns: fields, rows: rows.slice(0, MAX_ROWS).map((r) => r.map(normalize)), rowCount: last.rowCount ?? rows.length, truncated: rows.length > MAX_ROWS, ms: Date.now() - started, command: last.command ?? "" };
    } catch (e) {
      if (readOnly) await client.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      await client.end().catch(() => undefined);
    }
  }
  if (kind === "mysql") {
    const mysql = await import("mysql2/promise");
    const conn = await mysql.createConnection({ uri: url, connectTimeout: 8000, multipleStatements: false, dateStrings: true });
    try {
      await conn.query(`SET SESSION MAX_EXECUTION_TIME=${TIMEOUT_MS}`).catch(() => undefined); // MySQL 5.7+; ignored on MariaDB
      if (readOnly) await conn.query("START TRANSACTION READ ONLY");
      const [rows, fields] = await conn.query({ sql: input.sql ?? "", rowsAsArray: true, timeout: TIMEOUT_MS });
      if (readOnly) await conn.query("ROLLBACK");
      if (Array.isArray(rows)) {
        const r = rows as unknown[][];
        return { columns: (fields ?? []).map((f) => f.name), rows: r.slice(0, MAX_ROWS).map((x) => x.map(normalize)), rowCount: r.length, truncated: r.length > MAX_ROWS, ms: Date.now() - started, command: "SELECT" };
      }
      const info = rows as { affectedRows?: number };
      return { columns: ["affectedRows"], rows: [[info.affectedRows ?? 0]], rowCount: info.affectedRows ?? 0, truncated: false, ms: Date.now() - started, command: "WRITE" };
    } catch (e) {
      if (readOnly) await conn.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      await conn.end().catch(() => undefined);
    }
  }
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(url, { serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000 });
  await client.connect();
  try {
    return await runMongo(client.db(), input.mongo ?? { collection: "", op: "find" }, readOnly, started);
  } finally {
    await client.close().catch(() => undefined);
  }
}

export interface MongoCommand {
  collection: string;
  op: "find" | "aggregate" | "count" | "insertOne" | "updateMany" | "deleteMany";
  filter?: Record<string, unknown>;
  projection?: Record<string, unknown>;
  sort?: Record<string, 1 | -1>;
  limit?: number;
  pipeline?: Array<Record<string, unknown>>;
  document?: Record<string, unknown>;
  update?: Record<string, unknown>;
}

async function runMongo(db: import("mongodb").Db, cmd: MongoCommand, readOnly: boolean, started: number): Promise<QueryResult> {
  if (!cmd.collection) throw new Error('Set "collection"');
  const writes = ["insertOne", "updateMany", "deleteMany"];
  if (readOnly && writes.includes(cmd.op)) throw new Error("Read-only mode: turn it off to run writes");
  if (readOnly && cmd.op === "aggregate" && (cmd.pipeline ?? []).some((s) => "$out" in s || "$merge" in s)) throw new Error("Read-only mode: $out and $merge are not allowed");
  const col = db.collection(cmd.collection);
  const opts = { maxTimeMS: TIMEOUT_MS };
  switch (cmd.op) {
    case "find": {
      const docs = await col.find(cmd.filter ?? {}, { ...opts, projection: cmd.projection, sort: cmd.sort, limit: Math.min(cmd.limit ?? 100, MAX_ROWS + 1) }).toArray();
      return tabular(docs as Array<Record<string, unknown>>, Date.now() - started, "find");
    }
    case "aggregate": {
      const docs = await col.aggregate([...(cmd.pipeline ?? []), { $limit: MAX_ROWS + 1 }], opts).toArray();
      return tabular(docs as Array<Record<string, unknown>>, Date.now() - started, "aggregate");
    }
    case "count": {
      const n = await col.countDocuments(cmd.filter ?? {}, opts);
      return tabular([{ count: n }], Date.now() - started, "count", n);
    }
    case "insertOne": {
      const r = await col.insertOne(cmd.document ?? {});
      return tabular([{ insertedId: String(r.insertedId) }], Date.now() - started, "insertOne", 1);
    }
    case "updateMany": {
      const r = await col.updateMany(cmd.filter ?? {}, cmd.update ?? {});
      return tabular([{ matched: r.matchedCount, modified: r.modifiedCount }], Date.now() - started, "updateMany", r.modifiedCount);
    }
    case "deleteMany": {
      if (!cmd.filter || !Object.keys(cmd.filter).length) throw new Error("Refusing deleteMany without a filter");
      const r = await col.deleteMany(cmd.filter);
      return tabular([{ deleted: r.deletedCount }], Date.now() - started, "deleteMany", r.deletedCount);
    }
    default:
      throw new Error(`Unsupported operation ${String(cmd.op)}`);
  }
}

export async function readSchema(kind: DataKind, url: string): Promise<SchemaTable[]> {
  if (kind === "postgres") {
    const r = await runQuery(kind, url, {
      sql: `SELECT c.table_schema || '.' || c.table_name, c.column_name, c.data_type, c.is_nullable, c.column_default,
        EXISTS (SELECT 1 FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage k ON k.constraint_name = tc.constraint_name AND k.table_schema = tc.table_schema
                WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = c.table_schema AND tc.table_name = c.table_name AND k.column_name = c.column_name) AS pk,
        (SELECT ccu.table_schema || '.' || ccu.table_name || '|' || ccu.column_name FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage k ON k.constraint_name = tc.constraint_name AND k.table_schema = tc.table_schema
           JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.table_schema
          WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = c.table_schema AND tc.table_name = c.table_name AND k.column_name = c.column_name LIMIT 1) AS ref
      FROM information_schema.columns c WHERE c.table_schema NOT IN ('pg_catalog','information_schema') ORDER BY c.table_schema, c.table_name, c.ordinal_position`,
    }, true);
    return group(r.rows as unknown[][]);
  }
  if (kind === "mysql") {
    const r = await runQuery(kind, url, {
      sql: `SELECT c.table_name, c.column_name, c.column_type, c.is_nullable, c.column_default, c.column_key = 'PRI',
        (SELECT CONCAT(k.referenced_table_name, '|', k.referenced_column_name) FROM information_schema.key_column_usage k
          WHERE k.table_schema = c.table_schema AND k.table_name = c.table_name AND k.column_name = c.column_name AND k.referenced_table_name IS NOT NULL LIMIT 1)
      FROM information_schema.columns c WHERE c.table_schema = DATABASE() ORDER BY c.table_name, c.ordinal_position`,
    }, true);
    return group(r.rows as unknown[][]);
  }
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(url, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  try {
    const db = client.db();
    const cols = await db.listCollections({}, { nameOnly: true }).toArray();
    const out: SchemaTable[] = [];
    for (const c of cols.slice(0, 200)) {
      const sample = await db.collection(c.name).findOne({}, { maxTimeMS: 5000 });
      out.push({ name: c.name, columns: Object.entries(sample ?? {}).map(([k, v]) => ({ name: k, type: Array.isArray(v) ? "array" : v === null ? "null" : typeof v === "object" ? (v as object).constructor?.name ?? "object" : typeof v, nullable: true })) });
    }
    return out;
  } finally {
    await client.close().catch(() => undefined);
  }
}

function group(rows: unknown[][]): SchemaTable[] {
  const map = new Map<string, SchemaTable>();
  for (const [table, column, type, nullable, def, pk, ref] of rows) {
    const t = String(table);
    if (!map.has(t)) map.set(t, { name: t, columns: [] });
    const [rt, rc] = typeof ref === "string" && ref.includes("|") ? ref.split("|") : [null, null];
    map.get(t)!.columns.push({
      name: String(column),
      type: String(type),
      nullable: String(nullable).toUpperCase() === "YES",
      pk: pk === true || pk === 1 || pk === "1" || pk === "t",
      default: def == null ? null : String(def),
      references: rt && rc ? { table: rt, column: rc } : null,
    });
  }
  return [...map.values()];
}

/** Basic sanity check of a connection string for the chosen kind. */
export function validateConnectionUrl(kind: DataKind, url: string): void {
  const ok = kind === "postgres" ? /^postgres(ql)?:\/\//i.test(url) : kind === "mysql" ? /^mysql:\/\//i.test(url) : /^mongodb(\+srv)?:\/\//i.test(url);
  if (!ok) throw new Error(`The secret doesn't look like a ${kind} connection string`);
}
