import type { Environment } from "@mfc/core";
import { api } from "../../lib/api";
import { ws } from "../../lib/session";

export const TARGET_KINDS = ["vercel", "netlify", "github", "s3", "ssh", "webhook"] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

export interface Target {
  id: string;
  name: string;
  kind: TargetKind;
  config: Record<string, string>;
  secret_id: string | null;
  secret_name: string | null;
  environment: Environment;
}
export interface Deployment {
  id: string;
  target_id: string | null;
  project_id: string | null;
  name: string;
  status: "building" | "ready" | "failed";
  url: string | null;
  files_count: number;
  bytes: number;
  error: string | null;
  started_at: string;
  finished_at: string | null;
  redeploy_of?: string | null;
  can_redeploy?: boolean;
  target_name?: string;
  target_kind?: TargetKind;
  log?: Array<{ at: string; msg: string }>;
}

/** Field definitions per provider: what the form asks for and what the vault secret must contain. */
export const KIND_FIELDS: Record<TargetKind, { fields: Array<{ key: string; label: string; placeholder?: string; type?: "text" | "check"; required?: boolean }>; secret: string; docs: string }> = {
  vercel: { fields: [{ key: "project", label: "Project name", placeholder: "my-site", required: true }, { key: "teamId", label: "Team ID (optional)", placeholder: "team_…" }], secret: "Vercel access token (Account Settings → Tokens)", docs: "Static files upload content-addressed; vault secrets can be set as encrypted environment variables." },
  netlify: { fields: [{ key: "siteId", label: "Site ID (optional — created on first deploy)" }, { key: "siteName", label: "New site name (optional)", placeholder: "my-site" }], secret: "Netlify personal access token", docs: "Deploys a zip of your files; the site is created if you leave Site ID empty." },
  github: { fields: [{ key: "repo", label: "Repository", placeholder: "owner/name", required: true }, { key: "branch", label: "Branch", placeholder: "gh-pages" }, { key: "path", label: "Folder in repo (optional)", placeholder: "docs" }, { key: "pages", label: "Publish with GitHub Pages", type: "check" }, { key: "message", label: "Commit message", placeholder: "Deploy from Multi-functional Creator" }], secret: "GitHub token with Contents (and Pages) write access", docs: "Commits your files with the Git Data API; with Pages on, the site goes live at owner.github.io/repo." },
  s3: { fields: [{ key: "bucket", label: "Bucket", required: true }, { key: "region", label: "Region", placeholder: "us-east-1 / auto" }, { key: "endpoint", label: "Endpoint (R2, Spaces, MinIO — optional)", placeholder: "https://<account>.r2.cloudflarestorage.com" }, { key: "prefix", label: "Folder prefix (optional)" }, { key: "publicUrl", label: "Public URL (optional)", placeholder: "https://cdn.example.com" }], secret: "ACCESS_KEY_ID:SECRET_ACCESS_KEY", docs: "Signed S3 uploads (SigV4) with correct content types and cache headers." },
  ssh: { fields: [{ key: "host", label: "Host", required: true }, { key: "port", label: "Port", placeholder: "22" }, { key: "username", label: "Username", required: true }, { key: "remotePath", label: "Remote path", placeholder: "/var/www/site" }, { key: "domain", label: "Domain (for the nginx config)", placeholder: "example.com" }, { key: "reloadNginx", label: "Test & reload nginx after deploy (needs passwordless sudo)", type: "check" }], secret: "Private key (PEM) or password", docs: "Uploads over SFTP into a new release folder and switches a symlink atomically; the host key is pinned on first use." },
  webhook: { fields: [{ key: "url", label: "Webhook URL", placeholder: "https://ci.example.com/hooks/deploy", required: true }], secret: "Signing secret (HMAC-SHA256)", docs: "POSTs a signed JSON manifest (and a zip bundle up to 3 MB) to your own CI or server." },
};

export const deployApi = {
  targets: () => api.get<{ targets: Target[] }>(ws("/deploy/targets")).then((r) => r.targets),
  createTarget: (b: { name: string; kind: TargetKind; config: Record<string, string>; secretId: string | null; environment: Environment }) => api.post<{ id: string }>(ws("/deploy/targets"), b),
  updateTarget: (id: string, b: { name: string; kind: TargetKind; config: Record<string, string>; secretId: string | null; environment: Environment }) => api.put(ws(`/deploy/targets/${id}`), b),
  removeTarget: (id: string) => api.del(ws(`/deploy/targets/${id}`)),
  test: (id: string) => api.post<{ ok: boolean; message: string }>(ws(`/deploy/targets/${id}/test`)),
  deploy: (id: string, b: { name: string; projectId: string | null; files: Array<{ path: string; data: string }>; injectSecrets: boolean; analyticsSiteId: string | null }) => api.post<{ deployment: Deployment }>(ws(`/deploy/targets/${id}/deploy`), b).then((r) => r.deployment),
  deployments: (projectId?: string) => api.get<{ deployments: Deployment[] }>(ws(`/deploy/deployments${projectId ? `?projectId=${projectId}` : ""}`)).then((r) => r.deployments),
  deployment: (id: string) => api.get<{ deployment: Deployment }>(ws(`/deploy/deployments/${id}`)).then((r) => r.deployment),
  redeploy: (id: string, targetId?: string) => api.post<{ deployment: Deployment }>(ws(`/deploy/deployments/${id}/redeploy`), targetId ? { targetId } : {}).then((r) => r.deployment),
};

export function toBase64(data: string | Uint8Array): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
