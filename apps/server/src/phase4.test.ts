import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

// 1×1 transparent PNG
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

describe("assets and brand kit", () => {
  let app: FastifyInstance;
  let headers: Record<string, string> = {};
  let ws = "";
  beforeAll(async () => {
    app = await buildApp(loadConfig({ env: "test", inMemoryDb: true, webDist: undefined }));
    const H = { "x-mfc-csrf": "1", "content-type": "application/json" };
    const r = await app.inject({ method: "POST", url: "/api/auth/magic-link", headers: H, payload: { email: "media@example.com" } });
    const token = new URL(r.json().devLink).searchParams.get("token")!;
    const v = await app.inject({ method: "POST", url: "/api/auth/verify", headers: H, payload: { token } });
    headers = { ...H, cookie: `mfc_session=${v.cookies.find((c) => c.name === "mfc_session")!.value}` };
    ws = (await app.inject({ method: "GET", url: "/api/auth/me", headers })).json().workspaces[0].id;
  });
  afterAll(() => app.close());

  it("uploads, deduplicates, lists and serves assets publicly with immutable caching", async () => {
    const up = (await app.inject({ method: "POST", url: `/api/w/${ws}/assets`, headers, payload: { name: "dot.png", mime: "image/png", data: PNG, width: 1, height: 1, tags: ["logo"] } })).json();
    expect(up.url).toBe(`/api/a/${up.id}/dot.png`);
    const again = (await app.inject({ method: "POST", url: `/api/w/${ws}/assets`, headers, payload: { name: "copy.png", mime: "image/png", data: PNG } })).json();
    expect(again).toMatchObject({ id: up.id, deduplicated: true });
    const list = (await app.inject({ method: "GET", url: `/api/w/${ws}/assets?q=logo`, headers })).json();
    expect(list.assets).toHaveLength(1);
    expect(list.used).toBe(Buffer.from(PNG, "base64").length);
    const pub = await app.inject({ method: "GET", url: up.url });
    expect(pub.statusCode).toBe(200);
    expect(pub.headers["content-type"]).toBe("image/png");
    expect(pub.headers["cross-origin-resource-policy"]).toBe("cross-origin");
    expect(pub.headers["cache-control"]).toContain("immutable");
    const cached = await app.inject({ method: "GET", url: up.url, headers: { "if-none-match": pub.headers.etag as string } });
    expect(cached.statusCode).toBe(304);
    // Dangerous types and scripted SVGs are refused.
    expect((await app.inject({ method: "POST", url: `/api/w/${ws}/assets`, headers, payload: { name: "x.html", mime: "text/html", data: "PGgxPg==" } })).statusCode).toBe(400);
    const evil = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>').toString("base64");
    expect((await app.inject({ method: "POST", url: `/api/w/${ws}/assets`, headers, payload: { name: "x.svg", mime: "image/svg+xml", data: evil } })).statusCode).toBe(400);
    const okSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>').toString("base64");
    const svg = (await app.inject({ method: "POST", url: `/api/w/${ws}/assets`, headers, payload: { name: "box.svg", mime: "image/svg+xml", data: okSvg } })).json();
    expect((await app.inject({ method: "GET", url: svg.url })).headers["content-security-policy"]).toContain("sandbox");
    expect((await app.inject({ method: "PATCH", url: `/api/w/${ws}/assets/${up.id}`, headers, payload: { folder: "brand" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "DELETE", url: `/api/w/${ws}/assets/${svg.id}`, headers: { cookie: headers.cookie, "x-mfc-csrf": "1" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: svg.url })).statusCode).toBe(404);
  });

  it("stores the workspace brand kit", async () => {
    expect((await app.inject({ method: "GET", url: `/api/w/${ws}/brand`, headers })).json().brand).toBeNull();
    const brand = { name: "Bean There", colors: [{ name: "primary", value: "#c2410c" }], fonts: { heading: "Fraunces", body: "Inter" } };
    expect((await app.inject({ method: "PUT", url: `/api/w/${ws}/brand`, headers, payload: { brand } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/w/${ws}/brand`, headers })).json().brand).toEqual(brand);
  });
});
