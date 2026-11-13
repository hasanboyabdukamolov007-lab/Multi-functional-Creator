/**
 * Function registry — every capability of the panel is a registered function, so it can be
 * reached from the command palette, keyboard shortcuts, plugins and the AI copilot alike.
 */

export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  description?: string;
  additionalProperties?: boolean | JsonSchema;
  [k: string]: unknown;
}

export interface PanelFunction<Ctx = unknown> {
  /** Stable, dotted id, e.g. "builder.insert.button". */
  id: string;
  /** Human title (English); UIs may localize via `titleKey`. */
  title: string;
  titleKey?: string;
  titleArgs?: Record<string, string>;
  category: string;
  keywords?: string[];
  shortcut?: string;
  icon?: string;
  /** JSON schema of `args`; omitted = no args. */
  params?: JsonSchema;
  /** Whether the AI copilot may call this function. Defaults to true. */
  ai?: boolean;
  /** Return false/string to disable (string = reason). */
  when?: (ctx: Ctx) => boolean | string;
  run: (args: Record<string, unknown>, ctx: Ctx) => unknown | Promise<unknown>;
}

type Listener = () => void;

export class FunctionRegistry<Ctx = unknown> {
  private fns = new Map<string, PanelFunction<Ctx>>();
  private listeners = new Set<Listener>();
  private version = 0;

  register(fn: PanelFunction<Ctx> | PanelFunction<Ctx>[]): () => void {
    const list = Array.isArray(fn) ? fn : [fn];
    for (const f of list) {
      if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/i.test(f.id)) throw new Error(`Invalid function id: ${f.id}`);
      if (this.fns.has(f.id)) throw new Error(`Duplicate function id: ${f.id}`);
      this.fns.set(f.id, f);
    }
    this.bump();
    return () => {
      for (const f of list) this.fns.delete(f.id);
      this.bump();
    };
  }

  get(id: string): PanelFunction<Ctx> | undefined {
    return this.fns.get(id);
  }

  list(): PanelFunction<Ctx>[] {
    return [...this.fns.values()];
  }

  get size(): number {
    return this.fns.size;
  }

  get rev(): number {
    return this.version;
  }

  categories(): Map<string, number> {
    const m = new Map<string, number>();
    for (const f of this.fns.values()) m.set(f.category, (m.get(f.category) ?? 0) + 1);
    return m;
  }

  search(query: string, limit = 50): PanelFunction<Ctx>[] {
    const q = query.trim().toLowerCase();
    if (!q) return this.list().slice(0, limit);
    const terms = q.split(/\s+/);
    const scored: Array<[number, PanelFunction<Ctx>]> = [];
    for (const f of this.fns.values()) {
      const hay = `${f.title} ${f.id} ${f.category} ${(f.keywords ?? []).join(" ")}`.toLowerCase();
      let score = 0;
      let ok = true;
      for (const t of terms) {
        const idx = hay.indexOf(t);
        if (idx === -1) {
          ok = false;
          break;
        }
        score += idx === 0 ? 3 : f.title.toLowerCase().includes(t) ? 2 : 1;
      }
      if (ok) scored.push([score, f]);
    }
    return scored.sort((a, b) => b[0] - a[0] || a[1].title.localeCompare(b[1].title)).slice(0, limit).map(([, f]) => f);
  }

  isEnabled(id: string, ctx: Ctx): true | string {
    const f = this.fns.get(id);
    if (!f) return "Unknown function";
    if (!f.when) return true;
    const r = f.when(ctx);
    if (r === true) return true;
    return typeof r === "string" ? r : "Not available right now";
  }

  async run(id: string, args: Record<string, unknown>, ctx: Ctx): Promise<unknown> {
    const f = this.fns.get(id);
    if (!f) throw new Error(`Unknown function: ${id}`);
    const enabled = this.isEnabled(id, ctx);
    if (enabled !== true) throw new Error(`${f.title}: ${enabled}`);
    const problems = validateArgs(f.params, args);
    if (problems.length) throw new Error(`Invalid arguments for ${id}: ${problems.join("; ")}`);
    return await f.run(args ?? {}, ctx);
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private bump() {
    this.version++;
    for (const l of this.listeners) l();
  }
}

/** Small structural validator covering the JSON-schema subset used by panel functions. */
export function validateArgs(schema: JsonSchema | undefined, value: unknown, path = "args"): string[] {
  if (!schema) return [];
  const errs: string[] = [];
  const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.length) {
    const actual = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    const okType = types.some((t) => (t === "integer" ? typeof value === "number" && Number.isInteger(value) : t === actual));
    if (!okType) {
      errs.push(`${path} should be ${types.join("|")}`);
      return errs;
    }
  }
  if (schema.enum && !schema.enum.some((e) => e === value)) errs.push(`${path} must be one of ${schema.enum.join(", ")}`);
  if (value && typeof value === "object" && !Array.isArray(value) && schema.properties) {
    const obj = value as Record<string, unknown>;
    for (const r of schema.required ?? []) if (obj[r] === undefined) errs.push(`${path}.${r} is required`);
    for (const [k, sub] of Object.entries(schema.properties)) if (obj[k] !== undefined) errs.push(...validateArgs(sub, obj[k], `${path}.${k}`));
  }
  if (Array.isArray(value) && schema.items) value.forEach((v, i) => errs.push(...validateArgs(schema.items, v, `${path}[${i}]`)));
  return errs;
}
