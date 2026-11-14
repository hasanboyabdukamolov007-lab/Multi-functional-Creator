/**
 * The Academy course is generated, not hard-coded: lessons come from Forge's knowledge base, the live
 * function registry and what the brain has learned. When Forge learns or the panel gains functions,
 * the course version changes and affected lessons are marked "updated".
 */
import { registry } from "../../lib/registry";
import { functionTitle } from "../../shell/CommandPalette";
import { CAT_LABEL, KB, type KCat, type KEntry, type Lang } from "../copilot/brain/knowledge";
import { syncRegistryKnowledge } from "../copilot/brain";
import { brain } from "../copilot/brain/memory";
import type { QuizQ } from "../copilot/brain/kb/types";
import { load } from "../../lib/storage";

export type Visual = "flex" | "grid" | "devices" | "promise" | "loop" | "request" | "contrast" | "branches" | "pipeline" | "cube" | "easing" | "tables" | "shield" | "tree" | "palette" | "keys" | "bullets";

export type Scene =
  | { kind: "title"; title: string; subtitle: string; say: string }
  | { kind: "concept"; text: string; visual: Visual; say: string; sayLang: Lang }
  | { kind: "point"; index: number; total: number; text: string; visual: Visual; say: string }
  | { kind: "code"; lang: string; code: string; say: string }
  | { kind: "pitfalls"; items: string[]; say: string }
  | { kind: "quiz"; q: QuizQ; say: string }
  | { kind: "try"; fn: string; label: string; say: string }
  | { kind: "outro"; title: string; next: string | null; say: string };

export interface Lesson {
  id: string;
  title: string;
  summary: string;
  track: string;
  scenes: Scene[];
  /** Estimated running time in seconds. */
  seconds: number;
  /** Content fingerprint — changes when the lesson's source knowledge changes. */
  hash: string;
  entryId?: string;
}
export interface Track {
  id: string;
  title: string;
  lessons: Lesson[];
}
export interface Course {
  version: string;
  generatedAt: string;
  tracks: Track[];
  stats: { lessons: number; minutes: number; functions: number; topics: number; learned: number };
}

const VISUAL: Record<string, Visual> = {
  flexbox: "flex", "css-grid": "grid", responsive: "devices", "js-async": "promise", "event-loop": "loop",
  "rest-api": "request", "http-status": "request", webhooks: "request", openapi: "request", validation: "request",
  a11y: "contrast", "color-contrast": "contrast", typography: "contrast", "design-systems": "palette", "css-variables": "palette",
  git: "branches", "ci-cd": "pipeline", "deploy-basics": "pipeline", docker: "pipeline", "dns-ssl": "pipeline", caching: "pipeline", monitoring: "pipeline", pwa: "devices",
  "3d-basics": "cube", "pbr-materials": "cube", "css-animation": "easing", "motion-principles": "easing",
  "sql-basics": "tables", normalization: "tables", indexes: "tables", migrations: "tables", nosql: "tables",
  auth: "shield", xss: "shield", "sql-injection": "shield", "csrf-cors": "shield", ssrf: "shield", secrets: "keys",
  "react-basics": "tree", "react-hooks": "tree", "state-management": "tree", "html-semantics": "tree",
};

const T = {
  en: { lesson: "Lesson", point: "Key idea", of: "of", code: "Here is how it looks in code.", pitfalls: "Common mistakes to avoid.", quiz: "Quick check — pick the right answer.", try: "Now try it yourself in the panel.", outro: "Great work! You finished", next: "Up next", tracks: { start: "Getting started", whatsNew: "What's new — learned by Forge" } },
  uz: { lesson: "Dars", point: "Asosiy g‘oya", of: "/", code: "Kodda bu shunday ko‘rinadi.", pitfalls: "Keng tarqalgan xatolardan saqlaning.", quiz: "Tezkor tekshiruv — to‘g‘ri javobni tanlang.", try: "Endi panelda o‘zingiz sinab ko‘ring.", outro: "Ajoyib! Siz tugatdingiz:", next: "Keyingisi", tracks: { start: "Boshlash", whatsNew: "Yangiliklar — Forge o‘rgangan" } },
  ru: { lesson: "Урок", point: "Ключевая мысль", of: "из", code: "Вот как это выглядит в коде.", pitfalls: "Типичные ошибки, которых стоит избегать.", quiz: "Проверка — выберите правильный ответ.", try: "Теперь попробуйте сами в панели.", outro: "Отлично! Вы прошли урок", next: "Далее", tracks: { start: "Начало работы", whatsNew: "Новое — выучено Forge" } },
};

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}
const secondsFor = (text: string) => Math.max(4, Math.round(text.split(/\s+/).length * 0.42 + 1.5));

export function lessonFromEntry(e: KEntry, lang: Lang, track: string, next?: KEntry): Lesson {
  const t = T[lang];
  const visual = VISUAL[e.id] ?? (e.cat === "panel" ? "keys" : "bullets");
  const scenes: Scene[] = [
    { kind: "title", title: e.title[lang], subtitle: `${t.lesson} · ${CAT_LABEL[e.cat][lang]}`, say: e.title[lang] },
    { kind: "concept", text: e.sum[lang], visual, say: e.sum[lang], sayLang: lang },
    ...e.points.map((p, i): Scene => ({ kind: "point", index: i + 1, total: e.points.length, text: p, visual, say: p })),
  ];
  if (e.example) scenes.push({ kind: "code", lang: e.example.lang, code: e.example.code, say: t.code });
  if (e.pitfalls?.length) scenes.push({ kind: "pitfalls", items: e.pitfalls, say: `${t.pitfalls} ${e.pitfalls.join(" ")}` });
  for (const q of e.quiz ?? []) scenes.push({ kind: "quiz", q, say: `${t.quiz} ${q.q}` });
  const f = e.tryFn ? registry.get(e.tryFn) : undefined;
  if (f) scenes.push({ kind: "try", fn: f.id, label: functionTitle(f), say: t.try });
  scenes.push({ kind: "outro", title: e.title[lang], next: next ? next.title[lang] : null, say: `${t.outro} ${e.title[lang]}.${next ? ` ${t.next}: ${next.title[lang]}.` : ""}` });
  const seconds = scenes.reduce((a, s) => a + (s.kind === "quiz" ? 12 : s.kind === "code" ? 10 : secondsFor(s.say)), 0);
  return { id: e.id, title: e.title[lang], summary: e.sum[lang], track, scenes, seconds, hash: hash(JSON.stringify([e.sum, e.points, e.example, e.quiz, e.tryFn])), entryId: e.id };
}

const TRACK_ORDER: KCat[] = ["panel", "web", "css", "design", "js", "react", "api", "data", "security", "devops", "3d"];

/** Lessons generated from what Forge has learned recently and from functions added to the panel. */
function whatsNew(lang: Lang): Lesson[] {
  const d = brain();
  const out: Lesson[] = [];
  const seenFns = load<string[]>("mfc.academy.knownFns", []);
  const fresh = seenFns.length ? registry.list().filter((f) => !seenFns.includes(f.id) && !f.id.startsWith("copilot.")) : [];
  if (fresh.length) {
    const e: KEntry = {
      id: "new-functions",
      cat: "panel",
      title: { en: `${fresh.length} new panel functions`, uz: `${fresh.length} ta yangi funksiya`, ru: `${fresh.length} новых функций` },
      kw: [],
      sum: { en: "These functions were added since your last visit. Run any of them from the command palette or ask Forge.", uz: "Oxirgi tashrifingizdan beri qo‘shilgan funksiyalar. Ularni palitradan yoki Forge orqali bajaring.", ru: "Эти функции появились с вашего прошлого визита. Запускайте их из палитры или через Forge." },
      points: fresh.slice(0, 8).map((f) => functionTitle(f)),
      tryFn: fresh[0].id,
    };
    out.push(lessonFromEntry(e, lang, "whats-new"));
  }
  const confirmed = d.examples.filter((x) => x.source === "confirm" || x.source === "user").slice(-8);
  if (confirmed.length) {
    const e: KEntry = {
      id: "forge-understands",
      cat: "panel",
      title: { en: "Phrases Forge learned from your team", uz: "Forge jamoangizdan o‘rgangan iboralar", ru: "Фразы, которые Forge выучил у команды" },
      kw: [],
      sum: { en: `Forge now understands ${confirmed.length} more ways of asking for things. Say them and it acts directly.`, uz: `Forge endi so‘rashning yana ${confirmed.length} usulini tushunadi. Ularni ayting — darhol bajaradi.`, ru: `Forge теперь понимает ещё ${confirmed.length} способов попросить. Скажите — и он сразу выполнит.` },
      points: confirmed.map((x) => `“${x.text}” → ${registry.get(x.label) ? functionTitle(registry.get(x.label)!) : x.label}`),
    };
    out.push(lessonFromEntry(e, lang, "whats-new"));
  }
  if (d.bestPalettes.length >= 3) {
    const e: KEntry = {
      id: "forge-palettes",
      cat: "design",
      title: { en: "Palettes Forge discovered by experiment", uz: "Forge tajribada topgan palitralar", ru: "Палитры, найденные Forge в экспериментах" },
      kw: [],
      sum: { en: `Forge ran ${d.totals.experiments} design experiments, auditing contrast and accessibility. These brand colors scored best — new pages use them automatically.`, uz: `Forge ${d.totals.experiments} ta dizayn tajribasini o‘tkazib, kontrast va qulaylikni tekshirdi. Bu ranglar eng yaxshi natija berdi — yangi sahifalar ulardan avtomatik foydalanadi.`, ru: `Forge провёл ${d.totals.experiments} дизайн-экспериментов с проверкой контраста и доступности. Эти цвета показали лучший результат — новые страницы используют их автоматически.` },
      points: d.bestPalettes.slice(0, 5).map((p) => `${p.primary} on a ${p.dark ? "dark" : "light"} page — score ${Math.round(p.score * 100)}/100`),
      related: ["color-contrast"],
    };
    out.push(lessonFromEntry(e, lang, "whats-new"));
  }
  return out;
}

export function buildCourse(lang: Lang): Course {
  syncRegistryKnowledge();
  const tracks: Track[] = [];
  const news = whatsNew(lang);
  if (news.length) tracks.push({ id: "whats-new", title: T[lang].tracks.whatsNew, lessons: news });
  for (const cat of TRACK_ORDER) {
    const entries = KB.filter((e) => e.cat === cat && !e.id.startsWith("fn-"));
    if (!entries.length) continue;
    const fnEntries = cat === "panel" ? KB.filter((e) => e.id.startsWith("fn-")) : [];
    const all = [...entries, ...fnEntries];
    tracks.push({ id: cat, title: cat === "panel" ? T[lang].tracks.start : CAT_LABEL[cat][lang], lessons: all.map((e, i) => lessonFromEntry(e, lang, cat, all[i + 1])) });
  }
  const lessons = tracks.flatMap((t) => t.lessons);
  const d = brain();
  const learned = d.totals.learnedFromTests + d.examples.filter((e) => e.source !== "self").length;
  return {
    version: hash(lessons.map((l) => l.hash).join(".") + registry.size),
    generatedAt: new Date().toISOString(),
    tracks,
    stats: { lessons: lessons.length, minutes: Math.round(lessons.reduce((a, l) => a + l.seconds, 0) / 60), functions: registry.size, topics: KB.length, learned },
  };
}
