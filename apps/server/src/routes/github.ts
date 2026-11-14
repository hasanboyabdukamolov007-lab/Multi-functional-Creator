import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { parse, requirePerm, HttpError, badRequest } from "../lib/http.js";
import { guardedFetch } from "../lib/netGuard.js";
import { readValue } from "../lib/secretsStore.js";
import { audit } from "../lib/audit.js";

/** Text files the panel can open; everything else (images, fonts, builds) is listed but not editable. */
const EDITABLE = /\.(html?|css|scss|js|mjs|cjs|jsx|ts|tsx|json|md|txt|vue|svelte|xml|svg|yml|yaml|toml|env\.example)$/i;
const MAX_FILE = 1024 * 1024;

const Repo = z.object({
  repo: z.string().trim().transform((s) => s.replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, "").replace(/\/+$/, "")).pipe(z.string().regex(/^[\w.-]+\/[\w.-]+$/, "Use owner/name")),
  ref: z.string().trim().max(200).optional(),
  secretId: z.string().uuid().nullable().optional(),
});

/** /api/w/:workspaceId/github — open your own repositories: list files, read them, commit changes back. */
export const githubRoutes: FastifyPluginAsync = async (app) => {
  const { db, ring, config } = app.deps;

  const gh = async (wsId: string, secretId: string | null | undefined, path: string, init: { method?: string; body?: unknown } = {}) => {
    let token = "";
    if (secretId) {
      const owned = await db.one(`SELECT 1 FROM secrets WHERE id = $1 AND workspace_id = $2`, [secretId, wsId]);
      if (!owned) throw badRequest("Pick a token from this workspace's vault");
      token = await readValue(db, ring, secretId);
    }
    const r = await guardedFetch(
      `${config.providers.github}${path}`,
      {
        method: init.method ?? "GET",
        headers: { accept: "application/vnd.github+json", "user-agent": "multi-functional-creator", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.body ? { "content-type": "application/json" } : {}) },
        body: init.body ? JSON.stringify(init.body) : undefined,
      },
      { allowPrivate: config.allowPrivateNetwork, timeoutMs: 20_000, maxBytes: 8 * 1024 * 1024 },
    );
    const json = JSON.parse(r.body.toString("utf8") || "{}") as Record<string, unknown>;
    if (r.status === 404) throw new HttpError(404, token ? "Repository or file not found (check the name and that the token can read it)" : "Not found — for a private repository pick a GitHub token from the vault", "not_found");
    if (r.status === 401 || r.status === 403) throw new HttpError(400, `GitHub refused: ${String(json.message ?? r.status)}`, "github_auth");
    if (r.status >= 400) throw new HttpError(502, `GitHub: ${String(json.message ?? r.status)}`, "github_error");
    return json;
  };

  app.post("/tree", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const a = requirePerm(req, "projects.read");
    const b = parse(Repo, req.body);
    const meta = await gh(a.workspaceId, b.secretId, `/repos/${b.repo}`);
    const ref = b.ref || String(meta.default_branch ?? "main");
    const tree = await gh(a.workspaceId, b.secretId, `/repos/${b.repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
    const files = ((tree.tree as Array<{ path: string; type: string; size?: number }>) ?? [])
      .filter((x) => x.type === "blob")
      .map((x) => ({ path: x.path, size: x.size ?? 0, editable: EDITABLE.test(x.path) && (x.size ?? 0) <= MAX_FILE }));
    return { repo: b.repo, ref, private: !!meta.private, canPush: !!(meta.permissions as { push?: boolean } | undefined)?.push, truncated: !!tree.truncated, files };
  });

  app.post("/file", async (req) => {
    const a = requirePerm(req, "projects.read");
    const b = parse(Repo.extend({ path: z.string().min(1).max(500) }), req.body);
    const f = await gh(a.workspaceId, b.secretId, `/repos/${b.repo}/contents/${b.path.split("/").map(encodeURIComponent).join("/")}${b.ref ? `?ref=${encodeURIComponent(b.ref)}` : ""}`);
    if (f.type !== "file" || typeof f.content !== "string") throw badRequest("That path is not a file");
    if (Number(f.size) > MAX_FILE) throw badRequest("Files over 1 MB can't be opened here");
    return { path: b.path, sha: f.sha, content: Buffer.from(f.content, "base64").toString("utf8") };
  });

  app.post("/commit", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const a = requirePerm(req, "projects.write");
    const b = parse(Repo.extend({ path: z.string().min(1).max(500), content: z.string().max(MAX_FILE), sha: z.string().max(80).optional(), message: z.string().trim().min(1).max(300), branch: z.string().trim().max(200).optional() }), req.body);
    if (!b.secretId) throw badRequest("Committing needs a GitHub token (Contents: write) from the vault");
    const r = await gh(a.workspaceId, b.secretId, `/repos/${b.repo}/contents/${b.path.split("/").map(encodeURIComponent).join("/")}`, {
      method: "PUT",
      body: { message: b.message, content: Buffer.from(b.content, "utf8").toString("base64"), ...(b.sha ? { sha: b.sha } : {}), ...(b.branch || b.ref ? { branch: b.branch || b.ref } : {}) },
    });
    const commit = r.commit as { sha?: string; html_url?: string } | undefined;
    await audit(db, req, "github.commit", { meta: { repo: b.repo, path: b.path } });
    return { sha: (r.content as { sha?: string } | undefined)?.sha, commit: commit?.sha, url: commit?.html_url };
  });
};
