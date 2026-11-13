/**
 * {{ path.to.value }} templates for workflows and the API tester.
 * - {{ secrets.NAME }} pulls a value from the vault (resolved lazily, never logged)
 * - a template that is exactly one placeholder keeps the value's type (numbers, objects)
 */
const PLACEHOLDER = /\{\{\s*([A-Za-z_$][\w$]*(?:\.[\w$-]+|\[\d+\])*)\s*\}\}/g;

export type SecretResolver = (name: string) => Promise<string>;

export function getPath(ctx: unknown, path: string): unknown {
  let cur: unknown = ctx;
  for (const part of path.replace(/\[(\d+)\]/g, ".$1").split(".")) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

async function lookup(path: string, ctx: Record<string, unknown>, secret?: SecretResolver): Promise<unknown> {
  if (path.startsWith("secrets.")) {
    if (!secret) throw new Error("Secrets are not available here");
    return secret(path.slice(8));
  }
  return getPath(ctx, path);
}

const toText = (v: unknown) => (v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

export async function renderValue(tpl: string, ctx: Record<string, unknown>, secret?: SecretResolver): Promise<unknown> {
  const single = /^\{\{\s*([A-Za-z_$][\w$]*(?:\.[\w$-]+|\[\d+\])*)\s*\}\}$/.exec(tpl.trim());
  if (single) return lookup(single[1], ctx, secret);
  return renderString(tpl, ctx, secret);
}

export async function renderString(tpl: string, ctx: Record<string, unknown>, secret?: SecretResolver): Promise<string> {
  const parts: string[] = [];
  let last = 0;
  for (const m of tpl.matchAll(PLACEHOLDER)) {
    parts.push(tpl.slice(last, m.index), toText(await lookup(m[1], ctx, secret)));
    last = m.index! + m[0].length;
  }
  parts.push(tpl.slice(last));
  return parts.join("");
}

export async function renderRecord(obj: Record<string, string> | undefined, ctx: Record<string, unknown>, secret?: SecretResolver): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj ?? {})) if (k.trim()) out[k.trim()] = await renderString(String(v), ctx, secret);
  return out;
}

/** Names of vault secrets referenced in a template (for redaction and validation). */
export function referencedSecrets(...templates: Array<string | undefined>): string[] {
  const names = new Set<string>();
  for (const t of templates) for (const m of (t ?? "").matchAll(PLACEHOLDER)) if (m[1].startsWith("secrets.")) names.add(m[1].slice(8));
  return [...names];
}
