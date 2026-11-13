import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { parse, requirePerm, notFound, badRequest, HttpError } from "../lib/http.js";
import { audit } from "../lib/audit.js";
import { readValue } from "../lib/secretsStore.js";
import { readSchema, runQuery, validateConnectionUrl, type DataKind, type MongoCommand } from "../lib/dataDrivers.js";

const Kind = z.enum(["postgres", "mysql", "mongodb"]);
const ConnBody = z.object({ name: z.string().trim().min(1).max(80), kind: Kind, secretId: z.string().uuid() });
const QueryBody = z.object({ sql: z.string().max(200_000).optional(), mongo: z.record(z.string(), z.unknown()).optional(), readOnly: z.boolean().default(true) });

export const dataRoutes: FastifyPluginAsync = async (app) => {
  const { db, ring } = app.deps;

  /** Connection strings live in the vault; a connection only references the secret. */
  const open = async (workspaceId: string, id: string) => {
    const c = await db.one<{ kind: DataKind; secret_id: string; name: string }>(`SELECT kind, secret_id, name FROM data_connections WHERE id = $1 AND workspace_id = $2`, [id, workspaceId]);
    if (!c) throw notFound("Connection not found");
    return { ...c, url: await readValue(db, ring, c.secret_id) };
  };
  const dbError = (e: unknown) => new HttpError(400, `Database error: ${(e as Error).message}`.replace(/(postgres(ql)?|mysql|mongodb(\+srv)?):\/\/[^@\s]+@/gi, "$1://•••@"), "database");

  app.get("/connections", async (req) => {
    const a = requirePerm(req, "projects.read");
    return { connections: await db.query(`SELECT c.id, c.name, c.kind, c.secret_id, s.name AS secret_name, s.environment, c.created_at FROM data_connections c JOIN secrets s ON s.id = c.secret_id WHERE c.workspace_id = $1 ORDER BY c.name`, [a.workspaceId]) };
  });

  app.post("/connections", async (req) => {
    const a = requirePerm(req, "data.connect");
    const b = parse(ConnBody, req.body);
    const s = await db.one(`SELECT 1 FROM secrets WHERE id = $1 AND workspace_id = $2`, [b.secretId, a.workspaceId]);
    if (!s) throw badRequest("Unknown secret");
    try {
      validateConnectionUrl(b.kind, await readValue(db, ring, b.secretId));
    } catch (e) {
      throw badRequest((e as Error).message);
    }
    const id = crypto.randomUUID();
    await db.query(`INSERT INTO data_connections (id, workspace_id, name, kind, secret_id, created_by) VALUES ($1,$2,$3,$4,$5,$6)`, [id, a.workspaceId, b.name, b.kind, b.secretId, req.user!.id]);
    await audit(db, req, "data.connection.add", { targetType: "data_connection", targetId: id, meta: { name: b.name, kind: b.kind } });
    return { id };
  });

  app.delete("/connections/:id", async (req) => {
    const a = requirePerm(req, "data.connect");
    const { id } = req.params as { id: string };
    const row = await db.one(`DELETE FROM data_connections WHERE id = $1 AND workspace_id = $2 RETURNING name`, [id, a.workspaceId]);
    if (!row) throw notFound("Connection not found");
    await audit(db, req, "data.connection.remove", { targetType: "data_connection", targetId: id });
    return { ok: true };
  });

  app.get("/connections/:id/schema", async (req) => {
    const a = requirePerm(req, "data.query");
    const { id } = req.params as { id: string };
    const c = await open(a.workspaceId, id);
    try {
      return { tables: await readSchema(c.kind, c.url) };
    } catch (e) {
      throw dbError(e);
    }
  });

  app.post("/connections/:id/query", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req) => {
    const a = requirePerm(req, "data.query");
    const { id } = req.params as { id: string };
    const b = parse(QueryBody, req.body);
    const c = await open(a.workspaceId, id);
    if (c.kind === "mongodb" ? !b.mongo : !b.sql?.trim()) throw badRequest(c.kind === "mongodb" ? "Send a MongoDB command" : "Write a query first");
    try {
      const result = await runQuery(c.kind, c.url, { sql: b.sql, mongo: b.mongo as unknown as MongoCommand }, b.readOnly);
      await audit(db, req, b.readOnly ? "data.query" : "data.write", { targetType: "data_connection", targetId: id, meta: { connection: c.name, query: (b.sql ?? JSON.stringify(b.mongo)).slice(0, 500), rows: result.rowCount } });
      return result;
    } catch (e) {
      await audit(db, req, "data.query.error", { targetType: "data_connection", targetId: id, meta: { connection: c.name, query: (b.sql ?? JSON.stringify(b.mongo)).slice(0, 500) } });
      throw dbError(e);
    }
  });
};
