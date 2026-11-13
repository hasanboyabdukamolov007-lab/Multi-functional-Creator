import type { Db } from "../db.js";
import type { MasterKeyRing } from "./vaultCrypto.js";
import { readValue } from "./secretsStore.js";

/**
 * Resolve {{ secrets.NAME }} for workspace-level secrets in one environment.
 * Values are cached per resolver (one request or run) and every secret used is recorded for auditing.
 */
export function secretResolver(db: Pick<Db, "query" | "one">, ring: MasterKeyRing, workspaceId: string, environment: string) {
  const cache = new Map<string, string>();
  const used = new Set<string>();
  const resolve = async (name: string) => {
    if (cache.has(name)) return cache.get(name)!;
    const row = await db.one<{ id: string }>(`SELECT id FROM secrets WHERE workspace_id = $1 AND project_id IS NULL AND environment = $2 AND name = $3`, [workspaceId, environment, name]);
    if (!row) throw new Error(`Secret ${name} is not in the vault for ${environment}`);
    const value = await readValue(db, ring, row.id);
    cache.set(name, value);
    used.add(name);
    return value;
  };
  /** Replace every resolved secret value in text with ••• (for logs and responses echoed back). */
  const redact = (text: string) => {
    let out = text;
    for (const v of cache.values()) if (v.length >= 4) out = out.split(v).join("•••");
    return out;
  };
  return { resolve, used, redact };
}
