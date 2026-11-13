import { scanForLeaks } from "@mfc/core";
import { getCtx, registry, runFunction } from "../../../lib/registry";
import { useUi } from "../../../lib/ui";
import { useTheme, BUILT_IN_THEMES } from "../../../lib/theme";
import { useI18n } from "../../../lib/i18n";
import { projectsApi } from "../../../lib/projects";
import { MODULES } from "../../index";
import { useBuilder } from "../../builder/store";
import { defFor, isKnownType } from "../../builder/catalog";
import { n, walk, type BNode } from "../../builder/model";
import { useStudio } from "../../studio/store";
import { MATERIAL_PRESETS, makeLight, makePrimitive, DEFAULT_MATERIAL, type SceneObject, type Vec3 } from "../../studio/model";
import { vaultApi } from "../../vault/vaultApi";
import { functionTitle } from "../../../shell/CommandPalette";
import { plan, type Action, type PlanContext } from "./planner";
import { generatePage, onColor } from "./pageGen";
import { animationTracks, objectsFromSpecs } from "./sceneGen";
import type { Lang } from "./lexicon";

export interface StepResult {
  label: string;
  status: "ok" | "error";
  detail?: string;
}
export interface EngineReply {
  text: string;
  steps: StepResult[];
}

/** Short-term memory so follow-ups like "make them gold" refer to what was just created. */
const memory = { recent3d: [] as string[], recentNodes: [] as string[] };

const B = () => useBuilder.getState();
const S = () => useStudio.getState();

const T: Record<Lang, Record<string, string>> = {
  en: {
    done: "Done. Here's what I did:", failed: "Some steps failed:", nothing: "I couldn't map that to an action yet.", tryThese: "Closest matching functions — say “run” plus the name, or click one in the command palette:",
    addon: "For open-ended writing or coding you can optionally enable an AI add-on in Settings → AI copilot. Forge itself never needs one.",
    nextPage: "Next you can say: “make the buttons rounded”, “add a contact form”, “use a dark palette”, or “export html”.",
    nextScene: "Next you can say: “make them gold”, “add sunset lighting”, “make them bounce”, or “export glb”.",
    created: "Created project “{name}”", page: "Built the “{type}” page ({count} sections)", addedPage: "Added page “{name}”", tokens: "Applied the palette and design tokens", inserted: "Inserted {count}× {type}",
    styled: "Styled {count} element(s): {what}", removed: "Removed {count} element(s)", palette: "Updated the site palette", theme: "Applied panel theme “{name}”", scene: "Created a new 3D scene", objects: "Added {count} object(s)", pedestal: "Added a pedestal",
    env: "Environment: {env}", rig: "Lighting rig: {rig}", anim: "Animated {count} object(s): {anims}", material: "Updated {count} object(s)", deleted3d: "Deleted {count} object(s)", nav: "Opened {module}", lang: "Language: {lang}",
    undo: "Undid the last change", redo: "Redid the change", save: "Saved", export: "Exported {format}", ran: "Ran “{title}”", audit: "Checked the vault", scan: "Scanned the text",
    noSelection: "Select an element first (or name it, e.g. “make the buttons blue”).", noBuilder: "Open a builder project first, or ask me to create a page.", noStudio: "Open a 3D scene first, or ask me to create one.",
    vaultOk: "All {total} secrets are healthy.", vaultIssues: "{count} of {total} secrets need attention:", scanClean: "No hard-coded secrets found.", scanHits: "Found {count} possible secret(s):",
    status: "Module: {module}. Builder: {builder}. 3D: {studio}.", none: "none",
    help: `**Forge works on its own — no AI model, no API key.** I understand English, O‘zbekcha and Русский. Try:

**Pages & apps**
- “Create a landing page for a coffee shop called "Bean There" with pricing and contact”
- “Build an admin dashboard for my clinic in dark mode”
- “Make a portfolio page”, “Create an online store for clothing”
- “Add a FAQ and two buttons”, “Make the buttons rounded and orange”, “Center the heading”

**3D**
- “Create a 3D scene with a gold sphere and two glass cubes on a pedestal, sunset lighting, make them spin”
- “Add three red stars in a circle”, “Make them bounce”, “Make it bigger”

**Panel**
- “Dark theme”, “Theme from #0f766e”, “Switch language to Russian”, “Open the vault”
- “Audit my secrets”, “Scan: const key = 'sk_live_…'”, “Export html”, “Undo”
- Anything in the command palette — e.g. “add gold material”, “view top”, “toggle grid”`,
  },
  uz: {
    done: "Tayyor. Nimalar qilindi:", failed: "Ba’zi qadamlar bajarilmadi:", nothing: "Bu so‘rovni hali amalga aylantira olmadim.", tryThese: "Eng mos funksiyalar — nomini yozing yoki buyruqlar palitrasidan tanlang:",
    addon: "Erkin matn yoki kod yozish uchun Sozlamalar → AI yordamchida ixtiyoriy AI qo‘shimchasini yoqishingiz mumkin. Forge’ning o‘ziga u kerak emas.",
    nextPage: "Keyin shunday deyishingiz mumkin: “tugmalarni yumaloq qil”, “aloqa formasini qo‘sh”, “qorong‘i rang”, “html eksport”.",
    nextScene: "Keyin: “ularni oltin qil”, “quyosh botishi yorug‘ligi”, “ularni sakrat”, “glb eksport”.",
    created: "“{name}” loyihasi yaratildi", page: "“{type}” sahifasi qurildi ({count} bo‘lim)", addedPage: "“{name}” sahifasi qo‘shildi", tokens: "Ranglar va dizayn tokenlari qo‘llandi", inserted: "{count}× {type} qo‘shildi",
    styled: "{count} ta element uslubi o‘zgartirildi: {what}", removed: "{count} ta element o‘chirildi", palette: "Sayt ranglari yangilandi", theme: "“{name}” mavzusi qo‘llandi", scene: "Yangi 3D sahna yaratildi", objects: "{count} ta obyekt qo‘shildi", pedestal: "Tagkursi qo‘shildi",
    env: "Muhit: {env}", rig: "Yorug‘lik: {rig}", anim: "{count} ta obyekt jonlantirildi: {anims}", material: "{count} ta obyekt yangilandi", deleted3d: "{count} ta obyekt o‘chirildi", nav: "{module} ochildi", lang: "Til: {lang}",
    undo: "Oxirgi o‘zgarish bekor qilindi", redo: "O‘zgarish qaytarildi", save: "Saqlandi", export: "{format} eksport qilindi", ran: "“{title}” bajarildi", audit: "Ombor tekshirildi", scan: "Matn tekshirildi",
    noSelection: "Avval elementni tanlang (yoki nomini ayting, masalan “tugmalarni ko‘k qil”).", noBuilder: "Avval konstruktor loyihasini oching yoki sahifa yaratishni so‘rang.", noStudio: "Avval 3D sahnani oching yoki yaratishni so‘rang.",
    vaultOk: "Barcha {total} ta maxfiy kalit joyida.", vaultIssues: "{total} tadan {count} tasiga e’tibor kerak:", scanClean: "Kodga yozilgan maxfiy kalitlar topilmadi.", scanHits: "{count} ta ehtimoliy maxfiy kalit topildi:",
    status: "Bo‘lim: {module}. Konstruktor: {builder}. 3D: {studio}.", none: "yo‘q",
    help: `**Forge mustaqil ishlaydi — AI modeli ham, API kalit ham kerak emas.** O‘zbekcha, English va Русский tushunaman. Masalan:

**Sahifalar**
- “Bean There nomli qahvaxona uchun narxlar va aloqa bilan sayt yarat”
- “Klinikam uchun qorong‘i rejimda admin panel yarat”
- “FAQ va ikkita tugma qo‘sh”, “Tugmalarni yumaloq va to‘q sariq qil”, “Sarlavhani o‘rtaga qo‘y”

**3D**
- “Tagkursida oltin shar va ikkita shisha kub bilan 3D sahna yarat, quyosh botishi, aylantir”
- “Aylana bo‘ylab uchta qizil yulduz qo‘sh”, “Ularni sakrat”

**Panel**
- “Qorong‘i mavzu”, “Tilni rus tiliga o‘zgartir”, “Omborni och”, “Maxfiy kalitlarni tekshir”, “html eksport”, “Orqaga qaytar”`,
  },
  ru: {
    done: "Готово. Что я сделал:", failed: "Некоторые шаги не выполнены:", nothing: "Пока не получилось превратить это в действие.", tryThese: "Ближайшие функции — назовите одну или выберите в палитре команд:",
    addon: "Для свободного текста или кода можно по желанию включить ИИ-дополнение в Настройки → ИИ-ассистент. Самому Forge оно не нужно.",
    nextPage: "Дальше можно сказать: «сделай кнопки круглыми», «добавь форму контактов», «тёмная палитра», «экспорт html».",
    nextScene: "Дальше: «сделай их золотыми», «закатное освещение», «пусть прыгают», «экспорт glb».",
    created: "Создан проект «{name}»", page: "Собрана страница «{type}» ({count} секций)", addedPage: "Добавлена страница «{name}»", tokens: "Применены палитра и токены дизайна", inserted: "Добавлено: {count}× {type}",
    styled: "Изменён стиль {count} элемент(ов): {what}", removed: "Удалено элементов: {count}", palette: "Обновлена палитра сайта", theme: "Применена тема «{name}»", scene: "Создана новая 3D-сцена", objects: "Добавлено объектов: {count}", pedestal: "Добавлен постамент",
    env: "Окружение: {env}", rig: "Освещение: {rig}", anim: "Анимировано объектов: {count} ({anims})", material: "Обновлено объектов: {count}", deleted3d: "Удалено объектов: {count}", nav: "Открыт раздел {module}", lang: "Язык: {lang}",
    undo: "Последнее изменение отменено", redo: "Изменение возвращено", save: "Сохранено", export: "Экспорт {format}", ran: "Выполнено: «{title}»", audit: "Хранилище проверено", scan: "Текст проверен",
    noSelection: "Сначала выберите элемент (или назовите его, например «сделай кнопки синими»).", noBuilder: "Сначала откройте проект в конструкторе или попросите создать страницу.", noStudio: "Сначала откройте 3D-сцену или попросите создать её.",
    vaultOk: "Все {total} секретов в порядке.", vaultIssues: "Требуют внимания {count} из {total}:", scanClean: "Захардкоженных секретов не найдено.", scanHits: "Найдено возможных секретов: {count}",
    status: "Раздел: {module}. Конструктор: {builder}. 3D: {studio}.", none: "нет",
    help: `**Forge работает сам — без ИИ-модели и API-ключа.** Понимаю Русский, English и O‘zbekcha. Например:

**Страницы**
- «Создай лендинг для кофейни "Bean There" с ценами и контактами»
- «Сделай админ-панель для клиники в тёмной теме»
- «Добавь FAQ и две кнопки», «Сделай кнопки круглыми и оранжевыми», «Заголовок по центру»

**3D**
- «Создай 3D-сцену с золотым шаром и двумя стеклянными кубами на постаменте, закат, пусть вращаются»
- «Добавь три красные звезды по кругу», «Пусть прыгают»

**Панель**
- «Тёмная тема», «Переключи язык на английский», «Открой хранилище», «Проверь секреты», «Экспорт html», «Отмени»`,
  },
};

const fmt = (s: string, v: Record<string, string | number> = {}) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ""));

function snapshot(): PlanContext {
  const b = B();
  const s = S();
  return {
    module: useUi.getState().module,
    builderOpen: !!b.projectId,
    builderSelected: b.selected()?.type ?? null,
    studioOpen: !!s.projectId,
    studioSelected: !!s.selectedId,
    hasRecent3d: memory.recent3d.some((id) => s.doc.objects.some((o) => o.id === id)),
    // Copilot shortcuts would only loop back into Forge, so they aren't offered as matches.
    functions: registry.list().filter((f) => !f.id.startsWith("copilot.")).map((f) => ({ id: f.id, title: functionTitle(f), keywords: f.keywords })),
  };
}

async function openBuilderProject(name: string, kind: "site" | "panel" | "app") {
  const p = await projectsApi.create(name, kind);
  getCtx().navigate(`/builder?project=${p.id}`);
  await B().open(p.id);
}

async function openScene(name: string) {
  const p = await projectsApi.create(name, "scene3d");
  getCtx().navigate(`/studio?project=${p.id}`);
  await S().open(p.id);
}

function nodesOfTypes(types: string[]): BNode[] {
  const out: BNode[] = [];
  walk(B().page().root, (node) => {
    if (types.includes(node.type) || (types.includes("heading") && node.type === "hero")) out.push(node);
  });
  return out;
}

function targets3d(target: "selected" | "recent" | "all"): SceneObject[] {
  const objs = S().doc.objects;
  if (target === "all") return objs.filter((o) => o.kind === "mesh" && o.name !== "Floor");
  if (target === "recent") {
    const r = objs.filter((o) => memory.recent3d.includes(o.id));
    if (r.length) return r;
  }
  const sel = S().selected();
  return sel ? [sel] : [];
}

async function execute(a: Action, lang: Lang, steps: StepResult[], notes: string[]) {
  const t = T[lang];
  const ok = (label: string, detail?: string) => steps.push({ label, status: "ok", detail });
  const fail = (label: string, detail: string) => steps.push({ label, status: "error", detail });

  switch (a.kind) {
    case "help":
      notes.push(t.help);
      return;
    case "status": {
      const b = B();
      const s = S();
      notes.push(fmt(t.status, { module: useUi.getState().module, builder: b.projectId ? `“${b.projectName}”` : t.none, studio: s.projectId ? `“${s.projectName}” (${s.doc.objects.length})` : t.none }));
      return;
    }
    case "language":
      useI18n.getState().setLocale(a.locale);
      ok(fmt(t.lang, { lang: a.locale }));
      return;
    case "undo":
    case "redo": {
      const studio = useUi.getState().module === "studio";
      const st = studio ? S() : B();
      if (a.kind === "undo") st.undo();
      else st.redo();
      ok(a.kind === "undo" ? t.undo : t.redo);
      return;
    }
    case "save":
      if (useUi.getState().module === "studio") await S().saveNow();
      else await B().saveNow();
      ok(t.save);
      return;
    case "navigate": {
      const m = MODULES.find((x) => x.id === a.module);
      if (!m) return;
      getCtx().navigate(m.path);
      ok(fmt(t.nav, { module: m.id }));
      return;
    }
    case "page": {
      const g = generatePage(a.spec);
      if (a.newProject || !B().projectId) {
        await openBuilderProject(g.name, g.kind);
        ok(fmt(t.created, { name: g.name }));
      } else if (B().page().root.children.length) {
        if (useUi.getState().module !== "builder") getCtx().navigate(`/builder?project=${B().projectId}`);
        B().addPage(g.brand);
        ok(fmt(t.addedPage, { name: g.brand }));
      }
      B().mutate((doc, page) => {
        Object.assign(doc.tokens, g.tokens);
        page.title = g.title;
        page.root.children = g.nodes;
      });
      memory.recentNodes = g.nodes.map((x) => x.id);
      ok(fmt(t.page, { type: a.spec.type, count: g.nodes.length }), `${a.spec.domain} · ${a.spec.lang}`);
      ok(t.tokens, `${g.tokens.primary} · ${g.tokens.bg}`);
      notes.push(t.nextPage);
      return;
    }
    case "addComponents": {
      if (!B().projectId) return fail(t.noBuilder, "");
      const ids: string[] = [];
      for (const item of a.items) {
        if (!isKnownType(item.type)) continue;
        for (let i = 0; i < Math.min(item.count, 12); i++) ids.push(B().insert(n(item.type, structuredClone(defFor(item.type).defaults))).id);
        ok(fmt(t.inserted, { count: Math.min(item.count, 12), type: defFor(item.type).label }));
      }
      memory.recentNodes = ids;
      return;
    }
    case "removeComponents": {
      if (!B().projectId) return fail(t.noBuilder, "");
      const victims = a.selected ? (B().selected() && B().selected()!.type !== "page" ? [B().selected()!] : []) : nodesOfTypes(a.types).filter((x) => x.type !== "page");
      if (!victims.length) return fail(t.noSelection, "");
      for (const v of victims) B().remove(v.id);
      ok(fmt(t.removed, { count: victims.length }));
      return;
    }
    case "style": {
      if (!B().projectId) return fail(t.noBuilder, "");
      let nodes: BNode[];
      if (a.target === "selected") {
        const sel = B().selected();
        nodes = sel ? [sel] : [];
      } else if (a.target === "page") nodes = [B().page().root];
      else nodes = nodesOfTypes(a.target);
      // Buttons inside sections (navbar, hero, pricing…) aren't separate elements: restyle them site-wide via tokens.
      if (Array.isArray(a.target) && a.target.includes("button")) {
        const tokenPatch: Record<string, string> = {};
        if (a.style.background) Object.assign(tokenPatch, { primary: a.style.background, primaryText: onColor(a.style.background) });
        if (a.style.borderRadius) tokenPatch.buttonRadius = a.style.borderRadius;
        if (Object.keys(tokenPatch).length) {
          B().setTokens(tokenPatch);
          ok(t.palette, Object.values(tokenPatch).join(" · "));
          if (!nodes.length) return;
        }
      }
      if (!nodes.length) return fail(t.noSelection, "");
      for (const node of nodes) B().update(node.id, { style: a.style }, `forge:${node.id}`);
      ok(fmt(t.styled, { count: nodes.length, what: a.what }));
      return;
    }
    case "sitePalette": {
      if (!B().projectId) return fail(t.noBuilder, "");
      const patch: Record<string, string> = {};
      if (a.primary) Object.assign(patch, { primary: a.primary, primaryText: onColor(a.primary) });
      if (a.dark === true) Object.assign(patch, { bg: "#0c0e14", surface: "#151823", text: "#eef0f6", muted: "#9aa1b2", border: "#262b3a" });
      if (a.dark === false) Object.assign(patch, { bg: "#ffffff", surface: "#f6f7fb", text: "#14161f", muted: "#5f6677", border: "#e3e6ee" });
      if (!Object.keys(patch).length) return;
      B().setTokens(patch);
      ok(t.palette, Object.values(patch).slice(0, 3).join(" · "));
      return;
    }
    case "panelTheme": {
      const th = useTheme.getState();
      if (a.color) {
        const base = (a.mode === "light" ? BUILT_IN_THEMES[1] : a.mode === "dark" ? BUILT_IN_THEMES[0] : th.active()).tokens;
        const created = th.saveCustom(`Forge ${a.color}`, { ...base, accent: a.color, accentText: onColor(a.color) });
        ok(fmt(t.theme, { name: created.name }));
      } else {
        const target = a.mode === "light" ? BUILT_IN_THEMES[1] : BUILT_IN_THEMES[0];
        th.setActive(a.mode ? target.id : th.active().tokens.scheme === "dark" ? BUILT_IN_THEMES[1].id : BUILT_IN_THEMES[0].id);
        ok(fmt(t.theme, { name: useTheme.getState().active().name }));
      }
      return;
    }
    case "scene": {
      let created = false;
      if (a.newScene || !S().projectId) {
        await openScene(a.objects[0] ? `${a.objects[0].shape.replace("shape-", "")} scene` : "New scene");
        created = true;
        // Replace the starter cube with what was asked for.
        if (a.objects.length) {
          const cube = S().doc.objects.find((o) => o.name === "Cube");
          if (cube) S().remove(cube.id);
        }
        ok(t.scene);
      } else if (useUi.getState().module !== "studio") getCtx().navigate(`/studio?project=${S().projectId}`);
      let baseY = 0.6;
      if (a.pedestal) {
        const ped = makePrimitive("cylinder", { name: "Pedestal", geometry: { kind: "primitive", type: "cylinder", params: { radiusTop: 1.4, radiusBottom: 1.5, height: 0.4, radialSegments: 64 }, subdivision: 0 }, position: [0, 0.2, 0], material: { ...DEFAULT_MATERIAL, ...MATERIAL_PRESETS.ceramic.m, color: "#ece8e1" } });
        S().add(ped, false);
        baseY = 1.05;
        ok(t.pedestal);
      }
      if (a.objects.length) {
        const objs = objectsFromSpecs(a.objects, a.layout, baseY);
        S().addMany(objs);
        memory.recent3d = objs.map((o) => o.id);
        S().select(objs[0].id);
        ok(fmt(t.objects, { count: objs.length }), objs.map((o) => o.name).join(", "));
        if (a.anims.length) {
          const duration = S().doc.settings.duration || 5;
          for (const tr of animationTracks(objs, a.anims, duration)) S().setKeyframes(tr.objectId, tr.property, tr.keyframes);
          S().setTime(0);
          S().setPlaying(true);
          ok(fmt(t.anim, { count: objs.length, anims: a.anims.join(", ") }));
        }
      }
      if (a.env) {
        S().setSettings({ environment: a.env as never, ...(a.env === "night" ? { background: "#05070f" } : a.env === "sunset" ? { background: "#2a1424" } : {}) });
        ok(fmt(t.env, { env: a.env }));
      }
      if (a.rig) {
        const id = a.rig === "three-point" ? "studio.rig.three-point" : a.rig === "softbox" ? "studio.rig.softbox" : a.rig === "sunset" ? "studio.rig.sunset" : null;
        if (id) await runFunction(id);
        else S().add(makeLight(a.rig === "spot" ? "spot" : "point"), false);
        ok(fmt(t.rig, { rig: a.rig }));
      }
      if (created || a.objects.length) S().requestCamera({ frameSelected: false, position: [5, 4, 7], target: [0, 0.8, 0] });
      if (a.objects.length) notes.push(t.nextScene);
      return;
    }
    case "edit3d": {
      if (!S().projectId) return fail(t.noStudio, "");
      const objs = targets3d(a.target);
      if (!objs.length) return fail(t.noSelection, "");
      if (a.remove) {
        for (const o of objs) S().remove(o.id);
        ok(fmt(t.deleted3d, { count: objs.length }));
        return;
      }
      if (a.color || a.material || a.scale) {
        for (const o of objs) {
          const patch: Partial<SceneObject> = {};
          if (o.material && (a.color || a.material)) patch.material = { ...o.material, ...(a.material ? MATERIAL_PRESETS[a.material]?.m : {}), ...(a.color ? { color: a.color } : {}) };
          if (a.scale) patch.scale = o.scale.map((v) => Math.round(v * a.scale! * 1000) / 1000) as Vec3;
          S().update(o.id, patch);
        }
        ok(fmt(t.material, { count: objs.length }), [a.material, a.color, a.scale ? `×${a.scale}` : ""].filter(Boolean).join(" · "));
      }
      if (a.anims.length) {
        const duration = S().doc.settings.duration || 5;
        const fresh = objs.map((o) => S().doc.objects.find((x) => x.id === o.id)!).filter(Boolean);
        for (const tr of animationTracks(fresh, a.anims, duration)) S().setKeyframes(tr.objectId, tr.property, tr.keyframes);
        S().setTime(0);
        S().setPlaying(true);
        ok(fmt(t.anim, { count: objs.length, anims: a.anims.join(", ") }));
      }
      memory.recent3d = objs.map((o) => o.id);
      return;
    }
    case "vaultAudit": {
      const list = await vaultApi.list();
      const bad = list.filter((s) => s.status !== "ok");
      ok(t.audit);
      notes.push(bad.length ? `${fmt(t.vaultIssues, { count: bad.length, total: list.length })}\n${bad.map((s) => `- \`${s.name}\` (${s.environment}) — **${s.status}**${s.expires_at ? `, ${new Date(s.expires_at).toLocaleDateString()}` : ""}`).join("\n")}` : fmt(t.vaultOk, { total: list.length }));
      return;
    }
    case "scan": {
      const hits = scanForLeaks(a.text);
      ok(t.scan);
      notes.push(hits.length ? `${fmt(t.scanHits, { count: hits.length })}\n${hits.map((h) => `- L${h.line}: ${h.title} — \`${h.preview}\``).join("\n")}` : t.scanClean);
      return;
    }
    case "export": {
      const id = { html: "builder.export.html", react: "builder.export.react", glb: "studio.export.glb", gltf: "studio.export.gltf", obj: "studio.export.obj", stl: "studio.export.stl", png: "studio.export.png", json: useUi.getState().module === "studio" ? "studio.export.json" : "builder.export.json" }[a.format] ?? "builder.export.html";
      await runFunction(id);
      ok(fmt(t.export, { format: a.format.toUpperCase() }));
      return;
    }
    case "function":
      try {
        const res = await runFunction(a.id);
        ok(fmt(t.ran, { title: a.title }), res !== undefined && res !== null ? JSON.stringify(res).slice(0, 160) : undefined);
      } catch (e) {
        fail(fmt(t.ran, { title: a.title }), (e as Error).message);
      }
      return;
    case "unknown":
      notes.push(t.nothing);
      if (a.suggestions.length) notes.push(`${t.tryThese}\n${a.suggestions.map((s) => `- ${s.title} — \`${s.id}\``).join("\n")}`);
      notes.push(t.addon);
      return;
  }
}

/** Run one user message through Forge: plan, execute every step, and compose a reply. */
export async function runForge(input: string, onStep?: (steps: StepResult[]) => void): Promise<EngineReply> {
  const p = plan(input, snapshot());
  const steps: StepResult[] = [];
  const notes: string[] = [];
  for (const a of p.actions) {
    const before = steps.length;
    try {
      await execute(a, p.lang, steps, notes);
    } catch (e) {
      steps.push({ label: a.kind, status: "error", detail: (e as Error).message });
    }
    if (steps.length !== before) onStep?.([...steps]);
  }
  const t = T[p.lang];
  const failed = steps.filter((s) => s.status === "error");
  const parts: string[] = [];
  if (steps.length) parts.push(failed.length === steps.length ? t.failed : t.done);
  parts.push(...notes);
  return { text: parts.join("\n\n"), steps };
}

export { plan };
