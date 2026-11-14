/**
 * Forge's brain: knowledge answers, lessons, quizzes, comparisons, code fixing, and learned intent
 * matching. Pure local computation — no AI model and nothing sent to third parties.
 */
import { registry } from "../../../lib/registry";
import { functionTitle } from "../../../shell/CommandPalette";
import { predict, train, untrain } from "./classifier";
import { fixCode, extractCode } from "./fixer";
import { addEntries, CAT_LABEL, compare, explain, KB, KB_BY_ID, lesson, search, UI_TEXT, type KCat, type KEntry, type Lang } from "./knowledge";
import { useBrain } from "./memory";
import { ensureSeeded } from "./trainer";
import { jaccard, normalize, stems } from "./text";
import type { QuizQ } from "./kb/types";

export interface BrainAction {
  label: string;
  /** Run this panel function when clicked (and learn that `learnText` meant it). */
  fn?: string;
  /** Send this text to Forge when clicked. */
  ask?: string;
  learnText?: string;
}
export interface BrainQuiz {
  topic: string;
  questions: Array<QuizQ & { entry: string }>;
}
export interface BrainReply {
  text: string;
  actions?: BrainAction[];
  quiz?: BrainQuiz;
  /** What to reinforce or unlearn if the user rates this answer. */
  rate?: { text: string; label?: string; entry?: string };
}

// JavaScript's \b only knows ASCII letters, so Uzbek/Russian words need Unicode-aware boundaries.
const W = (alts: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts})`, "iu");
const RX = {
  fix: W("fix|debug|repair|lint|review|what'?s wrong|find (?:the )?bugs?|tuzat|xatoni top|tekshir|исправ|почини|найди ошибк|что не так|проверь код"),
  quiz: W("quiz|test me|exam|check my knowledge|ask me questions|savol ber|sinab ko'r|test qil|викторин|проверь (?:мои )?знани|задай вопрос|тест по"),
  teach: W("teach|lesson|tutorial|course|learn about|i want to learn|guide me|o['‘’]rgat|o['‘’]rganmoqchi|dars|научи|урок|хочу (?:изучить|научиться)|обучи"),
  compare: W("difference between|differences between|vs\\.?(?![\\p{L}])|versus|compare|which is better|farqi|taqqosla|qaysi biri yaxshi|разница|отличие|отличаются|сравни|что лучше"),
  explain: W("what (?:is|are|does)|what's|explain|describe|tell me about|how does|how do .+ work|why (?:is|do|does|should)|meaning of|define|help me understand|i don'?t understand|nima(?![\\p{L}])|tushunmayapman|tushunmadim|tushuntir|haqida|qanday ishlaydi|nega|nima uchun|что такое|объясни|расскажи|как работает|почему|зачем|что значит|не понимаю"),
};

/** Generated knowledge: one entry per function category, rebuilt as the panel gains functions. */
let regSize = -1;
export function syncRegistryKnowledge() {
  if (registry.size === regSize) return;
  regSize = registry.size;
  const byCat = new Map<string, Array<{ id: string; title: string; kw: string[] }>>();
  for (const f of registry.list()) {
    const c = f.category ?? "Other";
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c)!.push({ id: f.id, title: functionTitle(f), kw: f.keywords ?? [] });
  }
  const entries: KEntry[] = [...byCat.entries()].map(([cat, fns]) => {
    const t = `${cat} functions`;
    return {
      id: `fn-${cat.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      cat: "panel" as KCat,
      title: { en: t, uz: `${cat} funksiyalari`, ru: `Функции: ${cat}` },
      kw: [cat.toLowerCase(), ...fns.flatMap((f) => f.kw).slice(0, 30)],
      sum: {
        en: `${fns.length} functions in “${cat}”. Run any of them from the command palette (Ctrl/⌘ K) or ask Forge.`,
        uz: `“${cat}” bo‘limida ${fns.length} ta funksiya. Ularni buyruqlar palitrasidan (Ctrl/⌘ K) yoki Forge orqali bajaring.`,
        ru: `${fns.length} функций в «${cat}». Запускайте их из палитры (Ctrl/⌘ K) или через Forge.`,
      },
      points: fns.slice(0, 12).map((f) => f.title),
      tryFn: fns[0]?.id,
    };
  });
  addEntries(entries);
}

function topicFrom(text: string): string {
  return text
    .replace(RX.teach, " ")
    .replace(RX.quiz, " ")
    .replace(RX.explain, " ")
    .replace(/(?<![\p{L}\p{N}])(?:me|on|about|the|a|an|in|bo'yicha|bo‘yicha|ni|по|про|о|об)(?![\p{L}\p{N}])/giu, " ")
    .trim();
}

function tryAction(e: KEntry, lang: Lang): BrainAction[] {
  const out: BrainAction[] = [];
  const f = e.tryFn && registry.get(e.tryFn);
  if (f) out.push({ label: `▶ ${UI_TEXT[lang].practice}: ${functionTitle(f)}`, fn: f.id });
  for (const id of (e.related ?? []).slice(0, 3)) {
    const r = KB_BY_ID.get(id);
    if (r) out.push({ label: r.title[lang], ask: lang === "uz" ? `${r.title.uz} haqida tushuntir` : lang === "ru" ? `Объясни ${r.title.ru}` : `Explain ${r.title.en}` });
  }
  return out;
}

function quizFor(entries: KEntry[], n = 3): BrainQuiz | undefined {
  const qs = entries.flatMap((e) => (e.quiz ?? []).map((q) => ({ ...q, entry: e.id })));
  if (!qs.length) return undefined;
  const mastery = useBrain.getState().data.mastery;
  // Spaced repetition lite: ask what the learner has seen least or got wrong.
  qs.sort((a, b) => {
    const ma = mastery[a.entry];
    const mb = mastery[b.entry];
    return (ma ? ma.correct / Math.max(1, ma.seen) : -1) - (mb ? mb.correct / Math.max(1, mb.seen) : -1);
  });
  return { topic: entries[0].id, questions: qs.slice(0, n) };
}

const quizIntro = { en: "Quiz time — pick an answer:", uz: "Test vaqti — javobni tanlang:", ru: "Викторина — выберите ответ:" };

/** Knowledge-style requests (explain, teach, quiz, compare, fix). Returns null for everything else. */
export function respond(input: string, lang: Lang, fallback = false): BrainReply | null {
  ensureSeeded();
  syncRegistryKnowledge();
  const b = useBrain.getState();
  const aliases = b.data.aliases;
  const t = UI_TEXT[lang];

  const code = extractCode(input);
  if (code && (RX.fix.test(input) || input.includes("```"))) {
    const r = fixCode(code.code, code.hint);
    b.mutate((d) => void d.totals.fixes++);
    const icon = { error: "⛔", warning: "⚠️", info: "💡" };
    const head = { en: `**${r.lang.toUpperCase()} review:** ${r.issues.filter((i) => i.severity === "error").length} errors · ${r.issues.filter((i) => i.severity === "warning").length} warnings · ${r.issues.filter((i) => i.severity === "info").length} tips`, uz: `**${r.lang.toUpperCase()} tekshiruvi:** ${r.issues.filter((i) => i.severity === "error").length} xato · ${r.issues.filter((i) => i.severity === "warning").length} ogohlantirish · ${r.issues.filter((i) => i.severity === "info").length} maslahat`, ru: `**Проверка ${r.lang.toUpperCase()}:** ${r.issues.filter((i) => i.severity === "error").length} ошибок · ${r.issues.filter((i) => i.severity === "warning").length} предупреждений · ${r.issues.filter((i) => i.severity === "info").length} советов` }[lang];
    const list = r.issues.length ? r.issues.map((i) => `- ${icon[i.severity]} ${i.line ? `L${i.line}: ` : ""}${i.message}${i.fixed ? " ✅" : ""}`).join("\n") : { en: "No problems found. 👍", uz: "Muammo topilmadi. 👍", ru: "Проблем не найдено. 👍" }[lang];
    const fixed = r.changed ? `\n\n**${{ en: "Fixed code", uz: "Tuzatilgan kod", ru: "Исправленный код" }[lang]}**\n\n\`\`\`${r.lang}\n${r.fixed}\n\`\`\`` : "";
    const learn = [...new Set(r.issues.map((i) => i.learn).filter(Boolean) as string[])].map((id) => KB_BY_ID.get(id)).filter(Boolean) as KEntry[];
    return {
      text: `${head}\n\n${list}${fixed}`,
      actions: learn.slice(0, 4).map((e) => ({ label: `📘 ${e.title[lang]}`, ask: lang === "uz" ? `${e.title.uz} bo'yicha dars ber` : lang === "ru" ? `Научи: ${e.title.ru}` : `Teach me ${e.title.en}` })),
      rate: { text: input },
    };
  }

  if (RX.compare.test(input)) {
    const parts = normalize(input).replace(RX.compare, "|").split(/\||(?<![\p{L}])(?:and|va|и|or|yoki|или)(?![\p{L}])|,/u).map((s) => s.trim()).filter((s) => s.length > 1);
    const found = parts.map((p) => search(p, aliases, 1)[0]?.entry).filter(Boolean) as KEntry[];
    const uniq = [...new Map(found.map((e) => [e.id, e])).values()];
    if (uniq.length >= 2) {
      b.mutate((d) => void d.totals.answers++);
      return { text: compare(uniq[0], uniq[1], lang), actions: [...tryAction(uniq[0], lang).slice(0, 1), ...tryAction(uniq[1], lang).slice(0, 1)], rate: { text: input, entry: uniq[0].id } };
    }
  }

  if (RX.quiz.test(input)) {
    const topic = topicFrom(input);
    const cat = (Object.keys(CAT_LABEL) as KCat[]).find((c) => stems(`${CAT_LABEL[c].en} ${CAT_LABEL[c].uz} ${CAT_LABEL[c].ru}`).some((s) => stems(topic).includes(s)));
    const hits = topic ? search(topic, aliases, 4).map((h) => h.entry) : [];
    // A named category ("security", "xavfsizlik") beats loose keyword hits.
    const pool = cat ? KB.filter((e) => e.cat === cat && e.quiz?.length) : hits.length ? hits : KB.filter((e) => e.quiz?.length);
    const quiz = quizFor(pool, 3) ?? quizFor(KB.filter((e) => e.quiz?.length), 3);
    if (quiz) {
      b.mutate((d) => void d.totals.quizzes++);
      return { text: quizIntro[lang], quiz };
    }
  }

  if (RX.teach.test(input)) {
    const hit = search(topicFrom(input) || input, aliases, 1)[0];
    if (hit) {
      b.mutate((d) => void d.totals.lessons++);
      return { text: lesson(hit.entry, lang), quiz: quizFor([hit.entry], 1), actions: tryAction(hit.entry, lang), rate: { text: input, entry: hit.entry.id } };
    }
  }

  if (RX.explain.test(input) || fallback) {
    const hits = search(topicFrom(input) || input, aliases, 3);
    if (fallback && !RX.explain.test(input) && !(hits[0]?.score > 5)) return null;
    if (hits.length && (hits.length === 1 || hits[0].score > hits[1].score * 1.15 || hits[0].score > 6)) {
      b.mutate((d) => void d.totals.answers++);
      return { text: explain(hits[0].entry, lang), actions: tryAction(hits[0].entry, lang), rate: { text: input, entry: hits[0].entry.id } };
    }
    if (hits.length) {
      return { text: t.notSure, actions: hits.map((h) => ({ label: h.entry.title[lang], ask: lang === "uz" ? `${h.entry.title.uz} haqida tushuntir` : lang === "ru" ? `Объясни ${h.entry.title.ru}` : `Explain ${h.entry.title.en}` })) };
    }
    if (RX.explain.test(input) && !fallback) return { text: t.none };
  }
  return null;
}

/** True when the message is clearly a knowledge request (handled before the action planner). */
export function isKnowledgeRequest(input: string): boolean {
  const code = extractCode(input);
  if (code && (RX.fix.test(input) || input.includes("```"))) return true;
  return RX.quiz.test(input) || RX.teach.test(input) || RX.compare.test(input) || RX.explain.test(input);
}

/** Fallback for requests the rule planner couldn't map: learned intent matching. */
export function suggestFunctions(input: string, lang: Lang): BrainReply | null {
  ensureSeeded();
  const d = useBrain.getState().data;
  // A phrasing the user already confirmed → just do it.
  const confirmed = d.examples.filter((e) => e.source === "user" || e.source === "confirm");
  const best = confirmed.map((e) => ({ e, sim: jaccard(stems(e.text), stems(input)) })).sort((a, b) => b.sim - a.sim)[0];
  if (best && best.sim >= 0.8 && registry.get(best.e.label)) return { text: "", actions: [{ label: functionTitle(registry.get(best.e.label)!), fn: best.e.label, learnText: input }], rate: { text: input, label: best.e.label } };
  const preds = predict(d.nb, input, 4).filter((p) => registry.get(p.label));
  if (!preds.length) return null;
  const head = { en: "Did you mean one of these? Tap to run it — I'll remember.", uz: "Shulardan birini nazarda tutdingizmi? Bossangiz bajaraman va eslab qolaman.", ru: "Вы имели в виду одно из этого? Нажмите — выполню и запомню." }[lang];
  return { text: head, actions: preds.map((p) => ({ label: `${functionTitle(registry.get(p.label)!)} · ${Math.round(p.p * 100)}%`, fn: p.label, learnText: input })), rate: { text: input, label: preds[0].label } };
}

/** The user picked a suggestion (or confirmed an action): learn it strongly. */
export function learnConfirmed(text: string, label: string) {
  useBrain.getState().mutate((d) => {
    train(d.nb, text, label, 3);
    d.examples.push({ text, label, source: "confirm", at: new Date().toISOString() });
  });
}

/** 👍 / 👎 on an answer. */
export function rate(r: NonNullable<BrainReply["rate"]>, good: boolean) {
  useBrain.getState().mutate((d) => {
    if (good) d.feedback.up++;
    else d.feedback.down++;
    if (r.label) good ? train(d.nb, r.text, r.label, 2) : untrain(d.nb, r.text, r.label, 2);
    if (r.entry) {
      const al = (d.aliases[r.entry] ??= {});
      for (const s of stems(r.text)) al[s] = Math.max(-2, Math.min(3, (al[s] ?? 0) + (good ? 0.5 : -0.8)));
    }
    if (!good) d.gaps.push({ text: r.text, at: new Date().toISOString() });
  });
}

/** Record a quiz answer for the learner model (drives the Academy's review queue). */
export function recordAnswer(entryId: string, correct: boolean) {
  useBrain.getState().mutate((d) => {
    const m = (d.mastery[entryId] ??= { seen: 0, correct: 0, at: "" });
    m.seen++;
    if (correct) m.correct++;
    m.at = new Date().toISOString();
  });
}

export function noteGap(text: string) {
  useBrain.getState().mutate((d) => void d.gaps.push({ text, at: new Date().toISOString() }));
}

export { KB, KB_BY_ID, CAT_LABEL, search, explain, lesson, fixCode };
export type { KEntry, KCat, Lang };
