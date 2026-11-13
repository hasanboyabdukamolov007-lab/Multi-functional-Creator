import crypto from "node:crypto";
import type { Db } from "../db.js";
import { decryptSecret, encryptSecret, rewrap, type MasterKeyRing } from "./vaultCrypto.js";

export interface SecretMeta {
  id: string;
  project_id: string | null;
  environment: string;
  name: string;
  description: string;
  current_version: number;
  expires_at: string | null;
  rotation_days: number | null;
  last_rotated_at: string;
  created_at: string;
  updated_at: string;
  status: "ok" | "expiring" | "expired" | "rotation_due";
}

const META_COLS = `s.id, s.project_id, s.environment, s.name, s.description, s.current_version, s.expires_at, s.rotation_days, s.last_rotated_at, s.created_at, s.updated_at,
  CASE
    WHEN s.expires_at IS NOT NULL AND s.expires_at <= now() THEN 'expired'
    WHEN s.expires_at IS NOT NULL AND s.expires_at <= now() + interval '14 days' THEN 'expiring'
    WHEN s.rotation_days IS NOT NULL AND s.last_rotated_at + (s.rotation_days || ' days')::interval <= now() THEN 'rotation_due'
    ELSE 'ok' END AS status`;

type Q = Pick<Db, "query" | "one">;

export async function listSecrets(db: Q, workspaceId: string, f: { projectId?: string | null; environment?: string; onlyAlerts?: boolean } = {}) {
  const rows = await db.query<SecretMeta>(
    `SELECT ${META_COLS} FROM secrets s
     WHERE s.workspace_id = $1
       AND ($2::text IS NULL OR ($2 = 'workspace' AND s.project_id IS NULL) OR s.project_id::text = $2)
       AND ($3::text IS NULL OR s.environment = $3)
     ORDER BY s.name, s.environment`,
    [workspaceId, f.projectId === undefined ? null : f.projectId ?? "workspace", f.environment ?? null],
  );
  return f.onlyAlerts ? rows.filter((r) => r.status !== "ok") : rows;
}

export async function getSecretMeta(db: Q, workspaceId: string, id: string) {
  return db.one<SecretMeta>(`SELECT ${META_COLS} FROM secrets s WHERE s.id = $1 AND s.workspace_id = $2`, [id, workspaceId]);
}

export async function createSecret(
  db: Q,
  ring: MasterKeyRing,
  input: { workspaceId: string; projectId: string | null; environment: string; name: string; value: string; description?: string; expiresAt?: string | null; rotationDays?: number | null; userId: string },
) {
  const id = crypto.randomUUID();
  const enc = encryptSecret(ring, id, 1, input.value);
  await db.query(
    `INSERT INTO secrets (id, workspace_id, project_id, environment, name, description, expires_at, rotation_days, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, input.workspaceId, input.projectId, input.environment, input.name, input.description ?? "", input.expiresAt ?? null, input.rotationDays ?? null, input.userId],
  );
  await db.query(`INSERT INTO secret_versions (secret_id, version, key_id, wrapped_dek, ciphertext, created_by) VALUES ($1,1,$2,$3,$4,$5)`, [
    id,
    enc.keyId,
    enc.wrappedDek,
    enc.ciphertext,
    input.userId,
  ]);
  return id;
}

export async function addVersion(db: Q, ring: MasterKeyRing, secretId: string, value: string, userId: string): Promise<number> {
  const row = await db.one<{ v: number }>(`UPDATE secrets SET current_version = current_version + 1, last_rotated_at = now(), updated_at = now() WHERE id = $1 RETURNING current_version AS v`, [secretId]);
  if (!row) throw new Error("Secret not found");
  const enc = encryptSecret(ring, secretId, row.v, value);
  await db.query(`INSERT INTO secret_versions (secret_id, version, key_id, wrapped_dek, ciphertext, created_by) VALUES ($1,$2,$3,$4,$5,$6)`, [
    secretId,
    row.v,
    enc.keyId,
    enc.wrappedDek,
    enc.ciphertext,
    userId,
  ]);
  return row.v;
}

export async function readValue(db: Q, ring: MasterKeyRing, secretId: string, version?: number): Promise<string> {
  const row = await db.one<{ version: number; key_id: string; wrapped_dek: string; ciphertext: string }>(
    `SELECT v.version, v.key_id, v.wrapped_dek, v.ciphertext FROM secret_versions v JOIN secrets s ON s.id = v.secret_id
     WHERE v.secret_id = $1 AND v.version = coalesce($2::int, s.current_version)`,
    [secretId, version ?? null],
  );
  if (!row) throw new Error("Secret version not found");
  return decryptSecret(ring, secretId, row.version, { keyId: row.key_id, wrappedDek: row.wrapped_dek, ciphertext: row.ciphertext });
}

/**
 * Resolve the variables injected into a build/deploy: workspace-wide secrets for the environment,
 * overridden by project-scoped secrets of the same name.
 */
export async function resolveForDeploy(db: Q, ring: MasterKeyRing, workspaceId: string, projectId: string | null, environment: string, withValues: boolean) {
  const rows = await db.query<{ id: string; name: string; project_id: string | null }>(
    `SELECT id, name, project_id FROM secrets WHERE workspace_id = $1 AND environment = $2 AND (project_id IS NULL OR project_id::text = $3::text)
     ORDER BY (project_id IS NULL) DESC, name`,
    [workspaceId, environment, projectId],
  );
  const out = new Map<string, { id: string; source: "workspace" | "project"; value?: string }>();
  for (const r of rows) out.set(r.name, { id: r.id, source: r.project_id ? "project" : "workspace" });
  if (withValues) for (const v of out.values()) v.value = await readValue(db, ring, v.id);
  return [...out.entries()].map(([name, v]) => ({ name, ...v }));
}

/** Re-wrap every data key that is still under an old master key. Returns the number re-wrapped. */
export async function rewrapAll(db: Q, ring: MasterKeyRing): Promise<number> {
  const rows = await db.query<{ secret_id: string; version: number; key_id: string; wrapped_dek: string; ciphertext: string }>(
    `SELECT secret_id, version, key_id, wrapped_dek, ciphertext FROM secret_versions WHERE key_id <> $1`,
    [ring.activeId],
  );
  for (const r of rows) {
    const n = rewrap(ring, r.secret_id, r.version, { keyId: r.key_id, wrappedDek: r.wrapped_dek, ciphertext: r.ciphertext });
    await db.query(`UPDATE secret_versions SET key_id = $3, wrapped_dek = $4 WHERE secret_id = $1 AND version = $2`, [r.secret_id, r.version, n.keyId, n.wrappedDek]);
  }
  return rows.length;
}
