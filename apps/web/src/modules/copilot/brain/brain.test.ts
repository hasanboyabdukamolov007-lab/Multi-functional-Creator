import { describe, expect, it } from "vitest";
import { KB, search, addEntries } from "./knowledge";
import { fixCode, detectLang, extractCode } from "./fixer";
import { emptyNB, predict, train } from "./classifier";
import { paraphrase, experimentRound } from "./trainer";
import { useBrain } from "./memory";
import { rng } from "./text";
import { respond } from "./index";

describe("knowledge retrieval", () => {
  const top1 = (q: string) => search(q, {}, 1)[0]?.entry.id;
  for (const [lang, tpl] of [["en", (t: string) => `what is ${t}`], ["uz", (t: string) => `${t} nima`], ["ru", (t: string) => `что такое ${t}`]] as const) {
    it(`finds the right topic from its title in ${lang} (≥ 95%)`, () => {
      const misses = KB.filter((e) => top1(tpl(e.title[lang])) !== e.id).map((e) => e.id);
      expect(misses.length / KB.length).toBeLessThanOrEqual(0.05);
    });
  }
  it("understands everyday phrasings, inflections and typos", () => {
    expect(top1("how do I center a div with flexbox")).toBe("flexbox");
    expect(top1("flexboxni tushuntir")).toBe("flexbox");
    expect(top1("почему мой сайт медленно грузится")).toBe("web-vitals");
    expect(top1("acessibility for screen readers")).toBe("a11y");
    expect(top1("difference between inner join and left join")).toBe("sql-basics");
    expect(top1("where should I keep my api keys")).toBe("secrets");
  });
});

describe("brain responses", () => {
  it("explains, teaches, quizzes and compares in three languages", () => {
    expect(respond("Explain CSS grid", "en")?.text).toContain("CSS Grid");
    expect(respond("SQL injection haqida tushuntir", "uz")?.text).toContain("SQL");
    expect(respond("Научи меня React hooks", "ru")?.text).toContain("🎓");
    const quiz = respond("quiz me on security", "en");
    expect(quiz?.quiz?.questions.length).toBeGreaterThan(0);
    expect(respond("difference between flexbox and css grid", "en")?.text).toMatch(/Flexbox[\s\S]*CSS Grid|CSS Grid[\s\S]*Flexbox/);
    expect(respond("make the buttons orange", "en")).toBeNull();
  });
});

describe("code doctor", () => {
  it("repairs HTML accessibility and structure", () => {
    const r = fixCode('<html><head><title>x</title></head><body><img src="a.png"><a href="https://x" target="_blank">x</a><div><p>hi</body></html>');
    expect(r.lang).toBe("html");
    expect(r.fixed).toContain('alt=""');
    expect(r.fixed).toContain('rel="noopener noreferrer"');
    expect(r.fixed).toContain('lang="en"');
    expect(r.fixed).toContain("name=\"viewport\"");
    expect(r.issues.some((i) => /not closed/.test(i.message))).toBe(true);
  });
  it("fixes CSS semicolons and braces, flags focus removal", () => {
    const r = fixCode(".btn {\n  color: red\n  padding: 4px;\n  outline: none;\n");
    expect(r.lang).toBe("css");
    expect(r.fixed).toContain("color: red;");
    expect(r.fixed.trim().endsWith("}")).toBe(true);
    expect(r.issues.some((i) => /focus/.test(i.message))).toBe(true);
  });
  it("modernises JS and flags XSS without changing == null", () => {
    const r = fixCode("var a = 1;\nif (a == 2 || b == null) { el.innerHTML = `<p>${name}</p>`; }");
    expect(r.fixed).toContain("let a = 1");
    expect(r.fixed).toContain("a === 2");
    expect(r.fixed).toContain("b == null");
    expect(r.issues.some((i) => i.learn === "xss")).toBe(true);
  });
  it("repairs broken JSON and guards dangerous SQL", () => {
    const j = fixCode("{ name: 'Ada', tags: ['a', 'b',], }");
    expect(JSON.parse(j.fixed)).toEqual({ name: "Ada", tags: ["a", "b"] });
    const s = fixCode("delete from users");
    expect(s.lang).toBe("sql");
    expect(s.issues[0].message).toMatch(/WHERE/);
    expect(s.fixed).toBe("DELETE FROM users;");
    expect(detectLang("SELECT 1")).toBe("sql");
    expect(extractCode("fix this:\n<img src=a>\n<p>x")?.code).toContain("<img");
  });
});

describe("self-training", () => {
  it("measurably improves on unseen paraphrases by learning from its own tests", () => {
    // Realistic, overlapping command titles (like the real registry) so the task isn't trivial.
    const titles = ["Export page as HTML", "Export page as React component", "Export site stylesheet", "Export project document (JSON)", "Export whole site as static HTML (ZIP)", "Export as Next.js project (ZIP)", "Toggle light / dark theme", "Toggle grid", "Toggle container outlines", "Toggle sidebar", "Toggle full screen", "Open the leak scanner", "Open the API tester", "Open the database browser / SQL console", "Open workflow automations", "Open theme editor", "New 3D scene", "New secret", "New workflow", "Add a pricing table", "Add a contact form", "Add a FAQ section", "Duplicate selected element", "Delete selected element", "Move selected element up", "Import .env file into the vault", "Export .env file from the vault", "Show keyboard shortcuts", "Show the welcome tour", "Run a read-only query on a database connection", "Run a workflow now", "Install the app on this device", "Style: rounded corners", "Style: center text", "Style: bold", "Theme: Midnight Pro", "Theme: Daylight", "Language: English", "Language: Uzbek", "Language: Russian"];
    const nb = emptyNB();
    titles.forEach((t, i) => train(nb, t, `f${i}`));
    // Uzbek/Russian commands: the seed only knows English titles, so the verb is new information
    // the classifier must learn from its own generated tests.
    const VERB: Record<string, string[]> = { export: ["yuklab ol", "eksport qil", "скачай", "выгрузи"], toggle: ["almashtir", "переключи"], open: ["och", "открой"], new: ["yangi", "создай новый"], add: ["qo'sh", "добавь"], delete: ["o'chir", "удали"], show: ["ko'rsat", "покажи"], run: ["ishga tushir", "запусти"], duplicate: ["nusxala", "дублируй"], move: ["sur", "передвинь"], import: ["import qil", "импортируй"], install: ["o'rnat", "установи"] };
    const localise = (title: string, r: () => number) => {
      const [first, ...rest] = title.toLowerCase().split(" ");
      const tr = VERB[first];
      return tr ? `${rest.join(" ")} ${tr[Math.floor(r() * tr.length)]}` : paraphrase(title, r);
    };
    const evalSet = (seed: number) => {
      const r = rng(seed);
      return Array.from({ length: 300 }, () => {
        const i = Math.floor(r() * titles.length);
        return { q: localise(paraphrase(titles[i], r), r), label: `f${i}` };
      });
    };
    const acc = (set: Array<{ q: string; label: string }>) => set.filter((x) => predict(nb, x.q, 1)[0]?.label === x.label).length / set.length;
    const test = evalSet(42);
    const before = acc(test);
    for (const ex of evalSet(7)) if (predict(nb, ex.q, 1)[0]?.label !== ex.label) train(nb, ex.q, ex.label, 0.5);
    const after = acc(test);
    expect(after).toBeGreaterThanOrEqual(before);
    expect(after).toBeGreaterThan(0.9);
  });

  it("learns new vocabulary from self-tests: Uzbek verbs that tell Export from Import", () => {
    const objects = ["page as HTML", "site stylesheet", "project document", "vault env file", "brand kit", "monthly report", "user list", "scene model"];
    const nb = emptyNB();
    objects.forEach((o, i) => {
      train(nb, `Export ${o}`, `export-${i}`);
      train(nb, `Import ${o}`, `import-${i}`);
    });
    // Only the verb differs between each pair, and the seed only knows the English verbs.
    const uz = (verb: "export" | "import", o: string, filler: string) => `${filler} ${o}${verb === "export" ? "ni yuklab ber" : "ni yuklab ol"}`;
    const evalSet = objects.flatMap((o, i) => [{ q: uz("export", o, "hozir"), label: `export-${i}` }, { q: uz("import", o, "hozir"), label: `import-${i}` }]);
    const acc = () => evalSet.filter((x) => predict(nb, x.q, 1)[0]?.label === x.label).length / evalSet.length;
    const before = acc();
    // Self-test round: differently-worded generated phrasings; learn from every miss.
    for (const filler of ["iltimos", "menga"])
      objects.forEach((o, i) => {
        for (const verb of ["export", "import"] as const) {
          const q = uz(verb, o, filler);
          const label = `${verb}-${i}`;
          if (predict(nb, q, 1)[0]?.label !== label) train(nb, q, label, 0.5);
        }
      });
    const after = acc();
    expect(before).toBeLessThanOrEqual(0.6);
    expect(after).toBe(1);
  });

  it("design experiments record scored palettes", () => {
    useBrain.getState().reset();
    experimentRound(123, 6);
    const d = useBrain.getState().data;
    expect(d.totals.experiments).toBe(6);
    expect(d.bestPalettes.length).toBeGreaterThan(0);
    expect(d.bestPalettes[0].score).toBeGreaterThan(0);
  });
});

describe("quiz topics", () => {
  it("keeps a named category's quiz on topic", () => {
    const q = respond("quiz me on security", "en")!;
    const security = new Set(KB.filter((e) => e.cat === "security").map((e) => e.id));
    expect(q.quiz!.questions.length).toBeGreaterThan(0);
    expect(q.quiz!.questions.every((x) => security.has(x.entry))).toBe(true);
    const ru = respond("викторина по базам данных", "ru")!;
    expect(ru.quiz!.questions.length).toBeGreaterThan(0);
  });
});

import { buildCourse } from "../../academy/course";
describe("academy course", () => {
  it("generates trilingual tracks and lessons from the knowledge base", () => {
    for (const lang of ["en", "uz", "ru"] as const) {
      const c = buildCourse(lang);
      expect(c.tracks.length).toBeGreaterThanOrEqual(10);
      expect(c.stats.lessons).toBeGreaterThanOrEqual(50);
      const flex = c.tracks.flatMap((t) => t.lessons).find((l) => l.id === "flexbox")!;
      expect(flex.scenes[0].kind).toBe("title");
      expect(flex.scenes.some((s) => s.kind === "quiz")).toBe(true);
      expect(flex.scenes.at(-1)!.kind).toBe("outro");
    }
  });
  it("changes version when knowledge changes (self-updating)", () => {
    const v1 = buildCourse("en").version;
    addEntries([{ id: "zz-test-topic", cat: "web", title: { en: "Test topic", uz: "Test", ru: "Тест" }, kw: ["zz"], sum: { en: "s", uz: "s", ru: "s" }, points: ["p"] }]);
    expect(buildCourse("en").version).not.toBe(v1);
  });
});
