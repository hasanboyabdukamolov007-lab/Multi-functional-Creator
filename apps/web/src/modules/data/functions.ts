import { ENVIRONMENTS, type Environment } from "@mfc/core";
import { registry, type AppFunction } from "../../lib/registry";
import { projectsApi } from "../../lib/projects";
import { downloadBlob, downloadText, slugify } from "../../lib/download";
import { toast } from "../../lib/ui";
import { dataApi, httpApi, toTable } from "./dataApi";
import { workflowApi, newNode, type NodeType, type WfGraph } from "./workflowApi";
import { FIELD_TYPES, generateApi, isApiSpec, newField, newResource, plural, starterSpec, validateSpec, type ApiSpec, type FieldType } from "./apigen";
import { createSchemaSql, isDbSchema, newColumn, newTable, starterSchema, type ColumnType, type DbSchema } from "./sqlgen";

const TABS = [
  ["tester", "Open the API tester", ["postman", "http", "request", "rest", "curl"]],
  ["browser", "Open the database browser / SQL console", ["sql", "query", "postgres", "mysql", "mongodb", "console"]],
  ["schema", "Open the database schema designer", ["er", "diagram", "tables", "migration", "ddl"]],
  ["api", "Open the API generator", ["backend", "crud", "rest", "openapi", "fastify"]],
  ["workflows", "Open workflow automations", ["automation", "zap", "cron", "webhook", "schedule"]],
] as const;

async function findConnection(ref: string) {
  const list = await dataApi.connections();
  const c = list.find((x) => x.id === ref) ?? list.find((x) => x.name.toLowerCase() === ref.toLowerCase());
  if (!c) throw new Error(`No connection "${ref}". Available: ${list.map((x) => x.name).join(", ") || "none"}`);
  return c;
}
async function findWorkflow(ref: string) {
  const list = await workflowApi.list();
  const w = list.find((x) => x.id === ref) ?? list.find((x) => x.name.toLowerCase() === ref.toLowerCase());
  if (!w) throw new Error(`No workflow "${ref}". Available: ${list.map((x) => x.name).join(", ") || "none"}`);
  return w;
}

const FIELD_TO_COLUMN: Record<FieldType, ColumnType> = { string: "varchar", text: "text", integer: "integer", number: "numeric", boolean: "boolean", datetime: "timestamptz", email: "varchar", uuid: "uuid", json: "jsonb" };

/** Builds an API spec from a loose description (used by the copilot and the palette). */
export function specFromResources(name: string, resources: Array<{ name: string; fields?: Array<{ name: string; type?: string; required?: boolean; unique?: boolean } | string> }>, auth: ApiSpec["auth"] = "apiKey"): ApiSpec {
  const ident = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "f_$1") || "item";
  return {
    ...starterSpec(),
    name,
    auth,
    resources: resources.map((r) => ({
      ...newResource(ident(r.name).replace(/s$/, "") || "item"),
      protected: auth !== "none",
      fields: (r.fields ?? [{ name: "name" }]).map((f) => {
        const o = typeof f === "string" ? { name: f } : f;
        const type = (FIELD_TYPES as readonly string[]).includes(o.type ?? "") ? (o.type as FieldType) : guessType(o.name);
        return newField({ name: ident(o.name), type, required: o.required ?? true, unique: o.unique ?? false });
      }),
    })),
  };
}
function guessType(name: string): FieldType {
  const n = name.toLowerCase();
  if (/email/.test(n)) return "email";
  if (/_id$/.test(n)) return "uuid";
  if (/(price|amount|total|cost|rating|lat|lng|weight)/.test(n)) return "number";
  if (/(count|qty|quantity|age|stock|year|position)/.test(n)) return "integer";
  if (/^(is_|has_)|active|enabled|published|done/.test(n)) return "boolean";
  if (/(_at|date|time)$/.test(n)) return "datetime";
  if (/(description|body|content|notes|bio)/.test(n)) return "text";
  if (/(meta|data|settings|tags)/.test(n)) return "json";
  return "string";
}

/** Mirrors an API spec as a database schema (one table per resource). */
export function schemaFromSpec(spec: ApiSpec): DbSchema {
  const s = starterSchema();
  s.tables = spec.resources.map((r, i) => {
    const tb = newTable(plural(r.name), 40 + (i % 3) * 280, 40 + Math.floor(i / 3) * 260);
    tb.columns = [
      ...tb.columns.filter((c) => c.pk),
      ...r.fields.map((f) => newColumn({ name: f.name, type: FIELD_TO_COLUMN[f.type], nullable: !f.required, unique: f.unique, length: f.type === "string" || f.type === "email" ? 255 : undefined })),
      ...tb.columns.filter((c) => !c.pk),
      newColumn({ name: "updated_at", type: "timestamptz", nullable: false, default: "now()" }),
    ];
    return tb;
  });
  return s;
}

export function registerDataFunctions() {
  const fns: AppFunction[] = [
    ...TABS.map(([tab, title, keywords]): AppFunction => ({ id: `data.open.${tab}`, title, category: "Data & APIs", keywords: [...keywords], ai: false, run: (_a, ctx) => ctx.navigate(`/data?tab=${tab}`) })),
    {
      id: "data.http.send",
      title: "Send an HTTP request (server-side, {{ secrets.NAME }} supported)",
      category: "Data & APIs",
      keywords: ["fetch", "get", "post", "call api"],
      params: { type: "object", properties: { method: { type: "string" }, url: { type: "string" }, headers: { type: "object" }, body: { type: "string" }, environment: { type: "string", enum: [...ENVIRONMENTS] } }, required: ["url"] },
      run: async (a) => {
        const r = await httpApi.send({ method: String(a.method ?? "GET").toUpperCase(), url: String(a.url), headers: (a.headers as Record<string, string>) ?? {}, body: String(a.body ?? ""), environment: (a.environment as Environment) ?? "development" });
        return { status: r.status, ms: r.ms, contentType: r.headers["content-type"], body: r.body.slice(0, 4000), truncated: r.body.length > 4000 || r.truncated };
      },
    },
    { id: "data.http.saved", title: "List saved API requests", category: "Data & APIs", run: async () => (await httpApi.list()).map(({ id, name, method, url }) => ({ id, name, method, url })) },
    { id: "data.connections", title: "List database connections", category: "Data & APIs", keywords: ["database", "db"], run: async () => (await dataApi.connections()).map(({ id, name, kind }) => ({ id, name, kind })) },
    {
      id: "data.schema.read",
      title: "Read the tables and columns of a database connection",
      category: "Data & APIs",
      params: { type: "object", properties: { connection: { type: "string", description: "Connection id or name" } }, required: ["connection"] },
      run: async (a) => dataApi.schema((await findConnection(String(a.connection))).id),
    },
    {
      id: "data.query",
      title: "Run a read-only query on a database connection",
      category: "Data & APIs",
      keywords: ["sql", "select"],
      params: { type: "object", properties: { connection: { type: "string" }, sql: { type: "string" }, mongo: { type: "object", description: "For MongoDB: { collection, op, filter, limit }" } }, required: ["connection"] },
      run: async (a) => {
        const c = await findConnection(String(a.connection));
        const r = await dataApi.query(c.id, c.kind === "mongodb" ? { mongo: a.mongo, readOnly: true } : { sql: String(a.sql ?? ""), readOnly: true });
        return { columns: r.columns, rows: r.rows.slice(0, 50), rowCount: r.rowCount, ms: r.ms };
      },
    },
    {
      id: "data.query.csv",
      title: "Run a read-only query and download the result as CSV",
      category: "Data & APIs",
      ai: false,
      params: { type: "object", properties: { connection: { type: "string" }, sql: { type: "string" } }, required: ["connection", "sql"] },
      run: async (a) => {
        const c = await findConnection(String(a.connection));
        const r = await dataApi.query(c.id, { sql: String(a.sql), readOnly: true });
        const { toCsv } = await import("./dataApi");
        downloadText("query.csv", toCsv(r.columns, r.rows), "text/csv");
      },
    },
    {
      id: "data.api.create",
      title: "Create a REST API project from resources (e.g. products with name, price)",
      category: "Data & APIs",
      keywords: ["backend", "crud", "generate api", "rest"],
      params: {
        type: "object",
        properties: {
          name: { type: "string" },
          auth: { type: "string", enum: ["none", "apiKey", "jwt"] },
          resources: { type: "array", items: { type: "object", properties: { name: { type: "string" }, fields: { type: "array", items: { type: "object", properties: { name: { type: "string" }, type: { type: "string", enum: [...FIELD_TYPES] }, required: { type: "boolean" }, unique: { type: "boolean" } }, required: ["name"] } } }, required: ["name"] } },
        },
        required: ["name"],
      },
      run: async (a, ctx) => {
        const resources = (a.resources as Parameters<typeof specFromResources>[1]) ?? [{ name: "item", fields: ["name", "description"] }];
        const spec = specFromResources(String(a.name), resources, (a.auth as ApiSpec["auth"]) ?? "apiKey");
        const problems = validateSpec(spec);
        if (problems.length) throw new Error(problems.join("; "));
        const p = await projectsApi.create(spec.name, "api", spec);
        ctx.navigate(`/data?tab=api&project=${p.id}`);
        return { id: p.id, resources: spec.resources.map((r) => r.name), files: Object.keys(generateApi(spec)).length };
      },
    },
    {
      id: "data.api.download",
      title: "Download a generated API project as ZIP",
      category: "Data & APIs",
      ai: false,
      params: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
      run: async (a) => {
        const p = await projectsApi.get(String(a.projectId));
        if (!isApiSpec(p.data)) throw new Error("That project is not an API spec");
        const { zip } = await import("../builder/projectExport");
        const root = slugify(p.name) || "api";
        downloadBlob(`${root}.zip`, new Blob([zip(generateApi(p.data), root) as BlobPart], { type: "application/zip" }));
      },
    },
    {
      id: "data.api.to-schema",
      title: "Create a database schema from an API project",
      category: "Data & APIs",
      params: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
      run: async (a, ctx) => {
        const p = await projectsApi.get(String(a.projectId));
        if (!isApiSpec(p.data)) throw new Error("That project is not an API spec");
        const s = await projectsApi.create(`${p.name} database`, "db", schemaFromSpec(p.data));
        ctx.navigate(`/data?tab=schema&project=${s.id}`);
        return { id: s.id };
      },
    },
    {
      id: "data.schema.create",
      title: "Create a database schema project",
      category: "Data & APIs",
      keywords: ["tables", "er diagram"],
      params: { type: "object", properties: { name: { type: "string" } } },
      run: async (a, ctx) => {
        const p = await projectsApi.create(String(a.name ?? "App database"), "db", starterSchema());
        ctx.navigate(`/data?tab=schema&project=${p.id}`);
        return { id: p.id };
      },
    },
    {
      id: "data.schema.sql",
      title: "Download a schema project's CREATE TABLE SQL",
      category: "Data & APIs",
      ai: false,
      params: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
      run: async (a) => {
        const p = await projectsApi.get(String(a.projectId));
        if (!isDbSchema(p.data)) throw new Error("That project is not a database schema");
        downloadText(`${slugify(p.name)}.sql`, createSchemaSql(p.data), "application/sql");
      },
    },
    { id: "data.wf.list", title: "List workflows", category: "Data & APIs · Workflows", run: async () => (await workflowApi.list()).map(({ id, name, enabled, trigger, nextRun, lastRun }) => ({ id, name, enabled, trigger, nextRun, lastStatus: lastRun?.status ?? null })) },
    {
      id: "data.wf.create",
      title: "Create a workflow (optionally from a list of steps)",
      category: "Data & APIs · Workflows",
      keywords: ["automation", "cron", "webhook"],
      params: {
        type: "object",
        properties: {
          name: { type: "string" },
          trigger: { type: "string", enum: ["manual", "webhook", "schedule"] },
          cron: { type: "string" },
          steps: { type: "array", items: { type: "object", properties: { type: { type: "string", enum: ["http", "set", "delay", "email", "log", "transform"] }, name: { type: "string" }, config: { type: "object" } }, required: ["type"] } },
        },
        required: ["name"],
      },
      run: async (a, ctx) => {
        const nodes: WfGraph["nodes"] = [{ id: "trigger", type: "trigger", name: "trigger", config: { mode: a.trigger ?? "manual", ...(a.trigger === "schedule" ? { cron: a.cron ?? "0 9 * * *" } : {}) }, next: null, x: 40, y: 60 }];
        for (const st of (a.steps as Array<{ type: NodeType; name?: string; config?: Record<string, unknown> }>) ?? [{ type: "log" }]) {
          const nn = newNode(st.type, nodes, 40 + nodes.length * 260, 60);
          if (st.name) nn.name = st.name;
          nn.config = { ...nn.config, ...(st.config ?? {}) };
          nodes[nodes.length - 1].next = nn.id;
          nodes.push(nn);
        }
        const id = await workflowApi.create(String(a.name), { nodes });
        ctx.navigate(`/data?tab=workflows&workflow=${id}`);
        return { id };
      },
    },
    {
      id: "data.wf.run",
      title: "Run a workflow now",
      category: "Data & APIs · Workflows",
      params: { type: "object", properties: { workflow: { type: "string", description: "Workflow id or name" } }, required: ["workflow"] },
      run: async (a) => {
        const r = await workflowApi.run((await findWorkflow(String(a.workflow))).id);
        if (r) toast(r.status === "succeeded" ? "Workflow succeeded" : `Workflow failed: ${r.error}`, r.status === "succeeded" ? "success" : "error");
        return r && { status: r.status, error: r.error, steps: r.log.map((s) => ({ name: s.name, status: s.status, ms: s.ms })) };
      },
    },
    ...([true, false] as const).map((on): AppFunction => ({
      id: `data.wf.${on ? "enable" : "disable"}`,
      title: `${on ? "Enable" : "Disable"} a workflow`,
      category: "Data & APIs · Workflows",
      params: { type: "object", properties: { workflow: { type: "string" } }, required: ["workflow"] },
      run: async (a) => {
        const w = await findWorkflow(String(a.workflow));
        await workflowApi.save(w.id, { name: w.name, graph: w.graph, enabled: on, environment: w.environment });
        return { id: w.id, enabled: on };
      },
    })),
    {
      id: "data.json.table",
      title: "Convert JSON (array of objects) to table columns and rows",
      category: "Data & APIs",
      params: { type: "object", properties: { json: { type: "string" } }, required: ["json"] },
      run: (a) => toTable(JSON.parse(String(a.json))) ?? { error: "Not tabular JSON" },
    },
  ];
  registry.register(fns);
}
