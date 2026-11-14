import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const H = { "x-mfc-csrf": "1", "content-type": "application/json" };

describe("collaboration & ecosystem", () => {
  let app: FastifyInstance;
  let ada: Record<string, string>;
  let bob: Record<string, string>;
  let ws = "";
  const signIn = async (email: string) => {
    const r = await app.inject({ method: "POST", url: "/api/auth/magic-link", headers: H, payload: { email } });
    const token = new URL(r.json().devLink).searchParams.get("token")!;
    const v = await app.inject({ method: "POST", url: "/api/auth/verify", headers: H, payload: { token } });
    return { ...H, cookie: `mfc_session=${v.cookies.find((c) => c.name === "mfc_session")!.value}` };
  };
  const req = (headers: Record<string, string>, method: string, url: string, payload?: unknown) =>
    app.inject({ method: method as "GET", url, headers: payload === undefined && method !== "GET" ? { cookie: headers.cookie, "x-mfc-csrf": "1" } : headers, payload: payload as object });

  beforeAll(async () => {
    app = await buildApp(loadConfig({ env: "test", inMemoryDb: true, webDist: undefined }));
    ada = await signIn("ada@example.com");
    ws = (await app.inject({ method: "GET", url: "/api/auth/me", headers: ada })).json().workspaces[0].id;
    expect((await req(ada, "POST", `/api/w/${ws}/members`, { email: "bob@example.com", role: "editor" })).statusCode).toBe(200);
    bob = await signIn("bob@example.com");
  });
  afterAll(() => app.close());

  it("comments with @mentions notify teammates; replies notify the author", async () => {
    const p = (await req(ada, "POST", `/api/w/${ws}/projects`, { name: "Landing", kind: "site", data: { v: 1 } })).json().project;
    const c = (await req(ada, "POST", `/api/w/${ws}/projects/${p.id}/comments`, { body: "Can @bob check the hero copy?", nodeId: "n_hero" })).json();
    expect(c.mentioned).toEqual(["bob@example.com"]);
    const bn = (await req(bob, "GET", "/api/notifications")).json();
    expect(bn.unread).toBe(1);
    expect(bn.items[0]).toMatchObject({ kind: "mention", title: expect.stringContaining("mentioned you in Landing") });
    expect(bn.items[0].link).toContain(`/builder?project=${p.id}`);
    await req(bob, "POST", `/api/w/${ws}/projects/${p.id}/comments`, { body: "Done ✅", parentId: c.id });
    expect((await req(ada, "GET", "/api/notifications")).json().items[0].kind).toBe("reply");
    expect((await req(bob, "POST", "/api/notifications/read", {})).statusCode).toBe(200);
    expect((await req(bob, "GET", "/api/notifications")).json().unread).toBe(0);
    const list = (await req(ada, "GET", `/api/w/${ws}/projects/${p.id}/comments`)).json().comments;
    expect(list).toHaveLength(2);
    expect((await req(bob, "PATCH", `/api/w/${ws}/comments/${c.id}`, { body: "hijack" })).statusCode).toBe(403);
    expect((await req(bob, "PATCH", `/api/w/${ws}/comments/${c.id}`, { resolved: true })).statusCode).toBe(200);
    // Presence
    expect((await req(bob, "POST", `/api/w/${ws}/projects/${p.id}/presence`, { selection: "n_hero" })).statusCode).toBe(200);
  });

  it("keeps version history, restores, branches and merges", async () => {
    const p = (await req(ada, "POST", `/api/w/${ws}/projects`, { name: "Doc", kind: "site", data: { step: 1 } })).json().project;
    let v = (await req(ada, "PUT", `/api/w/${ws}/projects/${p.id}`, { data: { step: 2 }, baseVersion: p.version })).json().project.version;
    expect((await req(ada, "GET", `/api/w/${ws}/projects/${p.id}/versions`)).json().versions).toHaveLength(1); // auto snapshot of step 1
    v = (await req(ada, "PUT", `/api/w/${ws}/projects/${p.id}`, { data: { step: 3 }, baseVersion: v })).json().project.version;
    expect((await req(ada, "POST", `/api/w/${ws}/projects/${p.id}/versions`, { label: "Approved" })).statusCode).toBe(200);
    const versions = (await req(ada, "GET", `/api/w/${ws}/projects/${p.id}/versions`)).json().versions;
    const first = versions.find((x: { auto: boolean }) => x.auto);
    expect((await req(ada, "POST", `/api/w/${ws}/projects/${p.id}/versions/${first.id}/restore`, {})).json().ok).toBe(true);
    expect((await req(ada, "GET", `/api/w/${ws}/projects/${p.id}`)).json().project.data).toEqual({ step: 1 });

    const br = (await req(bob, "POST", `/api/w/${ws}/projects/${p.id}/branch`, { name: "new-hero" })).json().project;
    expect(br.name).toBe("Doc · new-hero");
    await req(bob, "PUT", `/api/w/${ws}/projects/${br.id}`, { data: { step: 99 } });
    expect((await req(ada, "GET", `/api/w/${ws}/projects/${p.id}/branches`)).json().branches[0]).toMatchObject({ id: br.id, branch_name: "new-hero" });
    expect((await req(bob, "POST", `/api/w/${ws}/projects/${br.id}/merge`, {})).json().ok).toBe(true);
    expect((await req(ada, "GET", `/api/w/${ws}/projects/${p.id}`)).json().project.data).toEqual({ step: 99 });
    expect((await req(ada, "POST", `/api/w/${ws}/projects/${p.id}/merge`, {})).statusCode).toBe(400);
  });

  it("publishes, browses and installs marketplace items; plugins are validated and admin-only", async () => {
    const t = (await req(bob, "POST", `/api/w/${ws}/market`, { kind: "template", name: "Coffee landing", description: "Warm café page", tags: ["coffee"], data: { projectKind: "site", doc: { pages: [] } } })).json();
    expect((await req(bob, "POST", `/api/w/${ws}/market`, { kind: "template", name: "x", visibility: "public", data: {} })).statusCode).toBe(403);
    const items = (await req(ada, "GET", `/api/w/${ws}/market?q=coffee`)).json().items;
    expect(items[0]).toMatchObject({ name: "Coffee landing", mine: true });
    const inst = (await req(ada, "POST", `/api/w/${ws}/market/${t.id}/install`, {})).json();
    expect(inst.project).toMatchObject({ name: "Coffee landing", kind: "site" });
    const plugin = { manifest: { id: "lorem", name: "Lorem", version: "1.0.0", permissions: ["builder.write"], functions: [{ id: "insert", title: "Insert lorem" }] }, code: "mfc.register('insert', () => 1)" };
    expect((await req(bob, "POST", `/api/w/${ws}/plugins`, plugin)).statusCode).toBe(403); // editors can't install plugins
    expect((await req(ada, "POST", `/api/w/${ws}/plugins`, { ...plugin, manifest: { ...plugin.manifest, permissions: ["root"] } })).statusCode).toBe(400);
    const pid = (await req(ada, "POST", `/api/w/${ws}/plugins`, plugin)).json().id;
    expect((await req(ada, "GET", `/api/w/${ws}/plugins`)).json().plugins[0]).toMatchObject({ id: pid, slug: "lorem", enabled: true });
    const pub = (await req(ada, "POST", `/api/w/${ws}/market`, { kind: "plugin", name: "Lorem", visibility: "public", data: plugin })).json();
    expect((await req(ada, "POST", `/api/w/${ws}/market/${pub.id}/install`, {})).json()).toMatchObject({ kind: "plugin", pluginId: pid });
  });
});
