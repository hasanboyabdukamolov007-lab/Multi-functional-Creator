export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

let onUnauthorized: (() => void) | null = null;
/** Called when an API call returns 401 outside the auth endpoints (session expired or revoked). */
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    signal,
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(method !== "GET" ? { "x-mfc-csrf": "1" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    // Proxies and gateways answer with HTML pages (502/504); never crash on them.
    if (!res.ok) throw new ApiError(res.status, res.status >= 500 ? `The server is unavailable (${res.status}). Try again in a moment.` : res.statusText || `HTTP ${res.status}`);
    throw new ApiError(res.status, "The server sent an unexpected response");
  }
  if (!res.ok) {
    // A session that expired mid-work: remember where the user was and go to sign-in.
    if (res.status === 401 && !url.startsWith("/api/auth/")) onUnauthorized?.();
    const id = typeof data.requestId === "string" ? ` (ref ${data.requestId})` : "";
    throw new ApiError(res.status, `${(data.error as string) ?? res.statusText}${res.status >= 500 ? id : ""}`, data.code as string | undefined);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string, signal?: AbortSignal) => request<T>("GET", url, undefined, signal),
  post: <T>(url: string, body: unknown = {}, signal?: AbortSignal) => request<T>("POST", url, body, signal),
  put: <T>(url: string, body: unknown = {}) => request<T>("PUT", url, body),
  patch: <T>(url: string, body: unknown = {}) => request<T>("PATCH", url, body),
  del: <T>(url: string) => request<T>("DELETE", url),
};

/** POST and consume a server-sent-events response, yielding each parsed `data:` payload. */
export async function* postSSE<T>(url: string, body: unknown, signal?: AbortSignal): AsyncGenerator<T> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    signal,
    headers: { "Content-Type": "application/json", "x-mfc-csrf": "1", Accept: "text/event-stream" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    let msg = res.statusText;
    let code: string | undefined;
    try {
      const j = JSON.parse(text);
      msg = j.error ?? msg;
      code = j.code;
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, msg, code);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const data = chunk
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (data) yield JSON.parse(data) as T;
    }
  }
}
