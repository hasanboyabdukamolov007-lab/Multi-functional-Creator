import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { decryptSecret, encryptSecret, loadKeyRing, rewrap } from "./lib/vaultCrypto.js";

describe("vault crypto", () => {
  const ring = loadKeyRing({ env: "test", dataDir: "/nonexistent" });

  it("round-trips and binds ciphertext to secret id + version", () => {
    const enc = encryptSecret(ring, "s1", 1, "top secret ✓");
    expect(enc.ciphertext).not.toContain("top secret");
    expect(decryptSecret(ring, "s1", 1, enc)).toBe("top secret ✓");
    expect(() => decryptSecret(ring, "s2", 1, enc)).toThrow();
    expect(() => decryptSecret(ring, "s1", 2, enc)).toThrow();
  });

  it("detects tampering", () => {
    const enc = encryptSecret(ring, "s1", 1, "value");
    const buf = Buffer.from(enc.ciphertext, "base64url");
    buf[buf.length - 1] ^= 1;
    expect(() => decryptSecret(ring, "s1", 1, { ...enc, ciphertext: buf.toString("base64url") })).toThrow();
  });

  it("supports master key rotation via re-wrapping", () => {
    const oldKey = crypto.randomBytes(32).toString("base64");
    const newKey = crypto.randomBytes(32).toString("base64");
    const oldRing = loadKeyRing({ env: "test", dataDir: "/x", masterKey: oldKey });
    const enc = encryptSecret(oldRing, "s1", 3, "rotate me");
    const newRing = loadKeyRing({ env: "test", dataDir: "/x", masterKey: newKey, oldKeys: oldKey });
    const re = rewrap(newRing, "s1", 3, enc);
    expect(re.keyId).toBe(newRing.activeId);
    expect(decryptSecret(loadKeyRing({ env: "test", dataDir: "/x", masterKey: newKey }), "s1", 3, re)).toBe("rotate me");
  });

  it("refuses to start production without a master key", () => {
    expect(() => loadKeyRing({ env: "production", dataDir: "/x" })).toThrow(/VAULT_MASTER_KEY/);
  });
});

describe("API", () => {
  let app: FastifyInstance;
  const H = { "x-mfc-csrf": "1" };

  async function login(email: string) {
    const r = await app.inject({ method: "POST", url: "/api/auth/magic-link", headers: H, payload: { email } });
    expect(r.statusCode).toBe(200);
    const link = r.json().devLink as string;
    const token = new URL(link).searchParams.get("token")!;
    const v = await app.inject({ method: "POST", url: "/api/auth/verify", headers: H, payload: { token } });
    expect(v.statusCode).toBe(200);
    const cookie = v.cookies.find((c) => c.name === "mfc_session")!;
    expect(cookie.httpOnly).toBe(true);
    const headers = { ...H, cookie: `mfc_session=${cookie.value}` };
    const me = (await app.inject({ method: "GET", url: "/api/auth/me", headers })).json();
    return { headers, token, me, ws: me.workspaces[0].id as string };
  }

  beforeAll(async () => {
    app = await buildApp(loadConfig({ env: "test", inMemoryDb: true, webDist: undefined, anthropicApiKey: undefined, publicUrl: "http://localhost:5173" }));
  });
  afterAll(async () => {
    await app.close();
  });

  it("rejects state-changing requests without the CSRF header", async () => {
    const r = await app.inject({ method: "POST", url: "/api/auth/magic-link", payload: { email: "a@example.com" } });
    expect(r.statusCode).toBe(403);
  });

  it("signs in with a single-use magic link and creates an owner workspace", async () => {
    const { me, token, headers } = await login("owner@example.com");
    expect(me.user.email).toBe("owner@example.com");
    expect(me.workspaces).toHaveLength(1);
    expect(me.workspaces[0].role).toBe("owner");
    const again = await app.inject({ method: "POST", url: "/api/auth/verify", headers: H, payload: { token } });
    expect(again.statusCode).toBe(400);
    await app.inject({ method: "POST", url: "/api/auth/logout", headers });
    expect((await app.inject({ method: "GET", url: "/api/auth/me", headers })).json().user).toBeNull();
    expect((await app.inject({ method: "GET", url: "/api/w/00000000-0000-0000-0000-000000000000/secrets", headers })).statusCode).toBe(401);
  });

  it("stores secrets encrypted, masks them, audits reveals, rotates and rolls back", async () => {
    const { headers, ws } = await login("vault@example.com");
    const base = `/api/w/${ws}/secrets`;
    const c = await app.inject({ method: "POST", url: base, headers, payload: { name: "STRIPE_KEY", value: "sk_live_first", environment: "production", rotationDays: 90 } });
    expect(c.statusCode).toBe(200);
    const id = c.json().secret.id;

    const list = await app.inject({ method: "GET", url: base, headers });
    expect(list.body).not.toContain("sk_live_first");
    expect(list.json().secrets[0]).toMatchObject({ name: "STRIPE_KEY", environment: "production", current_version: 1, status: "ok" });

    const raw = await app.deps.db.query<{ ciphertext: string }>(`SELECT ciphertext FROM secret_versions WHERE secret_id = $1`, [id]);
    expect(raw[0].ciphertext).not.toContain("sk_live_first");

    const dup = await app.inject({ method: "POST", url: base, headers, payload: { name: "STRIPE_KEY", value: "x", environment: "production" } });
    expect(dup.statusCode).toBe(400);

    await app.inject({ method: "PUT", url: `${base}/${id}/value`, headers, payload: { value: "sk_live_second" } });
    expect((await app.inject({ method: "POST", url: `${base}/${id}/reveal`, headers, payload: {} })).json()).toEqual({ value: "sk_live_second", version: 2 });
    const rb = await app.inject({ method: "POST", url: `${base}/${id}/rollback`, headers, payload: { version: 1 } });
    expect(rb.json().secret.current_version).toBe(3);
    expect((await app.inject({ method: "POST", url: `${base}/${id}/reveal`, headers, payload: {} })).json().value).toBe("sk_live_first");

    const audit = (await app.inject({ method: "GET", url: `/api/w/${ws}/audit`, headers })).json().events.map((e: { action: string }) => e.action);
    expect(audit.filter((a: string) => a === "secret.reveal")).toHaveLength(2);
    expect(audit).toContain("secret.rollback");
    expect(JSON.stringify(audit)).not.toContain("sk_live");
  });

  it("imports and exports .env files with project overrides", async () => {
    const { headers, ws } = await login("env@example.com");
    const base = `/api/w/${ws}/secrets`;
    const p = (await app.inject({ method: "POST", url: `/api/w/${ws}/projects`, headers, payload: { name: "Shop", kind: "site" } })).json().project;
    const imp = await app.inject({ method: "POST", url: `${base}/import`, headers, payload: { environment: "staging", content: "API_URL=https://api.test\nDB_PASSWORD=\"p@ss word\"\nEMPTY=\n" } });
    expect(imp.json()).toMatchObject({ created: ["API_URL", "DB_PASSWORD"], skipped: ["EMPTY"] });
    await app.inject({ method: "POST", url: `${base}/import`, headers, payload: { environment: "staging", projectId: p.id, content: "API_URL=https://shop.api.test" } });

    const resolved = (await app.inject({ method: "GET", url: `${base}/resolve?environment=staging&projectId=${p.id}`, headers })).json().variables;
    expect(resolved).toEqual(expect.arrayContaining([expect.objectContaining({ name: "API_URL", source: "project" }), expect.objectContaining({ name: "DB_PASSWORD", source: "workspace" })]));
    expect(JSON.stringify(resolved)).not.toContain("p@ss");

    const exp = (await app.inject({ method: "POST", url: `${base}/export`, headers, payload: { environment: "staging", projectId: p.id } })).json();
    expect(exp.content).toContain("API_URL=https://shop.api.test");
    expect(exp.content).toContain('DB_PASSWORD="p@ss word"');
  });

  it("enforces roles and isolates workspaces", async () => {
    const owner = await login("boss@example.com");
    const other = await login("stranger@example.com");
    const base = `/api/w/${owner.ws}/secrets`;
    const id = (await app.inject({ method: "POST", url: base, headers: owner.headers, payload: { name: "TOKEN", value: "abc", environment: "development" } })).json().secret.id;

    expect((await app.inject({ method: "GET", url: base, headers: other.headers })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/api/w/${other.ws}/secrets/${id}/reveal`, headers: other.headers, payload: {} })).statusCode).toBe(404);

    await app.inject({ method: "POST", url: `/api/w/${owner.ws}/members`, headers: owner.headers, payload: { email: "viewer@example.com", role: "viewer" } });
    const viewer = await login("viewer@example.com");
    const wsIds = viewer.me.workspaces.map((w: { id: string }) => w.id);
    expect(wsIds).toContain(owner.ws);
    expect((await app.inject({ method: "GET", url: base, headers: viewer.headers })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `${base}/${id}/reveal`, headers: viewer.headers, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `${base}/export`, headers: viewer.headers, payload: { environment: "development" } })).statusCode).toBe(403);
  });

  it("scans text for leaked credentials", async () => {
    const { headers, ws } = await login("scan@example.com");
    const r = await app.inject({ method: "POST", url: `/api/w/${ws}/secrets/scan`, headers, payload: { text: `const k = "AKIAABCDEFGHIJKLMNOP";` } });
    expect(r.json().findings[0].ruleId).toBe("aws-access-key");
  });

  it("keeps every AI model off by default; Claude is an opt-in add-on that also needs a key", async () => {
    const { headers, ws } = await login("ai@example.com");
    const s1 = (await app.inject({ method: "GET", url: `/api/w/${ws}/ai/status`, headers })).json();
    expect(s1.claudeEnabled).toBe(false);
    expect(s1.builtIn.configured).toBe(false);
    expect(s1.providers).toEqual([]);
    const off = await app.inject({ method: "POST", url: `/api/w/${ws}/ai/turn`, headers, payload: { messages: [{ role: "user", content: "hi" }] } });
    expect(off.statusCode).toBe(412);
    expect(off.json().code).toBe("claude_disabled");
    await app.inject({ method: "PUT", url: `/api/w/${ws}/ai/settings`, headers, payload: { claudeEnabled: true } });
    const turn = await app.inject({ method: "POST", url: `/api/w/${ws}/ai/turn`, headers, payload: { messages: [{ role: "user", content: "hi" }] } });
    expect(turn.statusCode).toBe(412);
    expect(turn.json().code).toBe("ai_unconfigured");
    await app.inject({ method: "POST", url: `/api/w/${ws}/secrets`, headers, payload: { name: "ANTHROPIC_API_KEY", value: "sk-ant-test", environment: "production" } });
    const s2 = (await app.inject({ method: "GET", url: `/api/w/${ws}/ai/status`, headers })).json();
    expect(s2.builtIn).toMatchObject({ configured: true, keySource: "vault", keySecretName: "ANTHROPIC_API_KEY" });
  });
});
