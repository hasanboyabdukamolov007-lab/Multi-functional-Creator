/**
 * API generator: a resource spec → a complete, typed Fastify + PostgreSQL service
 * (CRUD routes with zod validation, pagination/sorting, auth, migrations, OpenAPI 3.1, Dockerfile, README).
 * Pure: returns a map of file path → contents.
 */

export const FIELD_TYPES = ["string", "text", "integer", "number", "boolean", "datetime", "email", "uuid", "json"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export type AuthMode = "none" | "apiKey" | "jwt";

export interface ApiField {
  id: string;
  name: string;
  type: FieldType;
  required: boolean;
  unique: boolean;
}
export interface ApiResource {
  id: string;
  /** Singular, snake_case (e.g. "order_item"). */
  name: string;
  fields: ApiField[];
  /** Require authentication for this resource (when the API has an auth mode). */
  protected: boolean;
}
export interface ApiSpec {
  version: 1;
  name: string;
  description: string;
  auth: AuthMode;
  resources: ApiResource[];
}

const IDENT = /^[a-z][a-z0-9_]{0,40}$/;
const RESERVED = new Set(["id", "created_at", "updated_at"]);

export const plural = (s: string) => (/(s|x|z|ch|sh)$/.test(s) ? `${s}es` : /[^aeiou]y$/.test(s) ? `${s.slice(0, -1)}ies` : `${s}s`);
const pascal = (s: string) => s.replace(/(^|_)([a-z0-9])/g, (_, __, c: string) => c.toUpperCase());
const camel = (s: string) => pascal(s).replace(/^./, (c) => c.toLowerCase());

export function validateSpec(spec: ApiSpec): string[] {
  const out: string[] = [];
  if (!spec.resources.length) out.push("Add at least one resource");
  const names = new Set<string>();
  for (const r of spec.resources) {
    if (!IDENT.test(r.name)) out.push(`Resource "${r.name}" must be lowercase snake_case (e.g. order_item)`);
    if (names.has(r.name)) out.push(`Duplicate resource "${r.name}"`);
    names.add(r.name);
    if (!r.fields.length) out.push(`${r.name}: add at least one field`);
    const fields = new Set<string>();
    for (const f of r.fields) {
      if (!IDENT.test(f.name)) out.push(`${r.name}.${f.name}: use lowercase snake_case`);
      if (RESERVED.has(f.name)) out.push(`${r.name}.${f.name}: "${f.name}" is added automatically`);
      if (fields.has(f.name)) out.push(`${r.name}: duplicate field "${f.name}"`);
      fields.add(f.name);
    }
  }
  return out;
}

const ZOD: Record<FieldType, string> = {
  string: "z.string().min(1).max(255)",
  text: "z.string().max(100000)",
  integer: "z.number().int()",
  number: "z.number().finite()",
  boolean: "z.boolean()",
  datetime: "z.string().datetime({ offset: true })",
  email: "z.string().email().max(254)",
  uuid: "z.string().uuid()",
  json: "z.unknown()",
};
const SQL: Record<FieldType, string> = {
  string: "varchar(255)",
  text: "text",
  integer: "integer",
  number: "double precision",
  boolean: "boolean",
  datetime: "timestamptz",
  email: "varchar(254)",
  uuid: "uuid",
  json: "jsonb",
};
const OAS: Record<FieldType, Record<string, unknown>> = {
  string: { type: "string", maxLength: 255 },
  text: { type: "string" },
  integer: { type: "integer" },
  number: { type: "number" },
  boolean: { type: "boolean" },
  datetime: { type: "string", format: "date-time" },
  email: { type: "string", format: "email" },
  uuid: { type: "string", format: "uuid" },
  json: {},
};

function migration(spec: ApiSpec): string {
  const tables = spec.resources.map((r) => {
    const cols = [
      `  id uuid PRIMARY KEY DEFAULT gen_random_uuid()`,
      ...r.fields.map((f) => `  ${f.name} ${SQL[f.type]}${f.required ? " NOT NULL" : ""}${f.unique ? " UNIQUE" : ""}`),
      `  created_at timestamptz NOT NULL DEFAULT now()`,
      `  updated_at timestamptz NOT NULL DEFAULT now()`,
    ];
    return `CREATE TABLE IF NOT EXISTS ${plural(r.name)} (\n${cols.join(",\n")}\n);\nCREATE INDEX IF NOT EXISTS ${plural(r.name)}_created_at ON ${plural(r.name)} (created_at DESC);`;
  });
  return `-- ${spec.name}: initial schema\nCREATE EXTENSION IF NOT EXISTS pgcrypto;\n\n${tables.join("\n\n")}\n`;
}

function routeFile(spec: ApiSpec, r: ApiResource): string {
  const table = plural(r.name);
  const fn = `${camel(table)}Routes`;
  const P = pascal(r.name);
  const shape = r.fields.map((f) => `  ${f.name}: ${ZOD[f.type]}${f.required ? "" : ".nullable().optional()"},`).join("\n");
  const jsonFields = r.fields.filter((f) => f.type === "json").map((f) => f.name);
  const sortable = ["created_at", "updated_at", ...r.fields.filter((f) => f.type !== "json" && f.type !== "text").map((f) => f.name)];
  const searchable = r.fields.filter((f) => ["string", "text", "email"].includes(f.type)).map((f) => f.name);
  const needsAuth = spec.auth !== "none" && r.protected;
  return `import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";
import { HttpError } from "../errors.js";${needsAuth ? `\nimport { requireAuth } from "../auth.js";` : ""}

/** Request body for creating a ${r.name.replace(/_/g, " ")}. */
export const ${P}Create = z
  .object({
${shape.split("\n").map((l) => `  ${l}`).join("\n")}
  })
  .strict();
export const ${P}Update = ${P}Create.partial().strict();
export type ${P} = z.infer<typeof ${P}Create> & { id: string; created_at: string; updated_at: string };

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  sort: z.enum(${JSON.stringify(sortable)}).default("created_at"),
  order: z.enum(["asc", "desc"]).default("desc"),${searchable.length ? `\n  q: z.string().trim().max(200).optional(),` : ""}
});
const Params = z.object({ id: z.string().uuid() });

const COLUMNS = ${JSON.stringify(["id", ...r.fields.map((f) => f.name), "created_at", "updated_at"].join(", "))};
const JSON_FIELDS = new Set<string>(${JSON.stringify(jsonFields)});
const toDb = (key: string, value: unknown) => (JSON_FIELDS.has(key) && value !== null && value !== undefined ? JSON.stringify(value) : value);

export const ${fn}: FastifyPluginAsync = async (app) => {${needsAuth ? `\n  app.addHook("onRequest", requireAuth);` : ""}

  app.get("/", async (req) => {
    const q = ListQuery.parse(req.query);
    const where: string[] = [];
    const params: unknown[] = [];${searchable.length ? `
    if (q.q) {
      params.push(\`%\${q.q.replace(/[%_\\\\]/g, (c) => "\\\\" + c)}%\`);
      where.push(\`(${searchable.map((s) => `${s} ILIKE $\${params.length}`).join(" OR ")})\`);
    }` : ""}
    const filter = where.length ? \` WHERE \${where.join(" AND ")}\` : "";
    // sort/order come from a validated enum, so interpolating them is safe.
    const { rows } = await pool.query(\`SELECT \${COLUMNS} FROM ${table}\${filter} ORDER BY \${q.sort} \${q.order} LIMIT $\${params.length + 1} OFFSET $\${params.length + 2}\`, [...params, q.limit, q.offset]);
    const { rows: count } = await pool.query<{ total: number }>(\`SELECT count(*)::int AS total FROM ${table}\${filter}\`, params);
    return { data: rows, total: count[0].total, limit: q.limit, offset: q.offset };
  });

  app.get("/:id", async (req) => {
    const { id } = Params.parse(req.params);
    const { rows } = await pool.query(\`SELECT \${COLUMNS} FROM ${table} WHERE id = $1\`, [id]);
    if (!rows[0]) throw new HttpError(404, "${P} not found");
    return rows[0];
  });

  app.post("/", async (req, reply) => {
    const body = ${P}Create.parse(req.body);
    const keys = Object.keys(body);
    const values = keys.map((k) => toDb(k, (body as Record<string, unknown>)[k]));
    const sql = keys.length
      ? \`INSERT INTO ${table} (\${keys.join(", ")}) VALUES (\${keys.map((_, i) => \`$\${i + 1}\`).join(", ")}) RETURNING \${COLUMNS}\`
      : \`INSERT INTO ${table} DEFAULT VALUES RETURNING \${COLUMNS}\`;
    const { rows } = await pool.query(sql, values);
    return reply.code(201).send(rows[0]);
  });

  app.patch("/:id", async (req) => {
    const { id } = Params.parse(req.params);
    const body = ${P}Update.parse(req.body);
    const keys = Object.keys(body);
    if (!keys.length) throw new HttpError(400, "Send at least one field to update");
    const sets = keys.map((k, i) => \`\${k} = $\${i + 2}\`).join(", ");
    const { rows } = await pool.query(\`UPDATE ${table} SET \${sets}, updated_at = now() WHERE id = $1 RETURNING \${COLUMNS}\`, [id, ...keys.map((k) => toDb(k, (body as Record<string, unknown>)[k]))]);
    if (!rows[0]) throw new HttpError(404, "${P} not found");
    return rows[0];
  });

  app.delete("/:id", async (req, reply) => {
    const { id } = Params.parse(req.params);
    const { rowCount } = await pool.query(\`DELETE FROM ${table} WHERE id = $1\`, [id]);
    if (!rowCount) throw new HttpError(404, "${P} not found");
    return reply.code(204).send();
  });
};
`;
}

function authFile(mode: AuthMode): string {
  if (mode === "apiKey")
    return `import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { HttpError } from "./errors.js";

/** Requires an "x-api-key" header equal to API_KEY (constant-time comparison). */
export async function requireAuth(req: FastifyRequest, _reply: FastifyReply) {
  const expected = process.env.API_KEY;
  if (!expected) throw new HttpError(500, "API_KEY is not configured");
  const given = String(req.headers["x-api-key"] ?? "");
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new HttpError(401, "Invalid or missing API key");
}
`;
  if (mode === "jwt")
    return `import jwt from "jsonwebtoken";
import type { FastifyReply, FastifyRequest } from "fastify";
import { HttpError } from "./errors.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: jwt.JwtPayload;
  }
}

/** Requires "Authorization: Bearer <JWT>" signed with JWT_SECRET (HS256). */
export async function requireAuth(req: FastifyRequest, _reply: FastifyReply) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new HttpError(500, "JWT_SECRET is not configured");
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Bearer ")) throw new HttpError(401, "Missing bearer token");
  try {
    const payload = jwt.verify(header.slice(7), secret, { algorithms: ["HS256"] });
    req.user = typeof payload === "string" ? { sub: payload } : payload;
  } catch {
    throw new HttpError(401, "Invalid or expired token");
  }
}
`;
  return `import type { FastifyReply, FastifyRequest } from "fastify";

/** This API has no authentication. Choose "API key" or "JWT" in the generator to add it. */
export async function requireAuth(_req: FastifyRequest, _reply: FastifyReply) {}
`;
}

function openapi(spec: ApiSpec): Record<string, unknown> {
  const paths: Record<string, unknown> = {};
  const schemas: Record<string, unknown> = {};
  const security = spec.auth === "apiKey" ? [{ apiKey: [] }] : spec.auth === "jwt" ? [{ bearer: [] }] : [];
  for (const r of spec.resources) {
    const P = pascal(r.name);
    const table = plural(r.name);
    const props = Object.fromEntries(r.fields.map((f) => [f.name, { ...OAS[f.type], ...(f.required ? {} : { nullable: true }) }]));
    schemas[`${P}Input`] = { type: "object", additionalProperties: false, properties: props, required: r.fields.filter((f) => f.required).map((f) => f.name) };
    schemas[P] = { allOf: [{ $ref: `#/components/schemas/${P}Input` }, { type: "object", properties: { id: { type: "string", format: "uuid" }, created_at: { type: "string", format: "date-time" }, updated_at: { type: "string", format: "date-time" } } }] };
    const sec = spec.auth !== "none" && r.protected ? { security } : {};
    const idParam = { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } };
    const json = (ref: string) => ({ content: { "application/json": { schema: { $ref: `#/components/schemas/${ref}` } } } });
    paths[`/${table}`] = {
      get: { summary: `List ${table}`, tags: [table], ...sec, parameters: ["limit", "offset", "sort", "order", "q"].map((n) => ({ name: n, in: "query", schema: { type: n === "limit" || n === "offset" ? "integer" : "string" } })), responses: { 200: { description: "A page of results" } } },
      post: { summary: `Create a ${r.name}`, tags: [table], ...sec, requestBody: { required: true, ...json(`${P}Input`) }, responses: { 201: { description: "Created", ...json(P) }, 400: { description: "Validation error" }, 409: { description: "Duplicate value" } } },
    };
    paths[`/${table}/{id}`] = {
      get: { summary: `Get a ${r.name}`, tags: [table], ...sec, parameters: [idParam], responses: { 200: { description: "Found", ...json(P) }, 404: { description: "Not found" } } },
      patch: { summary: `Update a ${r.name}`, tags: [table], ...sec, parameters: [idParam], requestBody: { required: true, ...json(`${P}Input`) }, responses: { 200: { description: "Updated", ...json(P) }, 404: { description: "Not found" } } },
      delete: { summary: `Delete a ${r.name}`, tags: [table], ...sec, parameters: [idParam], responses: { 204: { description: "Deleted" }, 404: { description: "Not found" } } },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: spec.name, version: "1.0.0", description: spec.description },
    servers: [{ url: "http://localhost:3000" }],
    paths,
    components: { schemas, securitySchemes: spec.auth === "apiKey" ? { apiKey: { type: "apiKey", in: "header", name: "x-api-key" } } : spec.auth === "jwt" ? { bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" } } : {} },
  };
}

export function generateApi(spec: ApiSpec): Record<string, string> {
  const slug = spec.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "api";
  const files: Record<string, string> = {};
  const deps: Record<string, string> = { "@fastify/cors": "^11.0.0", fastify: "^5.0.0", pg: "^8.13.0", zod: "^3.25.0" };
  const devDeps: Record<string, string> = { "@types/node": "^22.0.0", "@types/pg": "^8.11.0", tsx: "^4.19.0", typescript: "^5.9.0" };
  if (spec.auth === "jwt") {
    deps.jsonwebtoken = "^9.0.2";
    devDeps["@types/jsonwebtoken"] = "^9.0.7";
  }
  files["package.json"] = JSON.stringify({ name: slug, version: "1.0.0", private: true, type: "module", description: spec.description, scripts: { dev: "tsx watch src/server.ts", build: "tsc -p tsconfig.json", start: "node dist/server.js", migrate: "tsx src/migrate.ts", typecheck: "tsc -p tsconfig.json --noEmit" }, dependencies: deps, devDependencies: devDeps, engines: { node: ">=20" } }, null, 2) + "\n";
  files["tsconfig.json"] = JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", outDir: "dist", rootDir: "src", strict: true, esModuleInterop: true, skipLibCheck: true }, include: ["src"] }, null, 2) + "\n";
  files[".gitignore"] = "node_modules/\ndist/\n.env\n";
  files[".env.example"] = ["# Copy to .env (never commit real values). Store production values in the Secrets Vault.", "DATABASE_URL=postgres://user:password@localhost:5432/" + slug.replace(/-/g, "_"), "PORT=3000", "CORS_ORIGIN=http://localhost:5173", ...(spec.auth === "apiKey" ? ["API_KEY="] : spec.auth === "jwt" ? ["JWT_SECRET="] : [])].join("\n") + "\n";
  files["migrations/001_init.sql"] = migration(spec);
  files["openapi.json"] = JSON.stringify(openapi(spec), null, 2) + "\n";
  files["src/errors.ts"] = `export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
`;
  files["src/db.ts"] = `import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.PG_POOL_MAX ?? 10) });
`;
  files["src/auth.ts"] = authFile(spec.auth);
  files["src/migrate.ts"] = `import fs from "node:fs";
import path from "node:path";
import { pool } from "./db.js";

/** Applies migrations/*.sql in order, once each, inside transactions. */
const dir = path.resolve("migrations");
await pool.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
const done = new Set((await pool.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  if (done.has(file)) continue;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(fs.readFileSync(path.join(dir, file), "utf8"));
    await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
    await client.query("COMMIT");
    console.log("applied", file);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
await pool.end();
`;
  for (const r of spec.resources) files[`src/routes/${plural(r.name)}.ts`] = routeFile(spec, r);
  files["src/server.ts"] = `import fs from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import { pool } from "./db.js";
import { HttpError } from "./errors.js";
${spec.resources.map((r) => `import { ${camel(plural(r.name))}Routes } from "./routes/${plural(r.name)}.js";`).join("\n")}

const app = Fastify({ logger: true, bodyLimit: 1024 * 1024 });
await app.register(cors, { origin: process.env.CORS_ORIGIN?.split(",").map((s) => s.trim()) ?? false });

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof ZodError) return reply.code(400).send({ error: "Validation failed", issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message });
  const code = (err as { code?: string }).code;
  if (code === "23505") return reply.code(409).send({ error: "A record with that value already exists" });
  if (code === "23503") return reply.code(409).send({ error: "A related record is missing or still referenced" });
  const status = (err as { statusCode?: number }).statusCode;
  if (status && status < 500) return reply.code(status).send({ error: err instanceof Error ? err.message : "Bad request" });
  app.log.error(err);
  return reply.code(500).send({ error: "Internal server error" });
});

const spec = JSON.parse(fs.readFileSync(path.resolve("openapi.json"), "utf8"));
app.get("/openapi.json", async () => spec);
app.get("/health", async () => {
  await pool.query("SELECT 1");
  return { ok: true };
});

${spec.resources.map((r) => `await app.register(${camel(plural(r.name))}Routes, { prefix: "/${plural(r.name)}" });`).join("\n")}

const close = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", close);
process.on("SIGINT", close);

await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? 3000) });
`;
  files["Dockerfile"] = `FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY openapi.json ./
COPY migrations ./migrations
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
`;
  const endpoints = spec.resources
    .flatMap((r) => {
      const t = plural(r.name);
      const lock = spec.auth !== "none" && r.protected ? " 🔒" : "";
      return [`| GET | /${t} | List (limit, offset, sort, order, q)${lock} |`, `| POST | /${t} | Create${lock} |`, `| GET | /${t}/:id | Get one${lock} |`, `| PATCH | /${t}/:id | Update${lock} |`, `| DELETE | /${t}/:id | Delete${lock} |`];
    })
    .join("\n");
  const first = spec.resources[0];
  const sample = first ? Object.fromEntries(first.fields.filter((f) => f.required).map((f) => [f.name, f.type === "integer" ? 1 : f.type === "number" ? 9.99 : f.type === "boolean" ? true : f.type === "email" ? "ada@example.com" : f.type === "datetime" ? "2026-11-13T10:00:00Z" : f.type === "uuid" ? "00000000-0000-4000-8000-000000000000" : f.type === "json" ? {} : "Example"])) : {};
  const authHeader = spec.auth === "apiKey" ? ` -H "x-api-key: $API_KEY"` : spec.auth === "jwt" ? ` -H "Authorization: Bearer $TOKEN"` : "";
  files["README.md"] = `# ${spec.name}

${spec.description || "REST API generated with Multi-functional Creator."}

TypeScript · Fastify · PostgreSQL · zod validation · OpenAPI 3.1${spec.auth === "apiKey" ? " · API-key auth" : spec.auth === "jwt" ? " · JWT auth" : ""}

## Run it

\`\`\`bash
cp .env.example .env   # then fill in DATABASE_URL${spec.auth === "apiKey" ? " and API_KEY" : spec.auth === "jwt" ? " and JWT_SECRET" : ""}
npm install
npm run migrate
npm run dev
\`\`\`

The API listens on http://localhost:3000. The OpenAPI document is served at \`/openapi.json\` and \`/health\` checks the database.

## Endpoints

| Method | Path | Notes |
|---|---|---|
${endpoints}
${first ? `
## Example

\`\`\`bash
curl -X POST http://localhost:3000/${plural(first.name)} -H "content-type: application/json"${authHeader} -d '${JSON.stringify(sample)}'
\`\`\`
` : ""}
## Deploy

\`docker build -t ${slug} . && docker run -p 3000:3000 --env-file .env ${slug}\` — or deploy with the panel's Deploy module. Keep secrets in the Secrets Vault; they are injected as environment variables at deploy time.
`;
  return files;
}

let seq = 0;
const fid = (p: string) => `${p}_${Date.now().toString(36)}${(seq++).toString(36)}`;
export function newField(o: Partial<ApiField> = {}): ApiField {
  return { id: fid("f"), name: "name", type: "string", required: true, unique: false, ...o };
}
export function newResource(name = "item"): ApiResource {
  return { id: fid("r"), name, protected: true, fields: [newField({ name: "name" })] };
}
export function starterSpec(): ApiSpec {
  return {
    version: 1,
    name: "Shop API",
    description: "Products and orders for an online shop.",
    auth: "apiKey",
    resources: [
      { id: fid("r"), name: "product", protected: false, fields: [newField({ name: "name" }), newField({ name: "description", type: "text", required: false }), newField({ name: "price", type: "number" }), newField({ name: "sku", type: "string", unique: true }), newField({ name: "in_stock", type: "boolean" })] },
      { id: fid("r"), name: "order", protected: true, fields: [newField({ name: "customer_email", type: "email" }), newField({ name: "total", type: "number" }), newField({ name: "status", type: "string" }), newField({ name: "items", type: "json" })] },
    ],
  };
}
export function isApiSpec(d: unknown): d is ApiSpec {
  const s = d as ApiSpec;
  return !!s && Array.isArray(s.resources) && typeof s.name === "string";
}
