import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Envelope encryption for the Secrets Vault.
 *
 *  value --AES-256-GCM(DEK, aad)--> ciphertext
 *  DEK   --AES-256-GCM(master key, aad)--> wrapped_dek
 *
 * A fresh 256-bit data key (DEK) is generated for every secret version. The master key never
 * touches the database; it comes from VAULT_MASTER_KEY (or, in development only, a key file in
 * the data directory). The additional authenticated data binds each ciphertext to its secret id
 * and version, so rows cannot be swapped between secrets without detection.
 *
 * Stored format (both fields): base64url(iv[12] | tag[16] | ciphertext).
 */

const ALG = "aes-256-gcm";

export interface MasterKeyRing {
  activeId: string;
  keys: Map<string, Buffer>;
}

export function keyIdOf(key: Buffer): string {
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 12);
}

function decodeKey(b64: string, label: string): Buffer {
  const key = Buffer.from(b64.trim(), "base64");
  if (key.length !== 32) throw new Error(`${label} must be 32 bytes, base64-encoded (got ${key.length} bytes). Generate one with: openssl rand -base64 32`);
  return key;
}

export function loadKeyRing(opts: { masterKey?: string; oldKeys?: string; dataDir: string; env: string; log?: (m: string) => void }): MasterKeyRing {
  let active: Buffer;
  if (opts.masterKey) {
    active = decodeKey(opts.masterKey, "VAULT_MASTER_KEY");
  } else if (opts.env === "production") {
    throw new Error("VAULT_MASTER_KEY is required in production. Generate one with: openssl rand -base64 32");
  } else if (opts.env === "test") {
    active = crypto.randomBytes(32);
  } else {
    const file = path.join(opts.dataDir, "vault-master.key");
    if (fs.existsSync(file)) {
      active = decodeKey(fs.readFileSync(file, "utf8"), file);
    } else {
      fs.mkdirSync(opts.dataDir, { recursive: true });
      active = crypto.randomBytes(32);
      fs.writeFileSync(file, active.toString("base64"), { mode: 0o600 });
      opts.log?.(`Generated a development vault master key at ${file}. Set VAULT_MASTER_KEY in production.`);
    }
  }
  const keys = new Map<string, Buffer>([[keyIdOf(active), active]]);
  for (const part of (opts.oldKeys ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const k = decodeKey(part, "VAULT_OLD_KEYS entry");
    keys.set(keyIdOf(k), k);
  }
  return { activeId: keyIdOf(active), keys };
}

function seal(key: Buffer, plaintext: Buffer, aad: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv(ALG, key, iv);
  c.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64url");
}

function open(key: Buffer, sealed: string, aad: string): Buffer {
  const buf = Buffer.from(sealed, "base64url");
  if (buf.length < 28) throw new Error("Corrupt vault payload");
  const d = crypto.createDecipheriv(ALG, key, buf.subarray(0, 12));
  d.setAAD(Buffer.from(aad, "utf8"));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]);
}

export interface EncryptedValue {
  keyId: string;
  wrappedDek: string;
  ciphertext: string;
}

const aadFor = (secretId: string, version: number) => `mfc-vault:v1:${secretId}:${version}`;

export function encryptSecret(ring: MasterKeyRing, secretId: string, version: number, value: string): EncryptedValue {
  const dek = crypto.randomBytes(32);
  const aad = aadFor(secretId, version);
  try {
    return {
      keyId: ring.activeId,
      wrappedDek: seal(ring.keys.get(ring.activeId)!, dek, aad),
      ciphertext: seal(dek, Buffer.from(value, "utf8"), aad),
    };
  } finally {
    dek.fill(0);
  }
}

export function decryptSecret(ring: MasterKeyRing, secretId: string, version: number, enc: EncryptedValue): string {
  const master = ring.keys.get(enc.keyId);
  if (!master) throw new Error(`Vault master key ${enc.keyId} is not loaded (add it to VAULT_OLD_KEYS)`);
  const aad = aadFor(secretId, version);
  const dek = open(master, enc.wrappedDek, aad);
  try {
    return open(dek, enc.ciphertext, aad).toString("utf8");
  } finally {
    dek.fill(0);
  }
}

/** Re-wrap a DEK under the active master key (master key rotation) without touching the value. */
export function rewrap(ring: MasterKeyRing, secretId: string, version: number, enc: EncryptedValue): EncryptedValue {
  if (enc.keyId === ring.activeId) return enc;
  const old = ring.keys.get(enc.keyId);
  if (!old) throw new Error(`Vault master key ${enc.keyId} is not loaded`);
  const aad = aadFor(secretId, version);
  const dek = open(old, enc.wrappedDek, aad);
  try {
    return { keyId: ring.activeId, wrappedDek: seal(ring.keys.get(ring.activeId)!, dek, aad), ciphertext: enc.ciphertext };
  } finally {
    dek.fill(0);
  }
}

export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
