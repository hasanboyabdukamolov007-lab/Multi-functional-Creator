/**
 * Continuous learning loop. While the panel is open and idle, Forge:
 *  1. tests itself on freshly generated phrasings of every panel function and learns from its misses;
 *  2. quizzes its knowledge retrieval in three languages and learns new aliases when it ranks wrongly;
 *  3. runs design experiments (generates pages, audits contrast/accessibility, keeps what scores best);
 *  4. studies the workspace's own projects (components, palettes, structure) to learn a house style.
 * Everything runs on the device in small idle-time batches and is measured, so progress is visible in the Lab.
 */
import { registry } from "../../../lib/registry";
import { functionTitle } from "../../../shell/CommandPalette";
import { projectsApi } from "../../../lib/projects";
import { auditPage } from "../../builder/a11y";
import { DEFAULT_TOKENS, newPage, walk, type BuilderDoc, type BNode } from "../../builder/model";
import { generatePage } from "../engine/pageGen";
import { DOMAIN_COPY } from "../engine/content";
import type { PageType } from "../engine/planner";
import { predict, prune, train } from "./classifier";
import { KB, search } from "./knowledge";
import { useBrain } from "./memory";
import { pick, rng, stems, tokens } from "./text";

const FILLERS = {
  en: ["please", "can you", "I want to", "could you", "now", "quickly", "for me", "let's"],
  uz: ["iltimos", "menga", "hozir", "tezda", "kerak", "qil"],
  ru: ["пожалуйста", "можешь", "хочу", "сейчас", "быстро", "давай"],
};
const VERB_SWAP: Record<string, string[]> = {
  open: ["show", "go to", "display", "och", "открой"],
  toggle: ["switch", "turn", "almashtir", "переключи"],
  export: ["download", "save as", "yuklab ol", "скачай"],
  create: ["make", "new", "build", "yarat", "создай"],
  add: ["insert", "put", "qo'sh", "добавь"],
  delete: ["remove", "erase", "o'chir", "удали"],
  show: ["list", "view", "ko'rsat", "покажи"],
};

function seedKey() {
  return String(registry.size) + ":" + registry.list().length;
}

/** (Re)seed the classifier from the function registry whenever functions change. */
export function ensureSeeded() {
  const b = useBrain.getState();
  if (b.data.seedKey === seedKey() && Object.keys(b.data.nb.classes).length) return;
  b.mutate((d) => {
    for (const f of registry.list()) {
      if (f.id.startsWith("copilot.")) continue;
      const title = functionTitle(f);
      train(d.nb, title, f.id, 1);
      train(d.nb, `${f.id.replace(/[._-]/g, " ")} ${(f.keywords ?? []).join(" ")}`, f.id, 0.6);
    }
    for (const ex of d.examples) if (ex.source !== "self") train(d.nb, ex.text, ex.label, 2);
    prune(d.nb);
    d.seedKey = seedKey();
  });
}

/** Make a realistic paraphrase of a function title: drop/shuffle words, fillers, verb swaps, typos. */
export function paraphrase(title: string, r: () => number): string {
  let ws = tokens(title).filter((w) => !/^[-–·]$/.test(w));
  ws = ws.map((w) => (VERB_SWAP[w] && r() < 0.5 ? pick(r, VERB_SWAP[w]) : w));
  if (ws.length > 3 && r() < 0.4) ws.splice(Math.floor(r() * ws.length), 1);
  if (ws.length > 2 && r() < 0.3) {
    const i = Math.floor(r() * (ws.length - 1));
    [ws[i], ws[i + 1]] = [ws[i + 1], ws[i]];
  }
  const lang = pick(r, ["en", "en", "uz", "ru"] as const);
  if (r() < 0.6) ws.unshift(pick(r, FILLERS[lang]));
  if (r() < 0.25) {
    const i = Math.floor(r() * ws.length);
    const w = ws[i];
    if (w.length > 4) {
      const j = 1 + Math.floor(r() * (w.length - 2));
      ws[i] = w.slice(0, j) + w[j + 1] + w[j] + w.slice(j + 2);
    }
  }
  return ws.join(" ");
}

const KB_TEMPLATES = {
  en: ["what is {t}", "explain {t}", "how does {t} work", "tell me about {t}", "{t}?"],
  uz: ["{t} nima", "{t} haqida tushuntir", "{t} qanday ishlaydi", "menga {t} ni o'rgat"],
  ru: ["что такое {t}", "объясни {t}", "как работает {t}", "расскажи про {t}"],
};

/** One self-test round. Returns accuracy before learning. */
export function selfTestRound(seed = Date.now(), nFn = 24, nKb = 10): { fnAcc: number; kbAcc: number; learned: number } {
  ensureSeeded();
  const r = rng(seed);
  const fns = registry.list().filter((f) => !f.id.startsWith("copilot."));
  let fnOk = 0;
  let kbOk = 0;
  let learned = 0;
  useBrain.getState().mutate((d) => {
    for (let i = 0; i < nFn && fns.length; i++) {
      const f = pick(r, fns);
      const q = paraphrase(functionTitle(f), r);
      const top = predict(d.nb, q, 1)[0];
      if (top?.label === f.id) fnOk++;
      else {
        train(d.nb, q, f.id, 0.5);
        learned++;
        d.examples.push({ text: q, label: f.id, source: "self", at: new Date().toISOString() });
      }
    }
    for (let i = 0; i < nKb; i++) {
      const e = pick(r, KB);
      const lang = pick(r, ["en", "uz", "ru"] as const);
      const topic = r() < 0.5 ? e.title[lang] : pick(r, e.kw);
      const q = pick(r, KB_TEMPLATES[lang]).replace("{t}", topic);
      const hit = search(q, d.aliases, 1)[0];
      if (hit?.entry.id === e.id) kbOk++;
      else {
        // Learn: words in this phrasing should point to this entry.
        const al = (d.aliases[e.id] ??= {});
        for (const s of stems(q)) al[s] = Math.min(3, (al[s] ?? 0) + 0.6);
        learned++;
      }
    }
    d.totals.fnTests += nFn;
    d.totals.kbTests += nKb;
    d.totals.learnedFromTests += learned;
    d.metrics.push({ at: new Date().toISOString(), fnAcc: fnOk / nFn, kbAcc: kbOk / nKb, tests: nFn + nKb, learned });
    if (d.metrics.length % 20 === 0) prune(d.nb);
  });
  return { fnAcc: fnOk / nFn, kbAcc: kbOk / nKb, learned };
}

// ------------------------------------------------------------------------------------------ experiments

const hsl = (h: number, s: number, l: number) => {
  const a = (s * Math.min(l, 1 - l)) / 1;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
};
export const armKey = (dark: boolean, hue: number, light: number) => `${dark ? "d" : "l"}:${Math.floor(hue / 30)}:${light < 0.4 ? "dk" : light < 0.6 ? "md" : "lt"}`;

const TYPES: PageType[] = ["landing", "portfolio", "dashboard", "shop", "blog", "pricing", "contact", "comingSoon", "mobile"];

/** Generate a page with random design choices, audit it, and update the bandit for that palette. */
export function experimentRound(seed = Date.now(), n = 3) {
  const r = rng(seed);
  const domains = Object.keys(DOMAIN_COPY);
  useBrain.getState().mutate((d) => {
    for (let i = 0; i < n; i++) {
      const dark = r() < 0.5;
      const hue = Math.floor(r() * 360);
      const light = 0.25 + r() * 0.5;
      const primary = hsl(hue, 0.55 + r() * 0.35, light);
      const g = generatePage({ type: pick(r, TYPES), domain: pick(r, domains), lang: pick(r, ["en", "uz", "ru"] as const), brand: null, primary, dark, include: [], exclude: [] });
      const page = newPage("Experiment");
      page.root.children = g.nodes;
      const { score } = auditPage(page, { ...DEFAULT_TOKENS, ...g.tokens });
      const s = Math.max(0, Math.min(1, score / 100));
      const k = armKey(dark, hue, light);
      const arm = (d.arms[k] ??= { a: 1, b: 1 });
      arm.a += s;
      arm.b += 1 - s;
      if (s > (arm.bestScore ?? -1)) {
        arm.best = primary;
        arm.bestScore = s;
      }
      d.bestPalettes = [...d.bestPalettes.filter((p) => p.primary !== primary), { primary, dark, score: s }].sort((a, b) => b.score - a.score).slice(0, 12);
      d.totals.experiments++;
    }
  });
}

/** Thompson-sampled palette (for "surprise me") or the best known one close to a hue. */
export function recommendPrimary(dark: boolean, opts: { nearHex?: string; explore?: boolean; seed?: number } = {}): string | null {
  const d = useBrain.getState().data;
  const arms = Object.entries(d.arms).filter(([k, a]) => k.startsWith(dark ? "d:" : "l:") && a.best);
  if (!arms.length) return null;
  if (opts.explore) {
    const r = rng(opts.seed ?? Date.now());
    // Beta sample ≈ mean + noise scaled by uncertainty.
    const sample = (a: number, b: number) => a / (a + b) + (r() - 0.5) * Math.sqrt((a * b) / ((a + b) ** 2 * (a + b + 1))) * 3;
    arms.sort((x, y) => sample(y[1].a, y[1].b) - sample(x[1].a, x[1].b));
    return arms[0][1].best ?? null;
  }
  if (!opts.nearHex) return null;
  const hue = hueOf(opts.nearHex);
  const bucket = Math.floor(hue / 30);
  const same = arms.filter(([k]) => Number(k.split(":")[1]) === bucket && (k.split(":")[0] === (dark ? "d" : "l")));
  same.sort((x, y) => y[1].a / (y[1].a + y[1].b) - x[1].a / (x[1].a + x[1].b));
  return same[0]?.[1].bestScore && same[0][1].bestScore > 0.9 ? same[0][1].best ?? null : null;
}
function hueOf(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0;
  const v = parseInt(m[1], 16);
  const [r, g, b] = [(v >> 16) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const dd = max - min;
  const h = max === r ? ((g - b) / dd) % 6 : max === g ? (b - r) / dd + 2 : (r - g) / dd + 4;
  return ((h * 60) + 360) % 360;
}

// ------------------------------------------------------------------------------------------ project mining

/** Learn the workspace's house style from its builder projects (built here or imported). */
export async function mineProjects(limit = 25): Promise<number> {
  const list = (await projectsApi.list()).filter((p) => p.kind === "site" || p.kind === "panel" || p.kind === "app").slice(0, limit);
  const seen = useBrain.getState().data.style.seen;
  const fresh = list.filter((p) => seen[p.id] !== p.updated_at);
  let learned = 0;
  for (const p of fresh) {
    try {
      const full = await projectsApi.get<BuilderDoc>(p.id);
      const doc = full.data;
      if (!doc?.pages?.length) continue;
      useBrain.getState().mutate((d) => {
        const st = d.style;
        const bump = (m: Record<string, number>, k: string | undefined, w = 1) => k && (m[k] = (m[k] ?? 0) + w);
        bump(st.primaries, doc.tokens?.primary?.toLowerCase());
        bump(st.radius, doc.tokens?.radius);
        bump(st.fonts, doc.tokens?.font?.split(",")[0]?.replace(/"/g, "").trim());
        for (const page of doc.pages) {
          walk(page.root, (n: BNode) => n.type !== "page" && bump(st.components, n.type, 0.2));
          for (const sec of page.root.children) bump(st.sections, sec.type);
        }
        st.seen[p.id] = p.updated_at;
        st.at = new Date().toISOString();
        d.totals.projectsLearned++;
      });
      learned++;
    } catch {
      /* skip unreadable projects */
    }
  }
  return learned;
}

/** The style this workspace prefers, once it's consistent enough to act on. */
export function houseStyle(): { primary?: string; radius?: string; favouriteSections: string[] } {
  const st = useBrain.getState().data.style;
  const top = (m: Record<string, number>) => Object.entries(m).sort((a, b) => b[1] - a[1])[0];
  const total = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);
  const p = top(st.primaries);
  const rd = top(st.radius);
  return {
    primary: p && p[1] >= 3 && p[1] / total(st.primaries) >= 0.5 ? p[0] : undefined,
    radius: rd && rd[1] >= 3 && rd[1] / total(st.radius) >= 0.5 ? rd[0] : undefined,
    favouriteSections: Object.entries(st.sections).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k),
  };
}

// ------------------------------------------------------------------------------------------ the loop

let timer: ReturnType<typeof setTimeout> | null = null;
let round = 0;
let lastMine = 0;

const idle = (fn: () => void) => ((window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 50)))(fn, { timeout: 2000 });

/** Start learning continuously (every ~15 s while visible and idle). Safe to call more than once. */
export function startLearning() {
  if (timer || typeof window === "undefined") return;
  const tick = () => {
    timer = setTimeout(tick, document.hidden ? 60_000 : 15_000);
    const d = useBrain.getState().data;
    const saveData = (navigator as { connection?: { saveData?: boolean } }).connection?.saveData;
    if (d.paused || document.hidden || saveData) return;
    idle(() => {
      round++;
      try {
        selfTestRound(Date.now() ^ round);
        if (round % 2 === 0) experimentRound(Date.now() ^ (round << 8), 2);
      } catch (e) {
        console.warn("Forge learning round failed", e);
      }
      if (Date.now() - lastMine > 6 * 3600_000) {
        lastMine = Date.now();
        void mineProjects().catch(() => undefined);
      }
    });
  };
  timer = setTimeout(tick, 4000);
}

export function stopLearning() {
  if (timer) clearTimeout(timer);
  timer = null;
}
