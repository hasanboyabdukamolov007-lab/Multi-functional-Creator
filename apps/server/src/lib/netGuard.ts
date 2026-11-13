import dns from "node:dns";
import net from "node:net";
import { Agent, fetch as ufetch, type RequestInit as UndiciInit } from "undici";

/**
 * Outbound HTTP for user-controlled URLs (API tester, workflows) with SSRF protection:
 * - only http/https
 * - private, loopback, link-local, CGNAT, multicast and cloud-metadata addresses are refused
 * - the check happens at connect time on every resolved address (defeats DNS rebinding)
 * - redirects are followed manually so every hop is re-checked
 * - response bodies are size-capped and requests time out
 */

const V4_BLOCKS: Array<[number, number]> = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
].map(([ip, bits]) => [v4ToInt(ip as string), bits as number]);

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, o) => (acc << 8) + (Number(o) & 255), 0) >>> 0;
}

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const n = v4ToInt(ip);
    return V4_BLOCKS.some(([base, bits]) => (bits === 0 ? true : (n >>> (32 - bits)) === (base >>> (32 - bits))));
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPrivateIp(mapped[1]);
    if (lower === "::" || lower === "::1") return true;
    const first = parseInt(lower.split(":")[0] || "0", 16);
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
    if ((first & 0xff00) === 0xff00) return true; // multicast
    return false;
  }
  return true; // not an IP at all: treat as unsafe
}

export class BlockedError extends Error {
  code = "blocked_address";
}

export function assertSafeUrl(raw: string, allowPrivate: boolean): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedError("Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new BlockedError("Only http and https URLs are allowed");
  if (url.username || url.password) throw new BlockedError("Put credentials in headers (e.g. Authorization), not in the URL");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!allowPrivate) {
    if (net.isIP(host) && isPrivateIp(host)) throw new BlockedError(`Requests to private address ${host} are blocked`);
    if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) throw new BlockedError(`Requests to ${host} are blocked`);
  }
  return url;
}

const agents = new Map<boolean, Agent>();
function agentFor(allowPrivate: boolean): Agent {
  let a = agents.get(allowPrivate);
  if (!a) {
    a = new Agent({
      connect: {
        timeout: 10_000,
        lookup: (hostname: string, options: dns.LookupOptions, cb: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void) => {
          dns.lookup(hostname, { all: true, family: options.family ?? 0 }, (err, addrs) => {
            if (err) return cb(err, "");
            const list = addrs as dns.LookupAddress[];
            if (!allowPrivate) {
              const bad = list.find((x) => isPrivateIp(x.address));
              if (bad) return cb(Object.assign(new BlockedError(`${hostname} resolves to private address ${bad.address}; blocked`), { errno: -1 }) as NodeJS.ErrnoException, "");
            }
            if (options.all) return cb(null, list);
            return cb(null, list[0].address, list[0].family);
          });
        },
      },
    });
    agents.set(allowPrivate, a);
  }
  return a;
}

export interface GuardedResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: Buffer;
  truncated: boolean;
  url: string;
  ms: number;
  redirects: number;
}

export async function guardedFetch(
  rawUrl: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
  opts: { allowPrivate: boolean; timeoutMs?: number; maxBytes?: number; maxRedirects?: number } = { allowPrivate: false },
): Promise<GuardedResponse> {
  const started = Date.now();
  const maxBytes = opts.maxBytes ?? 2 * 1024 * 1024;
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 30_000);
  let url = assertSafeUrl(rawUrl, opts.allowPrivate);
  let method = (init.method ?? "GET").toUpperCase();
  let body = init.body;
  let redirects = 0;
  for (;;) {
    const res = await ufetch(url, {
      method,
      headers: init.headers,
      body: ["GET", "HEAD"].includes(method) ? undefined : body,
      redirect: "manual",
      signal,
      dispatcher: agentFor(opts.allowPrivate),
    } as UndiciInit).catch((e: Error & { cause?: Error }) => {
      const cause = e.cause;
      if (cause instanceof BlockedError) throw cause;
      if (e.name === "TimeoutError" || cause?.name === "TimeoutError") throw new Error("The request timed out");
      throw new Error(cause?.message ?? e.message);
    });
    if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.get("location") && redirects < (opts.maxRedirects ?? 5)) {
      redirects++;
      url = assertSafeUrl(new URL(res.headers.get("location")!, url).toString(), opts.allowPrivate);
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
        method = "GET";
        body = undefined;
      }
      await res.body?.cancel();
      continue;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let truncated = false;
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          chunks.push(Buffer.from(value.subarray(0, value.byteLength - (size - maxBytes))));
          truncated = true;
          await reader.cancel();
          break;
        }
        chunks.push(Buffer.from(value));
      }
    }
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k] = v));
    return { status: res.status, statusText: res.statusText, headers, body: Buffer.concat(chunks), truncated, url: url.toString(), ms: Date.now() - started, redirects };
  }
}

/** Parse a body as JSON when the content type (or content) says so; otherwise return text. */
export function decodeBody(r: GuardedResponse): unknown {
  const text = r.body.toString("utf8");
  if (/json/i.test(r.headers["content-type"] ?? "") || /^\s*[[{]/.test(text)) {
    try {
      return JSON.parse(text);
    } catch {
      /* fall through */
    }
  }
  return text;
}
