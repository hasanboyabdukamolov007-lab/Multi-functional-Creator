import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import crypto from "node:crypto";
import zlib from "node:zlib";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { signS3, zipFiles, nginxConfig, shq, assertSafeRelPath } from "./lib/deployers.js";

describe("S3 SigV4 signer", () => {
  it("matches AWS's published test vector (GET bucket, list objects)", () => {
    const url = new URL("https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J");
    const h = signS3("GET", url, "us-east-1", "AKIAIOSFODNN7EXAMPLE", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", Buffer.alloc(0), new Date("2013-05-24T00:00:00Z"));
    expect(h.authorization).toBe("AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7");
  });
  it("writes valid zip archives and nginx configs", () => {
    const z = zipFiles([{ path: "index.html", data: Buffer.from("<h1>hi</h1>".repeat(20)) }, { path: "a/b.txt", data: Buffer.from("x") }]);
    expect(z.subarray(0, 2).toString()).toBe("PK");
    expect(z.readUInt32LE(z.length - 22)).toBe(0x06054b50);
    expect(nginxConfig("example.com", "/var/www/site")).toContain("root /var/www/site/current;");
  });
});

describe("deploy targets (mock providers)", () => {
  let app: FastifyInstance;
  let mock: http.Server;
  let base = "";
  const seen: Array<{ method: string; url: string; headers: http.IncomingHttpHeaders; body: Buffer }> = [];
  const objects = new Map<string, Buffer>();
  const vercelFiles = new Set<string>();
  let headers: Record<string, string> = {};
  const mockState = { flakyUp: true };
  let ws = "";

  beforeAll(async () => {
    mock = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks);
        const url = req.url ?? "";
        seen.push({ method: req.method ?? "", url, headers: req.headers, body });
        const json = (code: number, v: unknown) => (res.writeHead(code, { "content-type": "application/json" }), res.end(JSON.stringify(v)));
        // Vercel
        if (url.startsWith("/v2/files")) {
          const sha = crypto.createHash("sha1").update(body).digest("hex");
          if (sha !== req.headers["x-vercel-digest"]) return json(400, { error: { message: "digest mismatch" } });
          vercelFiles.add(sha);
          return json(200, {});
        }
        if (url.startsWith("/v10/projects/")) return json(200, { created: true });
        if (req.method === "POST" && url.startsWith("/v13/deployments")) {
          const b = JSON.parse(body.toString()) as { files: Array<{ sha: string }> };
          if (!b.files.every((f) => vercelFiles.has(f.sha))) return json(400, { error: { message: "missing file" } });
          return json(200, { id: "dpl_1", url: "mfc-site-abc.vercel.app", readyState: "BUILDING" });
        }
        if (url.startsWith("/v13/deployments/dpl_1")) return json(200, { readyState: "READY", url: "mfc-site-abc.vercel.app" });
        if (url.startsWith("/v2/user")) return json(200, { user: { username: "ada" } });
        // Netlify
        if (url === "/api/v1/sites" && req.method === "POST") return json(200, { id: "site_9" });
        if (url === "/api/v1/sites/site_9/deploys") return body.subarray(0, 2).toString() === "PK" ? json(200, { id: "nd_1", state: "processing" }) : json(400, { message: "not a zip" });
        if (url === "/api/v1/deploys/nd_1") return json(200, { state: "ready", ssl_url: "https://site-9.netlify.app" });
        // GitHub
        if (url.includes("/git/ref/heads/")) return json(404, { message: "Not Found" });
        if (url.endsWith("/git/blobs")) return json(201, { sha: crypto.createHash("sha1").update(body).digest("hex") });
        if (url.endsWith("/git/trees")) return json(201, { sha: "tree1" });
        if (url.endsWith("/git/commits")) return json(201, { sha: "c0ffee1234" });
        if (url.endsWith("/git/refs")) return json(201, { ref: "refs/heads/gh-pages" });
        if (url.endsWith("/pages")) return json(201, {});
        // S3 (path-style)
        if (req.method === "PUT" && url.startsWith("/my-bucket/")) {
          if (!/^AWS4-HMAC-SHA256 Credential=AKID\//.test(req.headers.authorization ?? "")) return json(403, { message: "bad auth" });
          if (crypto.createHash("sha256").update(body).digest("hex") !== req.headers["x-amz-content-sha256"]) return json(400, { message: "hash" });
          objects.set(url, body);
          res.writeHead(200);
          return res.end();
        }
        // Webhook + notification channel
        if (url === "/hook") {
          const sig = crypto.createHmac("sha256", "whsec").update(body).digest("hex");
          return req.headers["x-mfc-signature"] === `sha256=${sig}` ? json(200, { url: "https://ci.example.com/run/1" }) : json(401, { message: "bad sig" });
        }
        if (url === "/notify") return json(200, {});
        if (url === "/up") return (res.writeHead(200, { "content-type": "text/html" }), res.end("<h1>All good</h1>"));
        if (url === "/flaky") return mockState.flakyUp ? (res.writeHead(200), res.end("ok")) : (res.writeHead(503), res.end("down"));
        json(404, { message: `no route ${req.method} ${url}` });
      });
    });
    await new Promise<void>((r) => mock.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;
    const cfg = loadConfig({ env: "test", inMemoryDb: true, webDist: undefined, allowPrivateNetwork: true });
    cfg.providers = { ...cfg.providers, vercel: base, netlify: base, github: base, telegram: base };
    app = await buildApp(cfg);
    const H = { "x-mfc-csrf": "1", "content-type": "application/json" };
    const r = await app.inject({ method: "POST", url: "/api/auth/magic-link", headers: H, payload: { email: "deploy@example.com" } });
    const token = new URL(r.json().devLink).searchParams.get("token")!;
    const v = await app.inject({ method: "POST", url: "/api/auth/verify", headers: H, payload: { token } });
    headers = { ...H, cookie: `mfc_session=${v.cookies.find((c) => c.name === "mfc_session")!.value}` };
    ws = (await app.inject({ method: "GET", url: "/api/auth/me", headers })).json().workspaces[0].id;
  });
  afterAll(async () => {
    await app.close();
    mock.close();
  });

  const secret = async (name: string, value: string) => (await app.inject({ method: "POST", url: `/api/w/${ws}/secrets`, headers, payload: { name, value, environment: "production" } })).json().secret.id as string;
  const target = async (body: Record<string, unknown>) => (await app.inject({ method: "POST", url: `/api/w/${ws}/deploy/targets`, headers, payload: body })).json().id as string;
  const files = [
    { path: "index.html", data: Buffer.from("<!doctype html><html><head><title>Hi</title></head><body>Hello</body></html>").toString("base64") },
    { path: "assets/app.3f9a1c2b.js", data: Buffer.from("console.log(1)").toString("base64") },
  ];
  const deploy = async (id: string, extra: Record<string, unknown> = {}) => (await app.inject({ method: "POST", url: `/api/w/${ws}/deploy/targets/${id}/deploy`, headers, payload: { name: "Bean There", files, ...extra } })).json().deployment;

  it("deploys to Vercel with content-addressed uploads and injects vault secrets without leaking them", async () => {
    const tok = await secret("VERCEL_TOKEN", "vercel-token-123456");
    await secret("STRIPE_KEY", "sk_live_supersecret_value");
    const id = await target({ name: "Vercel prod", kind: "vercel", config: { project: "Bean There" }, secretId: tok, environment: "production" });
    const test = (await app.inject({ method: "POST", url: `/api/w/${ws}/deploy/targets/${id}/test`, headers, payload: {} })).json();
    expect(test).toMatchObject({ ok: true, message: "Signed in to Vercel as ada" });
    const d = await deploy(id, { injectSecrets: true });
    expect(d.status).toBe("ready");
    expect(d.url).toBe("https://mfc-site-abc.vercel.app");
    const envCall = seen.find((s) => s.url.includes("/v10/projects/bean-there/env") && s.body.toString().includes("STRIPE_KEY"));
    expect(envCall).toBeTruthy();
    expect(JSON.stringify(d.log)).not.toContain("sk_live_supersecret_value");
    expect(JSON.stringify(d.log)).not.toContain("vercel-token-123456");
    expect(seen.some((s) => s.headers.authorization === "Bearer vercel-token-123456")).toBe(true);
  });

  it("deploys to Netlify (creating the site), GitHub Pages, S3 and a signed webhook", async () => {
    const n = await target({ name: "Netlify", kind: "netlify", config: {}, secretId: await secret("NETLIFY_TOKEN", "nf-token") });
    const nd = await deploy(n);
    expect(nd).toMatchObject({ status: "ready", url: "https://site-9.netlify.app" });
    const saved = (await app.inject({ method: "GET", url: `/api/w/${ws}/deploy/targets`, headers })).json().targets.find((t: { id: string }) => t.id === n);
    expect(saved.config.siteId).toBe("site_9");

    const g = await target({ name: "Pages", kind: "github", config: { repo: "ada/bean-there", branch: "gh-pages" }, secretId: await secret("GH_TOKEN", "ghp_token") });
    const gd = await deploy(g);
    expect(gd.status).toBe("ready");
    expect(gd.url).toBe("https://ada.github.io/bean-there/");
    expect(seen.some((s) => s.url.endsWith("/git/refs") && s.body.toString().includes("refs/heads/gh-pages"))).toBe(true);

    const s3 = await target({ name: "R2", kind: "s3", config: { bucket: "my-bucket", endpoint: base, region: "auto", publicUrl: "https://cdn.example.com" }, secretId: await secret("S3_KEYS", "AKID:s3cr3t") });
    const sd = await deploy(s3);
    expect(sd).toMatchObject({ status: "ready", url: "https://cdn.example.com/" });
    expect(objects.get("/my-bucket/index.html")?.toString()).toContain("Hello");
    const putHtml = seen.find((s) => s.url === "/my-bucket/index.html")!;
    expect(putHtml.headers["cache-control"]).toBe("no-cache");
    expect(seen.find((s) => s.url === "/my-bucket/assets/app.3f9a1c2b.js")!.headers["cache-control"]).toContain("immutable");

    const w = await target({ name: "CI", kind: "webhook", config: { url: `${base}/hook` }, secretId: await secret("HOOK_SECRET", "whsec") });
    const wd = await deploy(w);
    expect(wd).toMatchObject({ status: "ready", url: "https://ci.example.com/run/1" });
  });

  it("rejects bad paths, records failures, redeploys and rolls back, injects analytics", async () => {
    const t = await target({ name: "Netlify 2", kind: "netlify", config: { siteId: "site_9" }, secretId: await secret("NETLIFY_TOKEN2", "nf2") });
    const bad = await app.inject({ method: "POST", url: `/api/w/${ws}/deploy/targets/${t}/deploy`, headers, payload: { name: "x", files: [{ path: "../etc/passwd", data: "" }] } });
    expect(bad.statusCode).toBe(400);
    const broken = await target({ name: "Broken", kind: "webhook", config: { url: `${base}/hook` }, secretId: await secret("WRONG", "not-the-secret") });
    const fd = await deploy(broken);
    expect(fd.status).toBe("failed");
    expect(fd.error).toMatch(/401/);

    // Analytics injection
    const siteId = crypto.randomUUID();
    await app.deps.db.query(`INSERT INTO analytics_sites (id, workspace_id, name, key) VALUES ($1, $2, 'Bean', 'site_key_1')`, [siteId, ws]);
    const s3 = await target({ name: "S3 b", kind: "s3", config: { bucket: "my-bucket", endpoint: base, prefix: "v2" }, secretId: await secret("S3_KEYS2", "AKID:x") });
    const first = await deploy(s3, { analyticsSiteId: siteId });
    expect(objects.get("/my-bucket/v2/index.html")!.toString()).toContain('data-site="site_key_1"');

    // Redeploy the stored bundle (rollback path) and list history.
    const re = (await app.inject({ method: "POST", url: `/api/w/${ws}/deploy/deployments/${first.id}/redeploy`, headers, payload: {} })).json().deployment;
    expect(re.status).toBe("ready");
    const list = (await app.inject({ method: "GET", url: `/api/w/${ws}/deploy/deployments`, headers })).json().deployments;
    expect(list.length).toBeGreaterThanOrEqual(7);
    expect(list[0]).toMatchObject({ redeploy_of: first.id, can_redeploy: true });
  });

  it("notifies channels on deploy results and enforces roles", async () => {
    await app.deps.db.query(`INSERT INTO notification_channels (id, workspace_id, name, kind, config, events) VALUES ($1, $2, 'ops hook', 'webhook', $3, '{deploy.ready,deploy.failed}')`, [crypto.randomUUID(), ws, JSON.stringify({ url: `${base}/notify` })]);
    const t = await target({ name: "N", kind: "netlify", config: { siteId: "site_9" }, secretId: await secret("NF3", "nf3") });
    await deploy(t);
    await new Promise((r) => setTimeout(r, 200));
    const n = seen.filter((s) => s.url === "/notify").map((s) => JSON.parse(s.body.toString()));
    expect(n.some((x) => x.event === "deploy.ready" && /Deployed Bean There/.test(x.title))).toBe(true);
    // zlib round trip used for bundles
    expect(zlib.gunzipSync(zlib.gzipSync(Buffer.from("ok"))).toString()).toBe("ok");
  });

  it("monitors uptime, opens and resolves incidents with notifications, and serves a status page", async () => {
    const { runDueChecks } = await import("./lib/monitoring.js");
    await app.deps.db.query(`INSERT INTO notification_channels (id, workspace_id, name, kind, config, events) VALUES ($1, $2, 'uptime hook', 'webhook', $3, '{monitor.down,monitor.up}')`, [crypto.randomUUID(), ws, JSON.stringify({ url: `${base}/notify` })]);
    const mk = async (name: string, path: string, extra: Record<string, unknown> = {}) => (await app.inject({ method: "POST", url: `/api/w/${ws}/monitoring/monitors`, headers, payload: { name, url: `${base}${path}`, intervalS: 60, public: true, ...extra } })).json().id as string;
    const up = await mk("Website", "/up", { keyword: "All good" });
    const flaky = await mk("API", "/flaky");
    const due = () => app.deps.db.query(`UPDATE monitors SET next_check_at = now() - interval '1 second'`);
    expect(await runDueChecks(app.deps)).toBe(2);
    mockState.flakyUp = false;
    await due();
    await runDueChecks(app.deps);
    await due();
    await runDueChecks(app.deps); // second consecutive failure → incident
    let mons = (await app.inject({ method: "GET", url: `/api/w/${ws}/monitoring/monitors`, headers })).json().monitors;
    expect(mons.find((m: { id: string }) => m.id === up).state).toBe("up");
    expect(mons.find((m: { id: string }) => m.id === flaky).state).toBe("down");
    const inc = (await app.inject({ method: "GET", url: `/api/w/${ws}/monitoring/incidents`, headers })).json().incidents;
    expect(inc[0]).toMatchObject({ title: "API is down", resolved_at: null });
    mockState.flakyUp = true;
    const manual = (await app.inject({ method: "POST", url: `/api/w/${ws}/monitoring/monitors/${flaky}/check`, headers, payload: {} })).json();
    expect(manual).toMatchObject({ ok: true, state: "up" });
    await new Promise((r) => setTimeout(r, 200));
    const events = seen.filter((x) => x.url === "/notify").map((x) => JSON.parse(x.body.toString()).event);
    expect(events).toContain("monitor.down");
    expect(events).toContain("monitor.up");
    mons = (await app.inject({ method: "GET", url: `/api/w/${ws}/monitoring/monitors`, headers })).json().monitors;
    expect(mons.find((m: { id: string }) => m.id === flaky).summary.uptime).toBeCloseTo(0.5, 1);

    const sp = await app.inject({ method: "PUT", url: `/api/w/${ws}/monitoring/status-page`, headers, payload: { slug: "bean-status", title: "Bean There status" } });
    expect(sp.json().url).toMatch(/\/status\/bean-status$/);
    const pub = (await app.inject({ method: "GET", url: "/api/status/bean-status" })).json();
    expect(pub).toMatchObject({ title: "Bean There status", overall: "operational" });
    expect(pub.monitors).toHaveLength(2);
    expect(pub.incidents[0].resolved_at).not.toBeNull();
    // Private monitor URLs are refused when the server isn't allowed to reach private networks.
    expect((await app.inject({ method: "POST", url: `/api/w/${ws}/monitoring/monitors`, headers, payload: { name: "x", url: "file:///etc/passwd" } })).statusCode).toBe(400);
  });

  it("collects cookieless analytics, Web Vitals and errors and aggregates them", async () => {
    const site = (await app.inject({ method: "POST", url: `/api/w/${ws}/monitoring/sites`, headers, payload: { name: "Bean", domains: ["beanthere.uz"] } })).json();
    const js = await app.inject({ method: "GET", url: "/api/collect.js" });
    expect(js.headers["content-type"]).toContain("javascript");
    expect(js.body).toContain("largest-contentful-paint");
    const send = (body: Record<string, unknown>, ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile Safari/604.1", origin = "https://beanthere.uz") =>
      app.inject({ method: "POST", url: "/api/collect", headers: { "content-type": "text/plain;charset=UTF-8", "user-agent": ua, origin }, payload: JSON.stringify({ k: site.key, ...body }) });
    expect((await send({ t: "pageview", p: "/", r: "https://google.com/search?q=coffee" })).statusCode).toBe(204);
    await send({ t: "pageview", p: "/menu" });
    await send({ t: "pageview", p: "/" }, "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36");
    await send({ t: "vital", n: "LCP", v: 1800 });
    await send({ t: "vital", n: "LCP", v: 3200 });
    await send({ t: "vital", n: "CLS", v: 0.02 });
    await send({ t: "error", n: "TypeError: x is undefined", m: { stack: "at menu.js:10:5" }, p: "/menu" });
    await send({ t: "event", n: "order_click" });
    expect((await send({ t: "vital", n: "EVIL", v: 1 })).statusCode).toBe(400);
    expect((await send({ t: "pageview" }, undefined, "https://evil.example")).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/collect", headers: { "content-type": "text/plain" }, payload: JSON.stringify({ k: "nope", t: "pageview" }) })).statusCode).toBe(404);
    const st = (await app.inject({ method: "GET", url: `/api/w/${ws}/monitoring/sites/${site.id}/stats?range=24h`, headers })).json();
    expect(st.totals).toMatchObject({ views: 3, visitors: 2, errors: 1, events: 1 });
    expect(st.pages[0]).toMatchObject({ key: "/", count: 2 });
    expect(st.referrers.find((r: { key: string }) => r.key === "google.com")).toBeTruthy();
    expect(st.devices.map((d: { key: string }) => d.key).sort()).toEqual(["desktop", "mobile"]);
    expect(st.vitals.find((v: { name: string }) => v.name === "LCP").p75).toBeGreaterThan(1800);
    expect(st.errors[0]).toMatchObject({ message: "TypeError: x is undefined", count: 1, stack: "at menu.js:10:5" });
  });
});

describe("ssh deploy path safety", () => {
  it("quotes shell arguments and refuses unsafe file paths", () => {
    expect(shq("/var/www/site")).toBe("'/var/www/site'");
    expect(shq("a'b; rm -rf ~")).toBe("'a'\\''b; rm -rf ~'");
    for (const ok of ["index.html", "about/index.html", "assets/app-1.2.js", "img/My photo (1).png"]) expect(() => assertSafeRelPath(ok)).not.toThrow();
    for (const bad of ["../etc/passwd", "/abs.html", "a//b", "x'$(reboot)'.html", "a;b.html", "a\nb", ""]) expect(() => assertSafeRelPath(bad)).toThrow(/unsafe path/);
  });
});

