/**
 * Deploy providers. Every outbound call goes through the SSRF guard; tokens come from the vault and are
 * redacted from logs by the caller. Each provider returns the public URL when it knows one.
 */
import crypto from "node:crypto";
import { lookup } from "node:dns/promises";
import zlib from "node:zlib";
import { guardedFetch, isPrivateIp, type GuardedResponse } from "./netGuard.js";

export const TARGET_KINDS = ["vercel", "netlify", "github", "s3", "ssh", "webhook"] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

export interface DeployFile {
  path: string;
  data: Buffer;
}
export interface DeployContext {
  token: string;
  config: Record<string, string>;
  environment: string;
  /** Server-side environment variables to set on the provider (only where they stay server-side). */
  env: Array<{ key: string; value: string }>;
  log: (msg: string) => void;
  allowPrivate: boolean;
  api: { vercel: string; netlify: string; github: string };
}
export interface DeployResult {
  url?: string;
  providerId?: string;
  /** Config learned during the deploy (e.g. a created Netlify site id, an SSH host fingerprint). */
  configPatch?: Record<string, string>;
}

const sha1 = (b: Buffer) => crypto.createHash("sha1").update(b).digest("hex");
const sha256 = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MIME: Record<string, string> = { html: "text/html; charset=utf-8", css: "text/css", js: "text/javascript", mjs: "text/javascript", json: "application/json", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", avif: "image/avif", gif: "image/gif", ico: "image/x-icon", txt: "text/plain", xml: "application/xml", webmanifest: "application/manifest+json", woff2: "font/woff2", glb: "model/gltf-binary", mp4: "video/mp4", webm: "video/webm" };
export const mimeOf = (p: string) => MIME[p.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
const cacheOf = (p: string) => (/\.html?$/.test(p) || /(^|\/)sw\.js$/.test(p) ? "no-cache" : /[.-][0-9a-f]{8,}\./.test(p) || p.startsWith("assets/") ? "public, max-age=31536000, immutable" : "public, max-age=3600");

async function call(ctx: DeployContext, url: string, init: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array }, okStatuses: number[] = []): Promise<GuardedResponse & { json: () => unknown }> {
  const r = await guardedFetch(url, init, { allowPrivate: ctx.allowPrivate, timeoutMs: 60_000, maxBytes: 4 * 1024 * 1024 });
  const out = Object.assign(r, { json: () => JSON.parse(r.body.toString("utf8") || "{}") as unknown });
  if (r.status >= 400 && !okStatuses.includes(r.status)) {
    let msg = r.body.toString("utf8").slice(0, 300);
    try {
      const j = JSON.parse(msg) as { error?: { message?: string } | string; message?: string };
      msg = typeof j.error === "string" ? j.error : j.error?.message ?? j.message ?? msg;
    } catch {
      /* keep text */
    }
    throw new Error(`${init.method ?? "GET"} ${new URL(url).pathname} → ${r.status}: ${msg}`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- Vercel
async function vercel(files: DeployFile[], ctx: DeployContext): Promise<DeployResult> {
  const base = ctx.api.vercel;
  const team = ctx.config.teamId ? `?teamId=${encodeURIComponent(ctx.config.teamId)}` : "";
  const auth = { authorization: `Bearer ${ctx.token}` };
  const project = (ctx.config.project || "mfc-site").toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 90);
  ctx.log(`Uploading ${files.length} files to Vercel (content-addressed, unchanged files are skipped)…`);
  for (const f of files) {
    await call(ctx, `${base}/v2/files${team}`, { method: "POST", headers: { ...auth, "content-type": "application/octet-stream", "x-vercel-digest": sha1(f.data), "content-length": String(f.data.length) }, body: f.data });
  }
  if (ctx.env.length) {
    ctx.log(`Setting ${ctx.env.length} environment variable(s) on project ${project} (encrypted, server-side only)…`);
    const target = ctx.environment === "production" ? ["production"] : ctx.environment === "staging" ? ["preview"] : ["development"];
    for (const v of ctx.env) {
      await call(ctx, `${base}/v10/projects/${encodeURIComponent(project)}/env${team ? `${team}&` : "?"}upsert=true`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ key: v.key, value: v.value, type: "encrypted", target }) }, [404]);
    }
  }
  const body = {
    name: project,
    files: files.map((f) => ({ file: f.path, sha: sha1(f.data), size: f.data.length })),
    projectSettings: { framework: null, buildCommand: null, outputDirectory: null, installCommand: null },
    ...(ctx.environment === "production" ? { target: "production" } : {}),
  };
  const created = (await call(ctx, `${base}/v13/deployments${team ? `${team}&` : "?"}skipAutoDetectionConfirmation=1`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(body) })).json() as { id: string; url?: string; readyState?: string };
  ctx.log(`Deployment ${created.id} created, waiting for it to be ready…`);
  let state = created.readyState ?? "QUEUED";
  let url = created.url;
  for (let i = 0; i < 45 && !["READY", "ERROR", "CANCELED"].includes(state); i++) {
    await sleep(2000);
    const d = (await call(ctx, `${base}/v13/deployments/${created.id}${team}`, { headers: auth })).json() as { readyState: string; url?: string };
    state = d.readyState;
    url = d.url ?? url;
  }
  if (state !== "READY") throw new Error(`Vercel deployment ended in state ${state}`);
  return { url: url ? `https://${url.replace(/^https?:\/\//, "")}` : undefined, providerId: created.id };
}

// ---------------------------------------------------------------------------------------------- Netlify
async function netlify(files: DeployFile[], ctx: DeployContext, zip: Buffer): Promise<DeployResult> {
  const base = ctx.api.netlify;
  const auth = { authorization: `Bearer ${ctx.token}` };
  let siteId = ctx.config.siteId;
  const patch: Record<string, string> = {};
  if (!siteId) {
    ctx.log("No site yet — creating one…");
    const site = (await call(ctx, `${base}/api/v1/sites`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(ctx.config.siteName ? { name: ctx.config.siteName } : {}) })).json() as { id: string; site_id?: string };
    siteId = site.site_id ?? site.id;
    patch.siteId = siteId;
  }
  ctx.log(`Uploading ${files.length} files (${Math.round(zip.length / 1024)} KB zip)…`);
  const dep = (await call(ctx, `${base}/api/v1/sites/${encodeURIComponent(siteId)}/deploys`, { method: "POST", headers: { ...auth, "content-type": "application/zip" }, body: zip })).json() as { id: string; state?: string; ssl_url?: string; deploy_ssl_url?: string; url?: string };
  let state = dep.state ?? "uploaded";
  let d = dep;
  for (let i = 0; i < 45 && !["ready", "error"].includes(state); i++) {
    await sleep(2000);
    d = (await call(ctx, `${base}/api/v1/deploys/${dep.id}`, { headers: auth })).json() as typeof dep;
    state = d.state ?? state;
  }
  if (state !== "ready") throw new Error(`Netlify deploy ended in state ${state}`);
  return { url: d.ssl_url ?? d.deploy_ssl_url ?? d.url, providerId: dep.id, configPatch: patch };
}

// ---------------------------------------------------------------------------------------------- GitHub
async function github(files: DeployFile[], ctx: DeployContext): Promise<DeployResult> {
  const base = ctx.api.github;
  const repo = ctx.config.repo;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? "")) throw new Error("Set the repository as owner/name");
  const branch = ctx.config.branch || "gh-pages";
  const prefix = (ctx.config.path ?? "").replace(/^\/+|\/+$/g, "");
  const h = { authorization: `Bearer ${ctx.token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "content-type": "application/json", "user-agent": "multi-functional-creator" };
  let parent: string | null = null;
  let baseTree: string | undefined;
  const ref = await call(ctx, `${base}/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, { headers: h }, [404]);
  if (ref.status === 404) {
    ctx.log(`Branch ${branch} doesn't exist yet — it will be created.`);
  } else {
    parent = (ref.json() as { object: { sha: string } }).object.sha;
    if (prefix) baseTree = ((await call(ctx, `${base}/repos/${repo}/git/commits/${parent}`, { headers: h })).json() as { tree: { sha: string } }).tree.sha;
  }
  ctx.log(`Uploading ${files.length} blobs to ${repo}…`);
  const tree: Array<{ path: string; mode: string; type: string; sha: string }> = [];
  for (const f of files) {
    const blob = (await call(ctx, `${base}/repos/${repo}/git/blobs`, { method: "POST", headers: h, body: JSON.stringify({ content: f.data.toString("base64"), encoding: "base64" }) })).json() as { sha: string };
    tree.push({ path: prefix ? `${prefix}/${f.path}` : f.path, mode: "100644", type: "blob", sha: blob.sha });
  }
  if (branch === "gh-pages" || ctx.config.pages === "1") tree.push({ path: prefix ? `${prefix}/.nojekyll` : ".nojekyll", mode: "100644", type: "blob", sha: ((await call(ctx, `${base}/repos/${repo}/git/blobs`, { method: "POST", headers: h, body: JSON.stringify({ content: "", encoding: "utf-8" }) })).json() as { sha: string }).sha });
  const t = (await call(ctx, `${base}/repos/${repo}/git/trees`, { method: "POST", headers: h, body: JSON.stringify(baseTree ? { base_tree: baseTree, tree } : { tree }) })).json() as { sha: string };
  const commit = (await call(ctx, `${base}/repos/${repo}/git/commits`, { method: "POST", headers: h, body: JSON.stringify({ message: ctx.config.message || "Deploy from Multi-functional Creator", tree: t.sha, parents: parent ? [parent] : [] }) })).json() as { sha: string };
  if (parent) await call(ctx, `${base}/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, { method: "PATCH", headers: h, body: JSON.stringify({ sha: commit.sha, force: !prefix }) });
  else await call(ctx, `${base}/repos/${repo}/git/refs`, { method: "POST", headers: h, body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }) });
  ctx.log(`Committed ${commit.sha.slice(0, 7)} to ${branch}.`);
  let url: string | undefined = `https://github.com/${repo}/tree/${branch}`;
  if (branch === "gh-pages" || ctx.config.pages === "1") {
    const [owner, name] = repo.split("/");
    await call(ctx, `${base}/repos/${repo}/pages`, { method: "POST", headers: h, body: JSON.stringify({ source: { branch, path: "/" } }) }, [409, 422, 403]);
    url = name.toLowerCase() === `${owner.toLowerCase()}.github.io` ? `https://${owner.toLowerCase()}.github.io/` : `https://${owner.toLowerCase()}.github.io/${name}/${prefix ? `${prefix}/` : ""}`;
    ctx.log("GitHub Pages is serving this branch (the first publish can take a minute).");
  }
  return { url, providerId: commit.sha };
}

// ---------------------------------------------------------------------------------------------- S3 (SigV4)
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const hmac = (key: Buffer | string, data: string) => crypto.createHmac("sha256", key).update(data).digest();

/** AWS Signature V4 for a single S3 request (works with AWS, Cloudflare R2, DigitalOcean Spaces, MinIO). */
export function signS3(method: string, url: URL, region: string, accessKey: string, secretKey: string, payload: Buffer, now = new Date()): Record<string, string> {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const payloadHash = sha256(payload);
  const canonicalUri = url.pathname.split("/").map((s) => enc(decodeURIComponent(s))).join("/");
  const canonicalHeaders = `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signed = "host;x-amz-content-sha256;x-amz-date";
  const canonicalQuery = [...url.searchParams.entries()].sort().map(([k, v]) => `${enc(k)}=${enc(v)}`).join("&");
  const request = [method, canonicalUri, canonicalQuery, canonicalHeaders, signed, payloadHash].join("\n");
  const scope = `${date}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(request)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, date), region), "s3"), "aws4_request");
  const signature = crypto.createHmac("sha256", key).update(toSign).digest("hex");
  return { "x-amz-date": amzDate, "x-amz-content-sha256": payloadHash, authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signed}, Signature=${signature}` };
}

function s3Url(cfg: Record<string, string>, key: string): URL {
  const region = cfg.region || "us-east-1";
  if (cfg.endpoint) return new URL(`${cfg.endpoint.replace(/\/+$/, "")}/${cfg.bucket}/${key}`); // path-style for R2 / MinIO / Spaces
  return new URL(`https://${cfg.bucket}.s3.${region}.amazonaws.com/${key}`);
}

async function s3(files: DeployFile[], ctx: DeployContext): Promise<DeployResult> {
  const [accessKey, secretKey] = ctx.token.split(":");
  if (!accessKey || !secretKey) throw new Error("Store the vault secret as ACCESS_KEY_ID:SECRET_ACCESS_KEY");
  if (!ctx.config.bucket) throw new Error("Set the bucket name");
  const region = ctx.config.region || (ctx.config.endpoint ? "auto" : "us-east-1");
  const prefix = (ctx.config.prefix ?? "").replace(/^\/+|\/+$/g, "");
  ctx.log(`Uploading ${files.length} objects to ${ctx.config.bucket}${prefix ? `/${prefix}` : ""}…`);
  for (const f of files) {
    const url = s3Url(ctx.config, prefix ? `${prefix}/${f.path}` : f.path);
    const headers = { ...signS3("PUT", url, region, accessKey, secretKey, f.data), "content-type": mimeOf(f.path), "cache-control": cacheOf(f.path) };
    await call(ctx, url.toString(), { method: "PUT", headers, body: f.data });
  }
  const pub = ctx.config.publicUrl?.replace(/\/+$/, "") ?? (ctx.config.endpoint ? undefined : `http://${ctx.config.bucket}.s3-website-${region}.amazonaws.com`);
  return { url: pub ? `${pub}/${prefix ? `${prefix}/` : ""}` : undefined };
}

// ---------------------------------------------------------------------------------------------- SSH / SFTP
export function nginxConfig(domain: string, root: string): string {
  return `server {
  listen 80;
  server_name ${domain};
  root ${root}/current;
  index index.html;
  location / { try_files $uri $uri/ $uri.html /index.html; }
  location /assets/ { expires 1y; add_header Cache-Control "public, immutable"; }
  gzip on;
  gzip_types text/css application/javascript image/svg+xml application/json;
  add_header X-Content-Type-Options nosniff;
  add_header Referrer-Policy strict-origin-when-cross-origin;
}
# HTTPS: sudo certbot --nginx -d ${domain}`;
}

async function ssh(files: DeployFile[], ctx: DeployContext): Promise<DeployResult> {
  const { Client } = await import("ssh2");
  const host = ctx.config.host;
  const port = Number(ctx.config.port || 22);
  const root = (ctx.config.remotePath || "/var/www/site").replace(/\/+$/, "");
  if (!host || !ctx.config.username) throw new Error("Set the host and username");
  if (!/^\/[\w./-]+$/.test(root)) throw new Error("Remote path must be an absolute path");
  const { address } = await lookup(host);
  if (!ctx.allowPrivate && isPrivateIp(address)) throw new Error(`${host} resolves to a private address`);
  const release = `${root}/releases/${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const patch: Record<string, string> = {};
  const conn = new Client();
  const isKey = ctx.token.includes("-----BEGIN");
  await new Promise<void>((resolve, reject) => {
    conn
      .on("ready", () => resolve())
      .on("error", reject)
      .connect({
        host: address,
        port,
        username: ctx.config.username,
        ...(isKey ? { privateKey: ctx.token } : { password: ctx.token }),
        readyTimeout: 15_000,
        // Trust on first use: remember the host key, refuse if it ever changes.
        hostVerifier: (key: Buffer) => {
          const fp = crypto.createHash("sha256").update(key).digest("base64");
          if (ctx.config.hostFingerprint && ctx.config.hostFingerprint !== fp) return false;
          if (!ctx.config.hostFingerprint) patch.hostFingerprint = fp;
          return true;
        },
      } as never);
  });
  const exec = (cmd: string) =>
    new Promise<string>((resolve, reject) =>
      conn.exec(cmd, (err, stream) => {
        if (err) return reject(err);
        let out = "";
        stream.on("data", (d: Buffer) => (out += d.toString())).stderr.on("data", (d: Buffer) => (out += d.toString()));
        stream.on("close", (code: number) => (code === 0 ? resolve(out) : reject(new Error(`${cmd.split(" ")[0]} exited ${code}: ${out.slice(0, 200)}`))));
      }),
    );
  try {
    if (patch.hostFingerprint) ctx.log(`First connection — host key SHA256:${patch.hostFingerprint} saved (future deploys refuse a different key).`);
    const dirs = [...new Set(files.map((f) => f.path.split("/").slice(0, -1).join("/")).filter(Boolean))];
    await exec(`mkdir -p '${release}' ${dirs.map((d) => `'${release}/${d}'`).join(" ")}`);
    const sftp = await new Promise<import("ssh2").SFTPWrapper>((resolve, reject) => conn.sftp((e, s) => (e ? reject(e) : resolve(s))));
    ctx.log(`Uploading ${files.length} files to ${release}…`);
    for (const f of files) await new Promise<void>((resolve, reject) => sftp.writeFile(`${release}/${f.path}`, f.data, (e) => (e ? reject(e) : resolve())));
    // Atomic switch, then keep the five most recent releases.
    await exec(`ln -sfn '${release}' '${root}/current.tmp' && mv -Tf '${root}/current.tmp' '${root}/current' && ls -1dt '${root}'/releases/* | tail -n +6 | xargs -r rm -rf`);
    ctx.log(`Switched ${root}/current → ${release.split("/").pop()}.`);
    if (ctx.config.domain) {
      ctx.log(`nginx site for ${ctx.config.domain}:\n${nginxConfig(ctx.config.domain, root)}`);
      if (ctx.config.reloadNginx === "1") {
        await exec(`sudo -n nginx -t && sudo -n systemctl reload nginx`);
        ctx.log("nginx config tested and reloaded.");
      }
    }
  } finally {
    conn.end();
  }
  return { url: ctx.config.domain ? `http://${ctx.config.domain}/` : undefined, configPatch: patch };
}

// ---------------------------------------------------------------------------------------------- Webhook
async function webhook(files: DeployFile[], ctx: DeployContext, zip: Buffer): Promise<DeployResult> {
  if (!ctx.config.url) throw new Error("Set the webhook URL");
  const payload = JSON.stringify({
    event: "deploy",
    environment: ctx.environment,
    files: files.map((f) => ({ path: f.path, size: f.data.length, sha256: sha256(f.data) })),
    bundle: zip.length <= 3 * 1024 * 1024 ? zip.toString("base64") : null,
    sentAt: new Date().toISOString(),
  });
  const sig = crypto.createHmac("sha256", ctx.token).update(payload).digest("hex");
  ctx.log(`POST ${new URL(ctx.config.url).host} (${files.length} files, signed with HMAC-SHA256)…`);
  const r = await call(ctx, ctx.config.url, { method: "POST", headers: { "content-type": "application/json", "x-mfc-signature": `sha256=${sig}` }, body: payload });
  let url: string | undefined;
  try {
    url = (r.json() as { url?: string }).url;
  } catch {
    /* plain response */
  }
  return { url };
}

/** Minimal ZIP writer (stored + deflate) for providers that take an archive. */
export function zipFiles(files: DeployFile[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  for (const f of files) {
    const name = Buffer.from(f.path, "utf8");
    const deflated = zlib.deflateRawSync(f.data);
    const useDeflate = deflated.length < f.data.length;
    const data = useDeflate ? deflated : f.data;
    const crc = crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(useDeflate ? 8 : 0, 10);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(f.data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

export async function deploy(kind: TargetKind, files: DeployFile[], ctx: DeployContext): Promise<DeployResult> {
  if (!files.some((f) => f.path === "index.html")) ctx.log("Note: there is no index.html at the root.");
  switch (kind) {
    case "vercel":
      return vercel(files, ctx);
    case "netlify":
      return netlify(files, ctx, zipFiles(files));
    case "github":
      return github(files, ctx);
    case "s3":
      return s3(files, ctx);
    case "ssh":
      return ssh(files, ctx);
    case "webhook":
      return webhook(files, ctx, zipFiles(files));
  }
}

/** Cheap credential check used by the "Test connection" button. */
export async function testTarget(kind: TargetKind, ctx: DeployContext): Promise<string> {
  switch (kind) {
    case "vercel": {
      const u = (await call(ctx, `${ctx.api.vercel}/v2/user`, { headers: { authorization: `Bearer ${ctx.token}` } })).json() as { user?: { username?: string } };
      return `Signed in to Vercel as ${u.user?.username ?? "your account"}`;
    }
    case "netlify": {
      const u = (await call(ctx, `${ctx.api.netlify}/api/v1/user`, { headers: { authorization: `Bearer ${ctx.token}` } })).json() as { email?: string; full_name?: string };
      return `Signed in to Netlify as ${u.full_name ?? u.email ?? "your account"}`;
    }
    case "github": {
      const r = (await call(ctx, `${ctx.api.github}/repos/${ctx.config.repo}`, { headers: { authorization: `Bearer ${ctx.token}`, accept: "application/vnd.github+json", "user-agent": "multi-functional-creator" } })).json() as { full_name: string; permissions?: { push?: boolean } };
      return `${r.full_name}: ${r.permissions?.push === false ? "read-only token — pushes will fail" : "push access OK"}`;
    }
    case "s3": {
      const [a, s] = ctx.token.split(":");
      const url = s3Url(ctx.config, "");
      url.searchParams.set("list-type", "2");
      url.searchParams.set("max-keys", "1");
      await call(ctx, url.toString(), { headers: signS3("GET", url, ctx.config.region || (ctx.config.endpoint ? "auto" : "us-east-1"), a, s, Buffer.alloc(0)) });
      return `Bucket ${ctx.config.bucket} is reachable and the keys can list it`;
    }
    case "ssh":
      return "SSH targets are checked on the first deploy (host key is pinned then)";
    case "webhook": {
      const payload = JSON.stringify({ event: "ping", sentAt: new Date().toISOString() });
      const sig = crypto.createHmac("sha256", ctx.token).update(payload).digest("hex");
      const r = await call(ctx, ctx.config.url, { method: "POST", headers: { "content-type": "application/json", "x-mfc-signature": `sha256=${sig}` }, body: payload });
      return `Webhook answered ${r.status}`;
    }
  }
}
