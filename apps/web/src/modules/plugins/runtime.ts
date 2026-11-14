/**
 * Plugin runtime. Every plugin runs in its own sandboxed iframe (opaque origin, CSP: no network), so it
 * can't read cookies, the DOM or the API. It talks to the panel only through postMessage calls that are
 * checked against the permissions in its manifest. Its functions join the registry like built-ins.
 */
import { registry, type AppFunction } from "../../lib/registry";
import { api } from "../../lib/api";
import { ws } from "../../lib/session";
import { toast } from "../../lib/ui";
import { useBuilder } from "../builder/store";
import { n as node, type BNode } from "../builder/model";
import { isKnownType } from "../builder/catalog";
import { useStudio } from "../studio/store";
import { makePrimitive, PRIMITIVES, type PrimitiveType } from "../studio/model";

export interface Manifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  permissions: Array<"builder.read" | "builder.write" | "studio.write" | "toast" | "storage" | "http">;
  functions: Array<{ id: string; title: string; keywords?: string[] }>;
}
export interface InstalledPlugin {
  id: string;
  slug: string;
  manifest: Manifest;
  code: string;
  enabled: boolean;
}

const SDK = `
const pending = new Map(); let seq = 0; const handlers = {};
const call = (method, ...args) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); parent.postMessage({ __mfc: 1, type: "call", id, method, args }, "*"); });
window.mfc = {
  register: (id, fn) => { handlers[id] = fn; },
  toast: (text, kind) => call("toast", String(text), kind),
  builder: { page: () => call("builder.page"), selected: () => call("builder.selected"), insert: (n) => call("builder.insert", n), updateSelected: (patch) => call("builder.updateSelected", patch), tokens: () => call("builder.tokens") },
  studio: { add: (spec) => call("studio.add", spec) },
  storage: { get: (k) => call("storage.get", k), set: (k, v) => call("storage.set", k, v) },
  http: { send: (req) => call("http.send", req) },
};
addEventListener("message", async (e) => {
  const m = e.data; if (!m || !m.__mfc) return;
  if (m.type === "result") { const p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.rej(new Error(m.error)) : p.res(m.value); } }
  if (m.type === "run") {
    try { const h = handlers[m.fn]; if (!h) throw new Error("Plugin has no handler for " + m.fn); const v = await h(m.args || {}); parent.postMessage({ __mfc: 1, type: "done", id: m.id, value: v === undefined ? null : v }, "*"); }
    catch (err) { parent.postMessage({ __mfc: 1, type: "done", id: m.id, error: String((err && err.message) || err) }, "*"); }
  }
});`;

interface Running {
  plugin: InstalledPlugin;
  frame: HTMLIFrameElement;
  waiting: Map<number, { res: (v: unknown) => void; rej: (e: Error) => void }>;
}
const running = new Map<string, Running>();
let unregister: (() => void) | null = null;
let runSeq = 0;

const cleanNode = (raw: unknown, depth = 0): BNode => {
  const r = raw as { type?: string; props?: Record<string, unknown>; style?: Record<string, string>; children?: unknown[] };
  if (!r || typeof r.type !== "string" || !isKnownType(r.type)) throw new Error(`Unknown component type: ${r?.type}`);
  if (depth > 8) throw new Error("Node tree is too deep");
  const props = Object.fromEntries(Object.entries(r.props ?? {}).filter(([, v]) => ["string", "number", "boolean"].includes(typeof v)));
  return node(r.type, props, (r.children ?? []).slice(0, 50).map((c) => cleanNode(c, depth + 1)), Object.fromEntries(Object.entries(r.style ?? {}).filter(([k, v]) => typeof v === "string" && /^[a-zA-Z-]+$/.test(k))));
};

async function hostCall(p: InstalledPlugin, method: string, args: unknown[]): Promise<unknown> {
  const need: Record<string, Manifest["permissions"][number]> = { "builder.page": "builder.read", "builder.selected": "builder.read", "builder.tokens": "builder.read", "builder.insert": "builder.write", "builder.updateSelected": "builder.write", "studio.add": "studio.write", toast: "toast", "storage.get": "storage", "storage.set": "storage", "http.send": "http" };
  const perm = need[method];
  if (!perm) throw new Error(`Unknown API ${method}`);
  if (!p.manifest.permissions.includes(perm)) throw new Error(`Permission “${perm}” not granted to ${p.manifest.name}`);
  const B = useBuilder.getState();
  switch (method) {
    case "toast":
      return toast(`${p.manifest.name}: ${String(args[0]).slice(0, 300)}`, ["info", "success", "warning", "error"].includes(String(args[1])) ? (args[1] as "info") : "info");
    case "builder.page":
      if (!B.projectId) throw new Error("No builder project is open");
      return JSON.parse(JSON.stringify(B.page()));
    case "builder.tokens":
      if (!B.projectId) throw new Error("No builder project is open");
      return { ...B.doc.tokens };
    case "builder.selected":
      return B.selected() ? JSON.parse(JSON.stringify(B.selected())) : null;
    case "builder.insert": {
      if (!B.projectId) throw new Error("No builder project is open");
      const n = B.insert(cleanNode(args[0]));
      return n.id;
    }
    case "builder.updateSelected": {
      const sel = B.selected();
      if (!sel) throw new Error("Nothing is selected");
      const patch = (args[0] ?? {}) as { props?: Record<string, unknown>; style?: Record<string, string | null> };
      B.update(sel.id, { props: patch.props, style: patch.style });
      return true;
    }
    case "studio.add": {
      const S = useStudio.getState();
      if (!S.projectId) throw new Error("No 3D scene is open");
      const spec = (args[0] ?? {}) as { shape?: string; position?: number[]; color?: string; scale?: number };
      const shape = (PRIMITIVES as readonly string[]).includes(spec.shape ?? "") ? (spec.shape as PrimitiveType) : "box";
      const o = makePrimitive(shape, { position: (spec.position?.slice(0, 3).map(Number) as [number, number, number]) ?? [0, 0.6, 0], scale: [spec.scale ?? 1, spec.scale ?? 1, spec.scale ?? 1] });
      if (spec.color && /^#[0-9a-f]{6}$/i.test(spec.color)) o.material = { ...o.material!, color: spec.color };
      return S.add(o).id;
    }
    case "storage.get":
      try {
        return JSON.parse(localStorage.getItem(`mfc.plugin.${p.slug}.${String(args[0])}`) ?? "null");
      } catch {
        return null;
      }
    case "storage.set":
      localStorage.setItem(`mfc.plugin.${p.slug}.${String(args[0])}`, JSON.stringify(args[1]).slice(0, 100_000));
      return true;
    case "http.send": {
      // Goes through the server's SSRF-guarded proxy with the user's own permissions.
      const r = args[0] as { method?: string; url: string; headers?: Record<string, string>; body?: string };
      return api.post(ws("/http/send"), { method: r.method ?? "GET", url: r.url, headers: r.headers ?? {}, body: r.body ?? "", environment: "development" });
    }
  }
}

function start(p: InstalledPlugin): Running {
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("aria-hidden", "true");
  frame.style.display = "none";
  frame.srcdoc = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'"><script>${SDK}<\/script><script>${p.code.replace(/<\/script/gi, "<\\/script")}<\/script>`;
  document.body.appendChild(frame);
  const r: Running = { plugin: p, frame, waiting: new Map() };
  running.set(p.slug, r);
  return r;
}

if (typeof window !== "undefined") {
  window.addEventListener("message", (e) => {
    const r = [...running.values()].find((x) => x.frame.contentWindow === e.source);
    const m = e.data as { __mfc?: number; type?: string; id?: number; method?: string; args?: unknown[]; value?: unknown; error?: string };
    if (!r || !m?.__mfc) return;
    if (m.type === "call") {
      hostCall(r.plugin, String(m.method), Array.isArray(m.args) ? m.args : [])
        .then((value) => r.frame.contentWindow?.postMessage({ __mfc: 1, type: "result", id: m.id, value: value === undefined ? null : value }, "*"))
        .catch((err: Error) => r.frame.contentWindow?.postMessage({ __mfc: 1, type: "result", id: m.id, error: err.message }, "*"));
    } else if (m.type === "done") {
      const w = r.waiting.get(Number(m.id));
      if (!w) return;
      r.waiting.delete(Number(m.id));
      if (m.error) w.rej(new Error(m.error));
      else w.res(m.value);
    }
  });
}

function invoke(slug: string, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const r = running.get(slug);
  if (!r) return Promise.reject(new Error("Plugin is not running"));
  const id = ++runSeq;
  return new Promise((res, rej) => {
    r.waiting.set(id, { res, rej });
    r.frame.contentWindow?.postMessage({ __mfc: 1, type: "run", id, fn, args }, "*");
    setTimeout(() => r.waiting.has(id) && (r.waiting.delete(id), rej(new Error("Plugin timed out (10 s)"))), 10_000);
  });
}

/** (Re)load the workspace's enabled plugins and expose their functions in the registry. */
export async function loadPlugins(list?: InstalledPlugin[]): Promise<number> {
  const plugins = list ?? (await api.get<{ plugins: InstalledPlugin[] }>(ws("/plugins")).then((r) => r.plugins).catch(() => []));
  for (const r of running.values()) r.frame.remove();
  running.clear();
  unregister?.();
  unregister = null;
  const fns: AppFunction[] = [];
  for (const p of plugins.filter((x) => x.enabled)) {
    start(p);
    for (const f of p.manifest.functions) {
      fns.push({ id: `plugin.${p.slug}.${f.id}`, title: f.title, category: `Plugin · ${p.manifest.name}`, keywords: [...(f.keywords ?? []), "plugin", p.manifest.name.toLowerCase()], run: (args) => invoke(p.slug, f.id, args) });
    }
  }
  if (fns.length) unregister = registry.register(fns);
  return fns.length;
}

/** Example plugins that show what the SDK can do (installable from the Plugins page). */
export const EXAMPLES: Array<{ manifest: Manifest; code: string }> = [
  {
    manifest: { id: "content-blocks", name: "Content blocks", version: "1.0.0", description: "Inserts ready-made sections: testimonials, FAQ and a pricing teaser.", author: "MFC", permissions: ["builder.write", "toast"], functions: [{ id: "testimonial", title: "Insert a testimonial section", keywords: ["quote", "review"] }, { id: "faq", title: "Insert an FAQ section", keywords: ["questions"] }] },
    code: `mfc.register("testimonial", async () => {
  await mfc.builder.insert({ type: "section", props: { tone: "surface" }, children: [
    { type: "heading", props: { text: "Loved by teams", level: 2 } },
    { type: "testimonial", props: { quote: "We shipped our site in an afternoon.", author: "Dilnoza R.", role: "Founder" } } ] });
  await mfc.toast("Testimonial section added", "success");
});
mfc.register("faq", async () => {
  await mfc.builder.insert({ type: "faq", props: { title: "Questions", items: "How fast is it?|Very fast.\\nDo I need to code?|No." } });
});`,
  },
  {
    manifest: { id: "contrast-checker", name: "Contrast checker", version: "1.0.0", description: "Checks the page's brand colours against WCAG contrast and reports the ratios.", author: "MFC", permissions: ["builder.read", "toast"], functions: [{ id: "check", title: "Check brand colour contrast", keywords: ["a11y", "wcag", "contrast"] }] },
    code: `const lum = (hex) => { const v = parseInt(hex.slice(1), 16); return [16, 8, 0].map((s) => { const c = ((v >> s) & 255) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
mfc.register("check", async () => {
  const t = await mfc.builder.tokens();
  const pairs = [["Text", t.text, t.bg], ["Button", t.primaryText, t.primary], ["Muted", t.muted, t.bg]];
  const report = pairs.map(([n, a, b]) => n + " " + ratio(a, b).toFixed(2) + (ratio(a, b) >= 4.5 ? " ✓" : " ✕")).join(" · ");
  await mfc.toast(report, report.includes("✕") ? "warning" : "success");
  return report;
});`,
  },
  {
    manifest: { id: "sculptor", name: "Random sculptor", version: "1.0.0", description: "Adds a generative cluster of shapes to the open 3D scene.", author: "MFC", permissions: ["studio.write", "storage"], functions: [{ id: "sculpt", title: "Add a generative sculpture", keywords: ["3d", "random", "art"] }] },
    code: `mfc.register("sculpt", async () => {
  const runs = ((await mfc.storage.get("runs")) || 0) + 1; await mfc.storage.set("runs", runs);
  const shapes = ["sphere", "box", "torus", "icosahedron", "cone"]; const hue = (runs * 47) % 360;
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const c = "#" + [0, 8, 4].map((n) => { const k = (n + hue / 30) % 12; const v = 0.55 - 0.45 * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(v * 255).toString(16).padStart(2, "0"); }).join("");
    await mfc.studio.add({ shape: shapes[i % shapes.length], position: [Math.cos(a) * 1.6, 0.5 + (i % 3) * 0.45, Math.sin(a) * 1.6], color: c, scale: 0.5 + (i % 3) * 0.2 });
  }
  return "Sculpture #" + runs;
});`,
  },
];
