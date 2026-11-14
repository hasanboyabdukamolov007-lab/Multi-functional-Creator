import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { assertSafeUrl, guardedFetch, isPrivateIp } from "./lib/netGuard.js";
import { renderString, renderValue, referencedSecrets } from "./lib/templating.js";
import { cronMatches, lastOccurrence, nextOccurrence, parseCron } from "./lib/cron.js";
import { tickSchedules } from "./lib/workflows.js";

describe("network guard", () => {
  it("classifies private and public addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) expect(isPrivateIp(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111"]) expect(isPrivateIp(ip), ip).toBe(false);
  });

  it("rejects unsafe URLs", () => {
    expect(() => assertSafeUrl("file:///etc/passwd", false)).toThrow(/http/);
    expect(() => assertSafeUrl("http://169.254.169.254/latest/meta-data", false)).toThrow(/blocked/);
    expect(() => assertSafeUrl("http://user:pw@example.com", false)).toThrow(/headers/);
    expect(() => assertSafeUrl("http://localhost:8080", false)).toThrow(/blocked/);
    expect(assertSafeUrl("https://api.example.com/v1", false).host).toBe("api.example.com");
  });
});

describe("templating and cron", () => {
  it("renders paths, keeps types for single placeholders and resolves secrets", async () => {
    const ctx = { steps: { http: { body: { items: [{ id: 7 }], ok: true } } }, vars: { n: 3 } };
    expect(await renderString("id={{ steps.http.body.items[0].id }} n={{vars.n}}", ctx)).toBe("id=7 n=3");
    expect(await renderValue("{{ steps.http.body.ok }}", ctx)).toBe(true);
    expect(await renderString("Bearer {{ secrets.TOKEN }}", ctx, async (n) => `val-${n}`)).toBe("Bearer val-TOKEN");
    expect(referencedSecrets("{{secrets.A}} {{ secrets.B }} {{vars.x}}")).toEqual(["A", "B"]);
  });

  it("parses and evaluates cron expressions in UTC", () => {
    const c = parseCron("*/15 9-17 * * 1-5");
    expect(cronMatches(c, new Date("2026-11-16T09:30:00Z"))).toBe(true); // Monday
    expect(cronMatches(c, new Date("2026-11-15T09:30:00Z"))).toBe(false); // Sunday
    expect(nextOccurrence("0 0 * * *", new Date("2026-11-16T10:00:00Z"))?.toISOString()).toBe("2026-11-17T00:00:00.000Z");
    expect(lastOccurrence("@hourly", new Date("2026-11-16T10:42:10Z"))?.toISOString()).toBe("2026-11-16T10:00:00.000Z");
    expect(() => parseCron("61 * * * *")).toThrow(/range/);
  });
});

describe("guarded fetch, API tester and workflows", () => {
  let target: http.Server;
  let base = "";
  let app: FastifyInstance;
  let strict: FastifyInstance;
  const H = { "x-mfc-csrf": "1" };
  const seen: Array<{ url: string; auth?: string; body: string }> = [];

  async function login(a: FastifyInstance, email: string) {
    const r = await a.inject({ method: "POST", url: "/api/auth/magic-link", headers: H, payload: { email } });
    const token = new URL(r.json().devLink).searchParams.get("token")!;
    const v = await a.inject({ method: "POST", url: "/api/auth/verify", headers: H, payload: { token } });
    const headers = { ...H, cookie: `mfc_session=${v.cookies.find((c) => c.name === "mfc_session")!.value}` };
    const me = (await a.inject({ method: "GET", url: "/api/auth/me", headers })).json();
    return { headers, ws: me.workspaces[0].id as string };
  }

  beforeAll(async () => {
    target = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen.push({ url: req.url ?? "", auth: req.headers.authorization, body });
        if (req.url === "/redirect-private") {
          res.writeHead(302, { location: "http://169.254.169.254/latest" });
          return res.end();
        }
        if (req.url === "/fail") {
          res.writeHead(500);
          return res.end("boom");
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, items: [{ id: 42, name: "Widget" }], echo: body ? JSON.parse(body) : null }));
      });
    });
    await new Promise<void>((r) => target.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(target.address() as AddressInfo).port}`;
    app = await buildApp(loadConfig({ env: "test", inMemoryDb: true, webDist: undefined, allowPrivateNetwork: true, cronSecret: "tick-secret" }));
    strict = await buildApp(loadConfig({ env: "test", inMemoryDb: true, webDist: undefined, allowPrivateNetwork: false }));
  });
  afterAll(async () => {
    await app.close();
    await strict.close();
    target.close();
  });

  it("blocks private targets unless allowed, including through redirects", async () => {
    await expect(guardedFetch(`${base}/x`, {}, { allowPrivate: false })).rejects.toThrow(/blocked/);
    const ok = await guardedFetch(`${base}/x`, {}, { allowPrivate: true });
    expect(ok.status).toBe(200);
    // A public-looking start that redirects to the metadata service must still be refused.
    await expect(guardedFetch(`${base}/redirect-private`, {}, { allowPrivate: false })).rejects.toThrow(/blocked/);
  });

  it("API tester proxies requests, substitutes vault secrets and redacts them", async () => {
    const s = await login(strict, "strict@example.com");
    const blocked = await strict.inject({ method: "POST", url: `/api/w/${s.ws}/http/send`, headers: s.headers, payload: { method: "GET", url: `${base}/x` } });
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().code).toBe("blocked_address");

    const { headers, ws } = await login(app, "tester@example.com");
    await app.inject({ method: "POST", url: `/api/w/${ws}/secrets`, headers, payload: { name: "API_TOKEN", value: "tok_super_secret_123", environment: "development" } });
    const r = await app.inject({ method: "POST", url: `/api/w/${ws}/http/send`, headers, payload: { method: "POST", url: `${base}/echo`, headers: { Authorization: "Bearer {{ secrets.API_TOKEN }}", "content-type": "application/json" }, body: '{"token":"{{ secrets.API_TOKEN }}"}' } });
    expect(r.statusCode).toBe(200);
    expect(seen.at(-1)!.auth).toBe("Bearer tok_super_secret_123");
    expect(r.json().body).not.toContain("tok_super_secret_123");
    expect(r.json().body).toContain("•••");
    const missing = await app.inject({ method: "POST", url: `/api/w/${ws}/http/send`, headers, payload: { method: "GET", url: `${base}/x`, headers: { Authorization: "{{ secrets.NOPE }}" } } });
    expect(missing.statusCode).toBe(400);
  });

  it("runs workflows: http step, branching, variables, secrets redacted in logs, webhooks and schedules", async () => {
    const { headers, ws } = await login(app, "flows@example.com");
    await app.inject({ method: "POST", url: `/api/w/${ws}/secrets`, headers, payload: { name: "HOOK_KEY", value: "hk_live_abcdef123456", environment: "production" } });
    const id = (await app.inject({ method: "POST", url: `/api/w/${ws}/workflows`, headers, payload: { name: "Sync" } })).json().id;
    const graph = {
      nodes: [
        { id: "t", type: "trigger", name: "trigger", config: { mode: "webhook" }, next: "fetch" },
        { id: "fetch", type: "http", name: "fetch", config: { method: "POST", url: `${base}/items`, headers: { Authorization: "Key {{ secrets.HOOK_KEY }}" }, body: '{"from":"{{ trigger.body.source }}"}' }, next: "check" },
        { id: "check", type: "condition", name: "check", config: { left: "{{ steps.fetch.body.items[0].id }}", op: "gt", right: "10" }, onTrue: "set", onFalse: "nope" },
        { id: "set", type: "set", name: "set", config: { vars: { item: "{{ steps.fetch.body.items[0].name }}" } }, next: "done" },
        { id: "done", type: "log", name: "done", config: { message: "Got {{ vars.item }} with key {{ secrets.HOOK_KEY }}" }, next: null },
        { id: "nope", type: "log", name: "nope", config: { message: "small" }, next: null },
      ],
    };
    const put = await app.inject({ method: "PUT", url: `/api/w/${ws}/workflows/${id}`, headers, payload: { name: "Sync", graph, enabled: true, environment: "production" } });
    expect(put.json().problems).toEqual([]);
    const wf = (await app.inject({ method: "GET", url: `/api/w/${ws}/workflows/${id}`, headers })).json().workflow;

    const hook = await app.inject({ method: "POST", url: wf.webhookPath, payload: { source: "crm" } });
    expect(hook.json()).toMatchObject({ ok: true, status: "succeeded" });
    expect(seen.at(-1)).toMatchObject({ auth: "Key hk_live_abcdef123456", body: '{"from":"crm"}' });
    const bad = await app.inject({ method: "POST", url: wf.webhookPath.replace(/[^/]+$/, "wrong-token"), payload: {} });
    expect(bad.statusCode).toBe(404);

    const runs = (await app.inject({ method: "GET", url: `/api/w/${ws}/workflows/${id}/runs`, headers })).json().runs;
    const log = runs[0].log as Array<{ name: string; output?: string }>;
    expect(log.map((l) => l.name)).toEqual(["trigger", "fetch", "check", "set", "done"]);
    expect(log.at(-1)!.output).toContain("Got Widget with key •••");
    expect(JSON.stringify(runs)).not.toContain("hk_live_abcdef123456");

    // A failing step marks the run failed with a clear error.
    graph.nodes[1].config.url = `${base}/fail`;
    await app.inject({ method: "PUT", url: `/api/w/${ws}/workflows/${id}`, headers, payload: { name: "Sync", graph, enabled: true } });
    const failed = (await app.inject({ method: "POST", url: `/api/w/${ws}/workflows/${id}/run`, headers, payload: {} })).json().run;
    expect(failed.status).toBe("failed");
    expect(failed.error).toMatch(/HTTP 500/);
  });

  it("refuses to enable invalid workflows and runs schedules once per occurrence", async () => {
    const { headers, ws } = await login(app, "sched@example.com");
    const id = (await app.inject({ method: "POST", url: `/api/w/${ws}/workflows`, headers, payload: { name: "Nightly" } })).json().id;
    const bad = await app.inject({ method: "PUT", url: `/api/w/${ws}/workflows/${id}`, headers, payload: { name: "Nightly", enabled: true, graph: { nodes: [{ id: "t", type: "trigger", name: "t", config: { mode: "schedule", cron: "bad" } }] } } });
    expect(bad.statusCode).toBe(400);
    const graph = { nodes: [{ id: "t", type: "trigger", name: "t", config: { mode: "schedule", cron: "* * * * *" }, next: "l" }, { id: "l", type: "log", name: "l", config: { message: "tick" }, next: null }] };
    await app.inject({ method: "PUT", url: `/api/w/${ws}/workflows/${id}`, headers, payload: { name: "Nightly", enabled: true, graph } });
    const now = new Date(Date.now() + 61_000);
    const first = await tickSchedules(app.deps, now);
    const second = await tickSchedules(app.deps, now);
    expect(first).toBeGreaterThanOrEqual(1);
    expect(second).toBe(0);
    expect((await app.inject({ method: "GET", url: "/api/cron/tick" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/cron/tick", headers: { authorization: "Bearer tick-secret" } })).statusCode).toBe(200);
  });
});

describe.skipIf(!process.env.TEST_PG_URL)("data browser (real PostgreSQL)", () => {
  let app: FastifyInstance;
  const H = { "x-mfc-csrf": "1" };
  beforeAll(async () => {
    app = await buildApp(loadConfig({ env: "test", inMemoryDb: true, webDist: undefined }));
  });
  afterAll(async () => app.close());

  it("connects through a vault secret, reads schema, enforces read-only and audits", async () => {
    const r = await app.inject({ method: "POST", url: "/api/auth/magic-link", headers: H, payload: { email: "data@example.com" } });
    const token = new URL(r.json().devLink).searchParams.get("token")!;
    const v = await app.inject({ method: "POST", url: "/api/auth/verify", headers: H, payload: { token } });
    const headers = { ...H, cookie: `mfc_session=${v.cookies.find((c) => c.name === "mfc_session")!.value}` };
    const ws = (await app.inject({ method: "GET", url: "/api/auth/me", headers })).json().workspaces[0].id;
    const secret = (await app.inject({ method: "POST", url: `/api/w/${ws}/secrets`, headers, payload: { name: "DB_URL", value: process.env.TEST_PG_URL, environment: "development" } })).json().secret;
    const bad = await app.inject({ method: "POST", url: `/api/w/${ws}/data/connections`, headers, payload: { name: "x", kind: "mysql", secretId: secret.id } });
    expect(bad.statusCode).toBe(400);
    const conn = (await app.inject({ method: "POST", url: `/api/w/${ws}/data/connections`, headers, payload: { name: "Local PG", kind: "postgres", secretId: secret.id } })).json().id;
    const q = (sql: string, readOnly = true) => app.inject({ method: "POST", url: `/api/w/${ws}/data/connections/${conn}/query`, headers, payload: { sql, readOnly } });
    await q("DROP TABLE IF EXISTS mfc_items; CREATE TABLE mfc_items (id int primary key, name text)", false);
    await q("INSERT INTO mfc_items VALUES (1, 'alpha'), (2, 'beta')", false);
    const sel = (await q("SELECT id, name FROM mfc_items ORDER BY id")).json();
    expect(sel).toMatchObject({ columns: ["id", "name"], rows: [[1, "alpha"], [2, "beta"]], rowCount: 2 });
    const ro = await q("DELETE FROM mfc_items");
    expect(ro.statusCode).toBe(400);
    expect(ro.json().error).toMatch(/read-only/i);
    const schema = (await app.inject({ method: "GET", url: `/api/w/${ws}/data/connections/${conn}/schema`, headers })).json().tables;
    expect(schema.find((t: { name: string }) => t.name === "public.mfc_items").columns.map((c: { name: string }) => c.name)).toEqual(["id", "name"]);
    // Reverse engineering: primary and foreign keys come back with the columns.
    await q("DROP TABLE IF EXISTS mfc_tags; CREATE TABLE mfc_tags (id serial primary key, item_id int references mfc_items(id), label text not null default 'x')", false);
    const s2 = (await app.inject({ method: "GET", url: `/api/w/${ws}/data/connections/${conn}/schema`, headers })).json().tables;
    const tags = s2.find((t: { name: string }) => t.name === "public.mfc_tags").columns;
    expect(tags[0]).toMatchObject({ name: "id", pk: true, nullable: false });
    expect(tags[1]).toMatchObject({ name: "item_id", pk: false, references: { table: "public.mfc_items", column: "id" } });
    expect(tags[2]).toMatchObject({ name: "label", nullable: false, references: null });
    await q("DROP TABLE mfc_tags", false);
    await q("DROP TABLE mfc_items", false);
    const audit = (await app.inject({ method: "GET", url: `/api/w/${ws}/audit`, headers })).json().events.map((e: { action: string }) => e.action);
    expect(audit).toEqual(expect.arrayContaining(["data.query", "data.write", "data.query.error", "data.connection.add"]));
  });
});
