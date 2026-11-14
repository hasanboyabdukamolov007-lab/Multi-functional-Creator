import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { signStripePayload, stripeForm, verifyStripeSignature } from "./lib/billing.js";
import { decryptPayload, encryptPayload, generateVapidKeys, vapidAuthorization } from "./lib/push.js";

const H = { "x-mfc-csrf": "1", "content-type": "application/json" };

describe("sign-in codes", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp(loadConfig({ env: "test", inMemoryDb: true, webDist: undefined }));
  });
  afterAll(() => app.close());

  it("signs in with the 6-digit code instead of the link", async () => {
    const r = (await app.inject({ method: "POST", url: "/api/auth/magic-link", headers: H, payload: { email: "code@example.com" } })).json();
    expect(r.devCode).toMatch(/^\d{6}$/);
    const v = await app.inject({ method: "POST", url: "/api/auth/verify-code", headers: H, payload: { email: "Code@Example.com", code: r.devCode } });
    expect(v.statusCode).toBe(200);
    expect(v.cookies.find((c) => c.name === "mfc_session")).toBeTruthy();
    // single use: neither the code nor the link works again
    expect((await app.inject({ method: "POST", url: "/api/auth/verify-code", headers: H, payload: { email: "code@example.com", code: r.devCode } })).statusCode).toBe(400);
    const token = new URL(r.devLink).searchParams.get("token")!;
    expect((await app.inject({ method: "POST", url: "/api/auth/verify", headers: H, payload: { token } })).statusCode).toBe(400);
  });

  it("burns the code after five wrong guesses", async () => {
    const r = (await app.inject({ method: "POST", url: "/api/auth/magic-link", headers: H, payload: { email: "guess@example.com" } })).json();
    const wrong = r.devCode === "000000" ? "111111" : "000000";
    for (let i = 0; i < 4; i++) {
      const g = await app.inject({ method: "POST", url: "/api/auth/verify-code", headers: H, payload: { email: "guess@example.com", code: wrong } });
      expect(g.json(), g.body).toMatchObject({ code: "invalid_code" });
    }
    expect((await app.inject({ method: "POST", url: "/api/auth/verify-code", headers: H, payload: { email: "guess@example.com", code: wrong } })).json().code).toBe("code_expired");
    // even the right code no longer works
    expect((await app.inject({ method: "POST", url: "/api/auth/verify-code", headers: H, payload: { email: "guess@example.com", code: r.devCode } })).json().code).toBe("code_expired");
    // and a code for one address is useless for another
    const other = (await app.inject({ method: "POST", url: "/api/auth/magic-link", headers: H, payload: { email: "a@example.com" } })).json();
    await app.inject({ method: "POST", url: "/api/auth/magic-link", headers: H, payload: { email: "b@example.com" } });
    expect((await app.inject({ method: "POST", url: "/api/auth/verify-code", headers: H, payload: { email: "b@example.com", code: other.devCode } })).statusCode).toBe(400);
  });

  it("app-info tells clients what the server supports", async () => {
    const info = (await app.inject({ method: "GET", url: "/api/app-info" })).json();
    expect(info).toMatchObject({ billing: false, signInCode: true });
  });
});

describe("web push encryption", () => {
  it("encrypts a payload the browser can decrypt (RFC 8291)", () => {
    const ua = crypto.createECDH("prime256v1");
    ua.generateKeys();
    const auth = crypto.randomBytes(16);
    const sub = { endpoint: "https://push.example.com/abc", keys: { p256dh: ua.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } };
    const msg = JSON.stringify({ title: "Hi", body: "Привет, dunyo ✓" });
    const enc = encryptPayload(sub, Buffer.from(msg));
    expect(enc.readUInt32BE(16)).toBe(4096);
    expect(enc[20]).toBe(65);
    expect(decryptPayload(enc, ua, auth).toString()).toBe(msg);
  });

  it("signs a VAPID JWT for the push service origin", () => {
    const keys = generateVapidKeys();
    const h = vapidAuthorization("https://fcm.googleapis.com/fcm/send/xyz", { ...keys, subject: "mailto:ops@example.com" });
    const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(h)!;
    expect(k).toBe(keys.publicKey);
    const [head, claims, sig] = jwt.split(".");
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toMatchObject({ aud: "https://fcm.googleapis.com", sub: "mailto:ops@example.com" });
    const pub = Buffer.from(keys.publicKey, "base64url");
    const key = crypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33).toString("base64url") }, format: "jwk" });
    expect(crypto.verify("sha256", Buffer.from(`${head}.${claims}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url"))).toBe(true);
  });
});

describe("billing (mock Stripe) and push devices", () => {
  let app: FastifyInstance;
  let mock: http.Server;
  let base = "";
  const calls: Array<{ method: string; path: string; body: string }> = [];
  const subs = new Map<string, Record<string, unknown>>();
  const pushes: unknown[] = [];
  const SECRET = "whsec_test";
  let owner: Record<string, string>;
  let ws = "";

  const signIn = async (email: string) => {
    const r = await app.inject({ method: "POST", url: "/api/auth/magic-link", headers: H, payload: { email } });
    const v = await app.inject({ method: "POST", url: "/api/auth/verify-code", headers: H, payload: { email, code: r.json().devCode } });
    return { ...H, cookie: `mfc_session=${v.cookies.find((c) => c.name === "mfc_session")!.value}` };
  };
  const req = (headers: Record<string, string>, method: string, url: string, payload?: unknown) =>
    app.inject({ method: method as "GET", url, headers: payload === undefined && method !== "GET" ? { cookie: headers.cookie, "x-mfc-csrf": "1" } : headers, payload: payload as object });
  const webhook = (event: unknown, secret = SECRET) => {
    const body = JSON.stringify(event);
    return app.inject({ method: "POST", url: "/api/billing/webhook", headers: { "content-type": "application/json", "stripe-signature": signStripePayload(body, secret) }, payload: body });
  };

  beforeAll(async () => {
    mock = http.createServer((rq, rs) => {
      let body = "";
      rq.on("data", (c) => (body += c));
      rq.on("end", () => {
        const path = rq.url ?? "";
        calls.push({ method: rq.method ?? "", path, body });
        rs.setHeader("content-type", "application/json");
        if (path === "/--/api/v2/push/send") {
          const msgs = JSON.parse(body) as Array<{ to: string }>;
          pushes.push(...msgs);
          return rs.end(JSON.stringify({ data: msgs.map((m) => (m.to.includes("Dead") ? { status: "error", details: { error: "DeviceNotRegistered" } } : { status: "ok", id: "x" })) }));
        }
        if (rq.headers.authorization !== "Bearer sk_test_123") return rs.writeHead(401).end(JSON.stringify({ error: { message: "bad key" } }));
        if (path === "/v1/checkout/sessions") return rs.end(JSON.stringify({ id: "cs_1", url: "https://checkout.stripe.test/cs_1" }));
        if (path === "/v1/billing_portal/sessions") return rs.end(JSON.stringify({ url: "https://billing.stripe.test/p_1" }));
        if (path.startsWith("/v1/prices/")) return rs.end(JSON.stringify({ unit_amount: path.endsWith("pro") ? 1900 : 4900, currency: "usd", recurring: { interval: "month" } }));
        const m = /^\/v1\/subscriptions\/(.+)$/.exec(path);
        if (m && subs.has(m[1])) return rs.end(JSON.stringify(subs.get(m[1])));
        rs.writeHead(404).end(JSON.stringify({ error: { message: "not found" } }));
      });
    });
    await new Promise<void>((r) => mock.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;
    const cfg = loadConfig({ env: "test", inMemoryDb: true, webDist: undefined, allowPrivateNetwork: true });
    cfg.providers = { ...cfg.providers, stripe: base, expoPush: base };
    cfg.billing = { stripeKey: "sk_test_123", webhookSecret: SECRET, prices: { pro: "price_pro", team: "price_team" }, trialDays: 0 };
    app = await buildApp(cfg);
    owner = await signIn("owner@example.com");
    ws = (await req(owner, "GET", "/api/auth/me")).json().workspaces[0].id;
  });
  afterAll(async () => {
    await app.close();
    mock.close();
  });

  it("new workspaces start on Free and hit its limits", async () => {
    const b = (await req(owner, "GET", `/api/w/${ws}/billing`)).json();
    expect(b).toMatchObject({ enabled: true, plan: "free", limits: { projects: 3 } });
    expect(b.plans.find((p: { id: string }) => p.id === "pro").price).toEqual({ amount: 1900, currency: "usd", interval: "month" });
    for (let i = 0; i < 3; i++) expect((await req(owner, "POST", `/api/w/${ws}/projects`, { name: `P${i}`, kind: "site" })).statusCode).toBe(200);
    const over = await req(owner, "POST", `/api/w/${ws}/projects`, { name: "P4", kind: "site" });
    expect(over.statusCode).toBe(402);
    expect(over.json()).toMatchObject({ code: "plan_limit" });
    expect((await req(owner, "POST", `/api/w/${ws}/members`, { email: "m1@example.com", role: "editor" })).statusCode).toBe(200);
    expect((await req(owner, "POST", `/api/w/${ws}/members`, { email: "m2@example.com", role: "editor" })).statusCode).toBe(402);
  });

  it("only owners can start checkout; checkout carries the workspace", async () => {
    const editor = await signIn("m1@example.com");
    expect((await req(editor, "POST", `/api/w/${ws}/billing/checkout`, { plan: "pro" })).statusCode).toBe(403);
    const r = (await req(owner, "POST", `/api/w/${ws}/billing/checkout`, { plan: "pro" })).json();
    expect(r).toEqual({ url: "https://checkout.stripe.test/cs_1", portal: false });
    const form = new URLSearchParams(calls.find((c) => c.path === "/v1/checkout/sessions")!.body);
    expect(form.get("line_items[0][price]")).toBe("price_pro");
    expect(form.get("client_reference_id")).toBe(ws);
    expect(form.get("subscription_data[metadata][workspace_id]")).toBe(ws);
    expect(form.get("customer_email")).toBe("owner@example.com");
  });

  it("verifies webhook signatures and upgrades on checkout", async () => {
    expect((await webhook({ id: "evt_bad", type: "checkout.session.completed", data: { object: {} } }, "whsec_wrong")).statusCode).toBe(400);
    subs.set("sub_1", { id: "sub_1", status: "active", customer: "cus_1", cancel_at_period_end: false, metadata: { workspace_id: ws }, items: { data: [{ price: { id: "price_pro" }, current_period_end: 1893456000 }] } });
    const ev = { id: "evt_1", type: "checkout.session.completed", data: { object: { client_reference_id: ws, customer: "cus_1", subscription: "sub_1" } } };
    expect((await webhook(ev)).json()).toMatchObject({ handled: true, plan: "pro" });
    expect((await webhook(ev)).json()).toMatchObject({ duplicate: true });
    const b = (await req(owner, "GET", `/api/w/${ws}/billing`)).json();
    expect(b).toMatchObject({ plan: "pro", status: "active", hasSubscription: true, limits: { projects: 50 } });
    expect(new Date(b.renewsAt).getUTCFullYear()).toBe(2030);
    expect((await req(owner, "POST", `/api/w/${ws}/projects`, { name: "P4", kind: "site" })).statusCode).toBe(200);
    // subscribed → checkout opens the portal instead
    expect((await req(owner, "POST", `/api/w/${ws}/billing/checkout`, { plan: "team" })).json()).toMatchObject({ portal: true });
    // owner was notified in-app
    expect((await req(owner, "GET", "/api/notifications")).json().items[0]).toMatchObject({ kind: "billing", title: "You're on the Pro plan" });
  });

  it("follows plan changes, payment failures and cancellation", async () => {
    subs.set("sub_1", { ...subs.get("sub_1")!, items: { data: [{ price: { id: "price_team" } }] } });
    expect((await webhook({ id: "evt_2", type: "customer.subscription.updated", data: { object: { id: "sub_1", customer: "cus_1", status: "active", metadata: { workspace_id: ws } } } })).json().plan).toBe("team");
    expect((await webhook({ id: "evt_3", type: "invoice.payment_failed", data: { object: { customer: "cus_1" } } })).json().handled).toBe(true);
    expect((await req(owner, "GET", "/api/notifications")).json().items[0].title).toBe("Payment failed");
    const del = await webhook({ id: "evt_4", type: "customer.subscription.deleted", data: { object: { id: "sub_1", customer: "cus_1", status: "canceled", metadata: {} } } });
    expect(del.json()).toMatchObject({ plan: "free" });
    const b = (await req(owner, "GET", `/api/w/${ws}/billing`)).json();
    expect(b).toMatchObject({ plan: "free", status: "canceled", hasSubscription: false, hasCustomer: true });
    // existing projects stay; adding more is blocked
    expect((await req(owner, "GET", `/api/w/${ws}/projects`)).json().projects.length).toBe(4);
    expect((await req(owner, "POST", `/api/w/${ws}/projects`, { name: "P5", kind: "site" })).statusCode).toBe(402);
    expect((await req(owner, "POST", `/api/w/${ws}/billing/portal`, {})).json().url).toBe("https://billing.stripe.test/p_1");
  });

  it("registers push devices and prunes dead Expo tokens", async () => {
    expect((await req(owner, "GET", "/api/push/vapid")).json().publicKey).toMatch(/^[\w-]{87}$/);
    expect((await req(owner, "POST", "/api/push/devices", { kind: "expo", token: "not-a-token" })).statusCode).toBe(400);
    expect((await req(owner, "POST", "/api/push/devices", { kind: "expo", token: "ExponentPushToken[Alive123]", label: "Pixel 9" })).statusCode).toBe(200);
    expect((await req(owner, "POST", "/api/push/devices", { kind: "expo", token: "ExponentPushToken[Dead456]" })).statusCode).toBe(200);
    expect((await req(owner, "GET", "/api/push/devices")).json().devices).toHaveLength(2);
    const t = (await req(owner, "POST", "/api/push/test", {})).json();
    expect(t).toEqual({ ok: true, sent: 1 });
    expect(pushes).toContainEqual(expect.objectContaining({ to: "ExponentPushToken[Alive123]", title: "Test notification" }));
    expect((await req(owner, "GET", "/api/push/devices")).json().devices.map((d: { label: string }) => d.label)).toEqual(["Pixel 9"]);
  });

  it("encodes nested Stripe params", () => {
    expect(stripeForm({ a: 1, b: { c: "x" }, d: [{ e: 2 }] }).toString()).toBe("a=1&b%5Bc%5D=x&d%5B0%5D%5Be%5D=2");
    const body = '{"x":1}';
    expect(verifyStripeSignature(body, signStripePayload(body, "s", 1000), "s", 300, 1_000_000)).toBe(true);
    expect(verifyStripeSignature(body, signStripePayload(body, "s", 1000), "s", 300, 2_000_000)).toBe(false); // replay window
  });
});

describe("GitHub repository editor (mock GitHub)", () => {
  let app: FastifyInstance;
  let mock: http.Server;
  const commits: Array<{ path: string; body: Record<string, string>; auth?: string }> = [];
  beforeAll(async () => {
    mock = http.createServer((rq, rs) => {
      let body = "";
      rq.on("data", (c) => (body += c));
      rq.on("end", () => {
        const u = rq.url ?? "";
        rs.setHeader("content-type", "application/json");
        const priv = u.startsWith("/repos/me/secret");
        if (priv && rq.headers.authorization !== "Bearer ghp_test") return rs.writeHead(404).end('{"message":"Not Found"}');
        if (/^\/repos\/me\/(site|secret)$/.test(u)) return rs.end(JSON.stringify({ default_branch: "main", private: priv, permissions: { push: !!rq.headers.authorization } }));
        if (u === "/repos/me/site/git/ref/heads/main" || u === "/repos/me/site/git/ref/heads/feature/new-look") return rs.end(JSON.stringify({ object: { sha: "c0ffee" } }));
        if (u.startsWith("/repos/me/site/git/trees/c0ffee")) return rs.end(JSON.stringify({ truncated: false, tree: [{ path: "index.html", type: "blob", size: 120 }, { path: "img/logo.png", type: "blob", size: 9000 }, { path: "css", type: "tree" }] }));
        if (u.startsWith("/repos/me/site/contents/index.html") && rq.method === "GET") return rs.end(JSON.stringify({ type: "file", size: 20, sha: "abc", content: Buffer.from("<h1>Salom</h1>").toString("base64") }));
        if (u.startsWith("/repos/me/site/contents/") && rq.method === "PUT") {
          commits.push({ path: u, body: JSON.parse(body), auth: rq.headers.authorization });
          return rs.end(JSON.stringify({ content: { sha: "def" }, commit: { sha: "c1", html_url: "https://github.com/me/site/commit/c1" } }));
        }
        rs.writeHead(404).end('{"message":"Not Found"}');
      });
    });
    await new Promise<void>((r) => mock.listen(0, "127.0.0.1", r));
    const cfg = loadConfig({ env: "test", inMemoryDb: true, webDist: undefined, allowPrivateNetwork: true });
    cfg.providers = { ...cfg.providers, github: `http://127.0.0.1:${(mock.address() as AddressInfo).port}` };
    app = await buildApp(cfg);
  });
  afterAll(async () => {
    await app.close();
    mock.close();
  });

  it("lists, reads and commits files; private repos and commits need a vault token", async () => {
    const r = await app.inject({ method: "POST", url: "/api/auth/magic-link", headers: H, payload: { email: "gh@example.com" } });
    const v = await app.inject({ method: "POST", url: "/api/auth/verify-code", headers: H, payload: { email: "gh@example.com", code: r.json().devCode } });
    const h = { ...H, cookie: `mfc_session=${v.cookies.find((c) => c.name === "mfc_session")!.value}` };
    const ws = (await app.inject({ method: "GET", url: "/api/auth/me", headers: h })).json().workspaces[0].id;
    const post = (path: string, payload: unknown) => app.inject({ method: "POST", url: `/api/w/${ws}/github${path}`, headers: h, payload: payload as object });

    const tree = (await post("/tree", { repo: "https://github.com/me/site.git" })).json();
    expect(tree).toMatchObject({ repo: "me/site", ref: "main", canPush: false });
    expect(tree.files).toEqual([{ path: "index.html", size: 120, editable: true }, { path: "img/logo.png", size: 9000, editable: false }]);
    expect((await post("/file", { repo: "me/site", ref: "main", path: "index.html" })).json()).toMatchObject({ content: "<h1>Salom</h1>", sha: "abc" });
    expect((await post("/tree", { repo: "me/site", ref: "feature/new-look" })).json()).toMatchObject({ ref: "feature/new-look", files: expect.any(Array) });
    expect((await post("/tree", { repo: "me/site", ref: "nope/branch" })).json().error).toMatch(/not found/);
    expect((await post("/tree", { repo: "me/secret" })).statusCode).toBe(404);
    expect((await post("/commit", { repo: "me/site", path: "index.html", content: "x", message: "m" })).statusCode).toBe(400);
    expect((await post("/tree", { repo: "not a repo" })).statusCode).toBe(400);

    const sec = (await app.inject({ method: "POST", url: `/api/w/${ws}/secrets`, headers: h, payload: { name: "GITHUB_TOKEN", value: "ghp_test", environment: "development" } })).json().secret;
    // With the token the private repo opens; its branch isn't mocked, so the answer names the missing branch.
    expect((await post("/tree", { repo: "me/secret", secretId: sec.id })).json().error).toMatch(/Branch or tag "main" not found/);
    const c = (await post("/commit", { repo: "me/site", ref: "main", path: "index.html", content: "<h1>Salom dunyo</h1>", sha: "abc", message: "Update title", secretId: sec.id })).json();
    expect(c).toMatchObject({ sha: "def", commit: "c1" });
    expect(commits[0].auth).toBe("Bearer ghp_test");
    expect(commits[0].body).toMatchObject({ message: "Update title", sha: "abc", branch: "main" });
    expect(Buffer.from(commits[0].body.content, "base64").toString()).toBe("<h1>Salom dunyo</h1>");
    expect((await app.inject({ method: "GET", url: `/api/w/${ws}/audit`, headers: h })).json().events.map((e: { action: string }) => e.action)).toContain("github.commit");
  });
});
