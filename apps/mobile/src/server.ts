import * as SecureStore from "expo-secure-store";

const SERVER_KEY = "mfc.server";
const LOCK_KEY = "mfc.lock";

const isPrivateHost = (host: string) =>
  host === "localhost" ||
  host.endsWith(".local") ||
  /^127\./.test(host) ||
  /^10\./.test(host) ||
  /^192\.168\./.test(host) ||
  /^172\.(1[6-9]|2\d|3[01])\./.test(host);

/** Normalise what the user typed into an origin. Plain http is only accepted on local networks. */
export function normaliseServer(raw: string): { origin: string } | { error: "invalid" | "insecure" } {
  let s = raw.trim().replace(/\/+$/, "");
  if (!s) return { error: "invalid" };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) && !/^https?:\/\//i.test(s)) return { error: "invalid" };
  if (!/^https?:\/\//i.test(s)) s = (isPrivateHost(s.split(/[:/]/)[0]) ? "http://" : "https://") + s;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return { error: "invalid" };
  }
  if (url.protocol === "http:" && !isPrivateHost(url.hostname)) return { error: "insecure" };
  return { origin: `${url.protocol}//${url.host}` };
}

export async function checkServer(origin: string): Promise<{ ok: true; version: string } | { ok: false; reason: "notPanel" | "unreachable" }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(`${origin}/api/app-info`, { signal: ctl.signal });
    const info = (await res.json().catch(() => null)) as { name?: string; version?: string } | null;
    return info?.name === "Multi-functional Creator" ? { ok: true, version: info.version ?? "?" } : { ok: false, reason: "notPanel" };
  } catch {
    return { ok: false, reason: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

export const getServer = () => SecureStore.getItemAsync(SERVER_KEY);
export const setServer = (origin: string) => SecureStore.setItemAsync(SERVER_KEY, origin);
export const clearServer = () => SecureStore.deleteItemAsync(SERVER_KEY);
export const getLock = async () => (await SecureStore.getItemAsync(LOCK_KEY)) === "1";
export const setLock = (on: boolean) => SecureStore.setItemAsync(LOCK_KEY, on ? "1" : "0");

/** Same scheme, host and port. */
export function sameOrigin(url: string, origin: string): boolean {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}` === origin;
  } catch {
    return false;
  }
}
