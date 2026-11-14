/**
 * Push notifications to signed-in devices:
 *  - Web Push (installed PWA / browsers): VAPID (RFC 8292) + aes128gcm payload encryption (RFC 8291),
 *    implemented with node:crypto only.
 *  - Expo push (the Android / iOS app): Expo's push service relays to FCM / APNs.
 * Dead subscriptions (404/410, DeviceNotRegistered) are removed automatically.
 */
import crypto from "node:crypto";
import type { Db } from "../db.js";
import type { Config } from "../config.js";
import { decryptSecret, encryptSecret, type EncryptedValue, type MasterKeyRing } from "./vaultCrypto.js";
import { guardedFetch } from "./netGuard.js";

export interface PushDeps {
  db: Db;
  ring: MasterKeyRing;
  config: Config;
}
export interface PushMessage {
  title: string;
  body?: string;
  /** In-app path to open on tap, e.g. /builder?project=… */
  link?: string;
  tag?: string;
}
export interface WebPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
export interface Vapid {
  publicKey: string; // base64url, 65-byte uncompressed P-256 point
  privateKey: string; // base64url, 32-byte scalar
  subject: string;
}

const b64u = (b: Buffer | Uint8Array) => Buffer.from(b).toString("base64url");
const fromB64u = (s: string) => Buffer.from(s, "base64url");

export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
}

let cached: Vapid | null = null;
/** VAPID keys from the environment, or generated once and stored (encrypted with the vault key). */
export async function getVapid(deps: PushDeps): Promise<Vapid> {
  const subject = deps.config.vapid.subject;
  if (deps.config.vapid.publicKey && deps.config.vapid.privateKey) return { publicKey: deps.config.vapid.publicKey, privateKey: deps.config.vapid.privateKey, subject };
  if (cached) return cached;
  const row = await deps.db.one<{ value: { publicKey: string; enc: EncryptedValue } }>(`SELECT value FROM server_keys WHERE name = 'vapid'`);
  if (row) {
    cached = { publicKey: row.value.publicKey, privateKey: decryptSecret(deps.ring, "server:vapid", 1, row.value.enc), subject };
    return cached;
  }
  const keys = generateVapidKeys();
  const value = { publicKey: keys.publicKey, enc: encryptSecret(deps.ring, "server:vapid", 1, keys.privateKey) };
  // Two instances racing: the first insert wins and everyone re-reads it.
  await deps.db.query(`INSERT INTO server_keys (name, value) VALUES ('vapid', $1) ON CONFLICT (name) DO NOTHING`, [JSON.stringify(value)]);
  return getVapid(deps);
}

/** ES256 JWT for the push service origin (RFC 8292). */
export function vapidAuthorization(endpoint: string, vapid: Vapid, now = Date.now()): string {
  const pub = fromB64u(vapid.publicKey);
  const key = crypto.createPrivateKey({
    key: { kty: "EC", crv: "P-256", d: vapid.privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) },
    format: "jwk",
  });
  const header = b64u(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: vapid.subject })));
  const sig = crypto.sign("sha256", Buffer.from(`${header}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${vapid.publicKey}`;
}

/** aes128gcm-encrypt a payload for a subscription (RFC 8291 / RFC 8188, single record). */
export function encryptPayload(sub: WebPushSubscription, payload: Uint8Array, opts: { salt?: Buffer; serverKeys?: crypto.ECDH } = {}): Buffer {
  const uaPublic = fromB64u(sub.keys.p256dh);
  const authSecret = fromB64u(sub.keys.auth);
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw new Error("Invalid push subscription keys");
  const server = opts.serverKeys ?? crypto.createECDH("prime256v1");
  if (!opts.serverKeys) server.generateKeys();
  const asPublic = server.getPublicKey();
  const shared = server.computeSecret(uaPublic);
  const salt = opts.salt ?? crypto.randomBytes(16);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync("sha256", shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  // 0x02 marks the last (and only) record.
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

/** Inverse of encryptPayload, given the user agent's private key (used by tests). */
export function decryptPayload(data: Buffer, uaKeys: crypto.ECDH, authSecret: Buffer): Buffer {
  const salt = data.subarray(0, 16);
  const idLen = data[20];
  const asPublic = data.subarray(21, 21 + idLen);
  const ct = data.subarray(21 + idLen);
  const shared = uaKeys.computeSecret(asPublic);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaKeys.getPublicKey(), asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync("sha256", shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const d = crypto.createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  return plain.subarray(0, plain.lastIndexOf(2));
}

/** Send one Web Push message. Returns false when the subscription is gone and should be deleted. */
export async function sendWebPush(deps: PushDeps, sub: WebPushSubscription, m: PushMessage): Promise<boolean> {
  const vapid = await getVapid(deps);
  const body = encryptPayload(sub, Buffer.from(JSON.stringify(m)));
  const r = await guardedFetch(
    sub.endpoint,
    {
      method: "POST",
      headers: { authorization: vapidAuthorization(sub.endpoint, vapid), "content-encoding": "aes128gcm", "content-type": "application/octet-stream", ttl: "86400", urgency: "normal" },
      body,
    },
    { allowPrivate: deps.config.allowPrivateNetwork, timeoutMs: 15_000, maxBytes: 16 * 1024 },
  );
  if (r.status === 404 || r.status === 410) return false;
  if (r.status >= 400) throw new Error(`push service answered ${r.status}`);
  return true;
}

const EXPO_TOKEN = /^Expo(nent)?PushToken\[[\w-]+\]$/;
export const isExpoToken = (t: string) => EXPO_TOKEN.test(t);

/** Send Expo push messages. Returns the tokens that are no longer registered. */
export async function sendExpo(deps: PushDeps, tokens: string[], m: PushMessage): Promise<string[]> {
  if (!tokens.length) return [];
  const res = await fetch(`${deps.config.providers.expoPush}/--/api/v2/push/send`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(tokens.map((to) => ({ to, title: m.title, body: m.body ?? "", data: { link: m.link ?? "/" }, sound: "default", channelId: "default" }))),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Expo push answered ${res.status}`);
  const json = (await res.json().catch(() => ({}))) as { data?: Array<{ status: string; details?: { error?: string } }> };
  return (json.data ?? []).flatMap((d, i) => (d.status === "error" && d.details?.error === "DeviceNotRegistered" ? [tokens[i]] : []));
}

interface DeviceRow {
  id: string;
  kind: "webpush" | "expo";
  token: string;
  subscription: WebPushSubscription | null;
}

/** Push to every device of a user. Never throws; returns how many devices accepted the message. */
export async function pushToUser(deps: PushDeps, userId: string, m: PushMessage): Promise<number> {
  try {
    const devices = await deps.db.query<DeviceRow>(`SELECT id, kind, token, subscription FROM push_devices WHERE user_id = $1`, [userId]);
    if (!devices.length) return 0;
    const dead: string[] = [];
    let ok = 0;
    await Promise.all(
      devices
        .filter((d) => d.kind === "webpush" && d.subscription)
        .map(async (d) => {
          try {
            if (await sendWebPush(deps, d.subscription!, m)) ok++;
            else dead.push(d.id);
          } catch (e) {
            console.warn(`[push] web push failed: ${(e as Error).message}`);
          }
        }),
    );
    const expo = devices.filter((d) => d.kind === "expo");
    if (expo.length) {
      try {
        const gone = await sendExpo(deps, expo.map((d) => d.token), m);
        ok += expo.length - gone.length;
        dead.push(...expo.filter((d) => gone.includes(d.token)).map((d) => d.id));
      } catch (e) {
        console.warn(`[push] expo push failed: ${(e as Error).message}`);
      }
    }
    if (dead.length) await deps.db.query(`DELETE FROM push_devices WHERE id = ANY($1::uuid[])`, [dead]);
    if (ok) await deps.db.query(`UPDATE push_devices SET last_used_at = now() WHERE user_id = $1`, [userId]);
    return ok;
  } catch (e) {
    console.warn(`[push] ${(e as Error).message}`);
    return 0;
  }
}

/** Create an in-app notification and push it to the user's devices. */
export async function notifyUser(
  deps: PushDeps,
  n: { userId: string; workspaceId: string | null; kind: string; title: string; body?: string | null; link?: string | null },
): Promise<void> {
  await deps.db.query(`INSERT INTO user_notifications (id, user_id, workspace_id, kind, title, body, link) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
    crypto.randomUUID(),
    n.userId,
    n.workspaceId,
    n.kind,
    n.title,
    n.body ?? null,
    n.link ?? null,
  ]);
  void pushToUser(deps, n.userId, { title: n.title, body: n.body ?? undefined, link: n.link ?? undefined, tag: n.kind });
}
