/**
 * Forge's knowledge base + retrieval. BM25 over titles, keywords and summaries in three languages,
 * boosted by phrase matches and by aliases the brain has learned (from self-tests and user feedback).
 */
import { WEB } from "./kb/web";
import { CODE } from "./kb/code";
import { BACKEND } from "./kb/backend";
import { OPS_DESIGN } from "./kb/ops-design";
import { PANEL } from "./kb/panel";
import { CAT_LABEL, type KCat, type KEntry, type L3 } from "./kb/types";
import { normalize, stem, stems, tokens, trigrams, jaccard } from "./text";

export type Lang = "en" | "uz" | "ru";
export const KB: KEntry[] = [...WEB, ...CODE, ...BACKEND, ...OPS_DESIGN, ...PANEL];
export const KB_BY_ID = new Map(KB.map((e) => [e.id, e]));
export { CAT_LABEL };
export type { KEntry, KCat, L3 };

interface Doc {
  id: string;
  tf: Map<string, number>;
  len: number;
  phrases: string[];
  tri: string[];
}

const W_TITLE = 3;
const W_KW = 3;
const W_SUM = 1;
const W_POINT = 0.4;

function buildDoc(e: KEntry): Doc {
  const tf = new Map<string, number>();
  const add = (text: string, w: number) => {
    for (const s of stems(text)) tf.set(s, (tf.get(s) ?? 0) + w);
  };
  for (const l of ["en", "uz", "ru"] as const) {
    add(e.title[l], W_TITLE);
    add(e.sum[l], W_SUM);
  }
  for (const k of e.kw) add(k, W_KW);
  for (const p of e.points) add(p, W_POINT);
  add(e.id.replace(/-/g, " "), W_KW);
  const len = [...tf.values()].reduce((a, b) => a + b, 0);
  return { id: e.id, tf, len, phrases: e.kw.filter((k) => k.includes(" ")).map(normalize), tri: trigrams([e.title.en, ...e.kw.filter((k) => !k.includes(" "))].join(" ")) };
}

let docs: Doc[] = KB.map(buildDoc);
let avgLen = docs.reduce((a, d) => a + d.len, 0) / docs.length;
const df = new Map<string, number>();
const reindexDf = () => {
  df.clear();
  for (const d of docs) for (const s of d.tf.keys()) df.set(s, (df.get(s) ?? 0) + 1);
};
reindexDf();

/** Register extra entries at runtime (e.g. generated from the function registry). */
export function addEntries(extra: KEntry[]) {
  for (const e of extra) {
    if (KB_BY_ID.has(e.id)) continue;
    KB.push(e);
    KB_BY_ID.set(e.id, e);
    docs.push(buildDoc(e));
  }
  avgLen = docs.reduce((a, d) => a + d.len, 0) / docs.length;
  reindexDf();
}

export type Aliases = Record<string, Record<string, number>>; // entryId → stem → learned weight

export interface Hit {
  entry: KEntry;
  score: number;
}

/** Ranked search. `aliases` are words the brain learned map to an entry. */
export function search(query: string, aliases: Aliases = {}, limit = 5): Hit[] {
  const q = stems(query);
  const qn = normalize(query);
  const qtri = trigrams(query);
  if (!q.length && !qtri.length) return [];
  const N = docs.length;
  const k1 = 1.4;
  const b = 0.72;
  const scored = docs.map((d) => {
    let s = 0;
    for (const t of q) {
      // Prefix match lets "flexboxni" find "flexbo" and "контрастный" find "контра".
      let tf = d.tf.get(t) ?? 0;
      if (!tf && t.length >= 4) for (const [k, v] of d.tf) if (k.length >= 4 && (k.startsWith(t) || t.startsWith(k))) tf = Math.max(tf, v * 0.7);
      if (tf) {
        const n = df.get(t) ?? 1;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        s += (idf * (tf * (k1 + 1))) / (tf + k1 * (1 - b + (b * d.len) / avgLen));
      }
      const learned = aliases[d.id]?.[t];
      if (learned) s += learned;
    }
    for (const p of d.phrases) if (qn.includes(p)) s += 2.5;
    s += jaccard(qtri, d.tri) * 3; // typo tolerance
    return { entry: KB_BY_ID.get(d.id)!, score: s };
  });
  return scored.filter((h) => h.score > 0.8).sort((a, b) => b.score - a.score).slice(0, limit);
}

// ---------------------------------------------------------------------------------------------
// Answer composition (markdown)

const L = {
  en: { key: "Key points", example: "Example", watch: "Watch out", related: "Related", lesson: "Lesson", step: "Step", practice: "Practice in the panel", next: "Next, you could learn", vs: "vs", compare: "Comparison", notSure: "I'm not certain which topic you mean. Closest matches:", none: "I don't have that in my knowledge base yet. Try rephrasing, or ask about HTML, CSS, JavaScript, React, APIs, databases, security, deployment, design or 3D." },
  uz: { key: "Asosiy fikrlar", example: "Misol", watch: "Ehtiyot bo‘ling", related: "Bog‘liq mavzular", lesson: "Dars", step: "Qadam", practice: "Panelda mashq qiling", next: "Keyin o‘rganishingiz mumkin", vs: "va", compare: "Taqqoslash", notSure: "Qaysi mavzuni nazarda tutganingizni aniq bilmayman. Eng yaqinlari:", none: "Bu hozircha bilimlar bazamda yo‘q. Boshqacha so‘rang yoki HTML, CSS, JavaScript, React, API, baza, xavfsizlik, joylash, dizayn yoki 3D haqida so‘rang." },
  ru: { key: "Главное", example: "Пример", watch: "Осторожно", related: "Связанные темы", lesson: "Урок", step: "Шаг", practice: "Попробуйте в панели", next: "Дальше можно изучить", vs: "и", compare: "Сравнение", notSure: "Не уверен, какую тему вы имеете в виду. Ближайшие:", none: "Этого пока нет в базе знаний. Переформулируйте или спросите про HTML, CSS, JavaScript, React, API, базы данных, безопасность, деплой, дизайн или 3D." },
};
export const UI_TEXT = L;

const fence = (e: KEntry) => (e.example ? `\n\n**${"{EX}"}**\n\n\`\`\`${e.example.lang}\n${e.example.code}\n\`\`\`` : "");

export function explain(e: KEntry, lang: Lang, depth: "short" | "full" = "full"): string {
  const t = L[lang];
  const parts = [`### ${e.title[lang]}`, e.sum[lang]];
  if (depth === "full") {
    parts.push(`**${t.key}**\n${e.points.map((p) => `- ${p}`).join("\n")}`);
    if (e.example) parts.push(fence(e).replace("{EX}", t.example).trim());
    if (e.pitfalls?.length) parts.push(`**${t.watch}**\n${e.pitfalls.map((p) => `- ${p}`).join("\n")}`);
    const rel = (e.related ?? []).map((id) => KB_BY_ID.get(id)).filter(Boolean) as KEntry[];
    if (rel.length) parts.push(`**${t.related}:** ${rel.map((r) => r.title[lang]).join(" · ")}`);
  }
  return parts.join("\n\n");
}

export function lesson(e: KEntry, lang: Lang): string {
  const t = L[lang];
  const parts = [`### 🎓 ${t.lesson}: ${e.title[lang]}`, e.sum[lang]];
  parts.push(e.points.map((p, i) => `**${t.step} ${i + 1}.** ${p}`).join("\n\n"));
  if (e.example) parts.push(fence(e).replace("{EX}", t.example).trim());
  if (e.pitfalls?.length) parts.push(`**${t.watch}**\n${e.pitfalls.map((p) => `- ${p}`).join("\n")}`);
  const next = (e.related ?? []).map((id) => KB_BY_ID.get(id)).filter(Boolean) as KEntry[];
  if (next.length) parts.push(`**${t.next}:** ${next.map((r) => r.title[lang]).join(" · ")}`);
  return parts.join("\n\n");
}

export function compare(a: KEntry, b: KEntry, lang: Lang): string {
  const t = L[lang];
  const rows = Math.max(a.points.length, b.points.length);
  const cell = (s?: string) => (s ?? "").replace(/\|/g, "\\|");
  const table = [`| ${a.title[lang]} | ${b.title[lang]} |`, "|---|---|", ...Array.from({ length: Math.min(rows, 5) }, (_, i) => `| ${cell(a.points[i])} | ${cell(b.points[i])} |`)].join("\n");
  return [`### ${t.compare}: ${a.title[lang]} ${t.vs} ${b.title[lang]}`, `**${a.title[lang]}** — ${a.sum[lang]}`, `**${b.title[lang]}** — ${b.sum[lang]}`, table].join("\n\n");
}

export function categoryOf(query: string): KCat | null {
  const q = stems(query);
  for (const [cat, label] of Object.entries(CAT_LABEL) as Array<[KCat, L3]>) {
    const ls = new Set(stems(`${label.en} ${label.uz} ${label.ru} ${cat}`));
    if (q.some((s) => ls.has(s))) return cat;
  }
  return null;
}

export const entryTitleTokens = (e: KEntry) => tokens(`${e.title.en} ${e.title.uz} ${e.title.ru}`).map(stem);
