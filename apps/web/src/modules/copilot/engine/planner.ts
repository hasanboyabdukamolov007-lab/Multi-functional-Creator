import * as L from "./lexicon";
import type { Lang } from "./lexicon";

/** What the engine knows about the workspace when planning (a plain snapshot, so planning stays pure). */
export interface PlanContext {
  module: string;
  builderOpen: boolean;
  builderSelected: string | null; // node type
  studioOpen: boolean;
  studioSelected: boolean;
  hasRecent3d: boolean;
  functions: Array<{ id: string; title: string; keywords?: string[] }>;
}

export type PageType = "landing" | "portfolio" | "dashboard" | "shop" | "blog" | "pricing" | "contact" | "comingSoon" | "mobile";

export interface PageSpec {
  type: PageType;
  domain: string;
  lang: Lang;
  brand: string | null;
  primary: string | null;
  dark: boolean | null;
  include: string[];
  exclude: string[];
}

export interface ObjectSpec {
  shape: string; // primitive type or "shape-star"…
  count: number;
  color: string | null;
  material: string | null;
}

export type Anim = "spin" | "bounce" | "float" | "pop" | "fade";

export type Action =
  | { kind: "help" }
  | { kind: "status" }
  | { kind: "language"; locale: Lang }
  | { kind: "undo" }
  | { kind: "redo" }
  | { kind: "save" }
  | { kind: "navigate"; module: string }
  | { kind: "page"; spec: PageSpec; newProject: boolean }
  | { kind: "addComponents"; items: Array<{ type: string; count: number }> }
  | { kind: "removeComponents"; types: string[]; selected: boolean }
  | { kind: "style"; target: "selected" | "page" | string[]; style: Record<string, string>; what: string }
  | { kind: "sitePalette"; primary?: string; dark?: boolean }
  | { kind: "panelTheme"; mode?: "dark" | "light"; color?: string }
  | { kind: "scene"; newScene: boolean; objects: ObjectSpec[]; layout: "row" | "circle" | "grid" | "stack"; pedestal: boolean; env: string | null; rig: string | null; anims: Anim[] }
  | { kind: "edit3d"; target: "selected" | "recent" | "all"; color: string | null; material: string | null; anims: Anim[]; scale: number | null; remove: boolean }
  | { kind: "vaultAudit" }
  | { kind: "scan"; text: string }
  | { kind: "export"; format: string }
  | { kind: "function"; id: string; title: string }
  | { kind: "unknown"; suggestions: Array<{ id: string; title: string }> };

export interface Plan {
  lang: Lang;
  actions: Action[];
}

const SCENE_WORDS = ["3d", "scene", "sahna", "сцен", "model", "модел", "render", "рендер"];
const PAGE_WORDS = ["page", "site", "website", "landing", "sahifa", "sayt", "страниц", "сайт", "лендинг", "dashboard", "panel", "панел", "дашборд", "portfolio", "портфолио", "shop", "store", "do'kon", "магазин", "blog", "блог", "app screen", "ilova", "приложен"];
const NEW_PROJECT_WORDS = ["new project", "new site", "new website", "yangi loyiha", "yangi sayt", "новый проект", "новый сайт"];
const SELF_WORDS = ["it$", "this", "that", "selected", "selection", "uni$", "buni", "shuni", "tanlangan", "его$", "её$", "ее$", "это", "этот", "эту", "выделен", "выбранн"];
const ALL_WORDS = ["all$", "every", "everything", "hamma", "barcha", "все$", "всё$", "все", "каждый"];
const THEM_WORDS = ["them", "they", "ularni", "ular", "их$", "они"];
const PEDESTAL = ["pedestal", "podium", "stand", "plinth", "tagkursi", "postament", "постамент", "подиум", "подставк"];
const BACKGROUND = ["background", "backdrop", "fon$", "fonni", "orqa fon", "фон"];
const TEXT_COLOR_WORDS = ["text", "font", "matn", "текст", "шрифт"];
const STOP = new Set(["the", "a", "an", "to", "of", "and", "please", "me", "my", "for", "on", "in", "with", "it", "this", "that", "is", "can", "you", "i", "want", "would", "like", "make", "do", "now", "va", "uchun", "menga", "iltimos", "и", "в", "на", "мне", "пожалуйста", "для", "с", "это"]);

/** Split a request into clauses on strong separators, keeping "and" lists (e.g. "a sphere and a cube") together. */
export function splitClauses(input: string): string[] {
  return input
    .split(/(?:[.!?;]\s+|\n+|\s+(?:and then|then|after that|also|keyin|so'ng|shundan so'ng|затем|потом|после этого|а также)\s+)/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

function detectName(input: string): string | null {
  const q = L.quoted(input);
  if (q) return q;
  const named = /(?:called|named|nomli|под названием|с названием)\s+([^\s,.;]+(?:\s+[A-ZА-Я][^\s,.;]*)?)/i.exec(input);
  if (named) return named[1];
  const forEn = /\bfor\s+([A-Z][\w&'-]*(?:\s+[A-Z][\w&'-]*){0,2})/.exec(input);
  if (forEn) return forEn[1];
  const forRu = /для\s+([A-ZА-Я][^\s,.;]*(?:\s+[A-ZА-Я][^\s,.;]*){0,2})/.exec(input);
  if (forRu) return forRu[1];
  const uz = /([A-Z][\w'’-]*(?:\s+[A-Z][\w'’-]*){0,2})\s+(?:uchun|nomli)/.exec(input);
  if (uz) return uz[1];
  return null;
}

function scanSections(text: string, tokens: string[]): { include: string[]; exclude: string[] } {
  const include: string[] = [];
  const exclude: string[] = [];
  const hits = L.findAll(text, tokens, L.SECTIONS);
  for (const h of hits) {
    // "without pricing" / "pricing-siz" / "без цен": a negation in the two tokens before the section word.
    const before = tokens.slice(Math.max(0, h.index - 2), h.index);
    const self = tokens[h.index] ?? "";
    const negated = before.some((t) => L.INTENT_WORDS.without.some((s) => (s.endsWith("$") ? t === s.slice(0, -1) : t.startsWith(s)))) || /siz$/.test(self);
    (negated ? exclude : include).push(h.key);
  }
  return { include, exclude };
}

/** Every shape mention in order, with the token index where it appears. */
function shapeMentions(tokens: string[]): Array<{ shape: string; index: number }> {
  const out: Array<{ shape: string; index: number }> = [];
  tokens.forEach((tok, i) => {
    if (tok.startsWith("torus") && /^(knot|tugun|узел|узл)/.test(tokens[i + 1] ?? "")) return; // "torus knot" is one shape
    for (const [shape, stems] of Object.entries(L.SHAPES)) {
      if (stems.some((s) => !s.includes(" ") && (s.endsWith("$") ? tok === s.slice(0, -1) : tok.startsWith(s)))) {
        if (shape === "plane" && out.length === 0 && /floor|pol|пол|ground|земл/.test(tok)) continue; // "on the floor" is not an object
        out.push({ shape, index: i });
        break;
      }
    }
  });
  return out;
}

function materialAt(tokens: string[], from: number, to: number): string | null {
  for (let i = from; i <= to; i++) {
    const tok = tokens[i];
    if (!tok) continue;
    for (const [mat, stems] of Object.entries(L.MATERIALS)) if (stems.some((s) => !s.includes(" ") && (s.endsWith("$") ? tok === s.slice(0, -1) : tok.startsWith(s)))) return mat;
  }
  return null;
}

function colorAt(tokens: string[], from: number, to: number, text: string): string | null {
  const hex = /#([0-9a-f]{6}|[0-9a-f]{3})\b/i.exec(text);
  for (let i = from; i <= to; i++) {
    const tok = tokens[i];
    if (!tok) continue;
    for (const [value, stems] of L.COLORS) if (stems.some((s) => !s.includes(" ") && (s.endsWith("$") ? tok === s.slice(0, -1) : tok.startsWith(s)))) return value;
  }
  return hex && from === 0 ? L.colorFrom(text, tokens) : null;
}

function anims(text: string, tokens: string[]): Anim[] {
  const out: Anim[] = [];
  const has = (stems: string[]) => L.hasAny(text, tokens, stems);
  if (has(["spin", "rotate", "turn around", "turntable", "aylan", "вращ", "крути", "поверн"])) out.push("spin");
  if (has(["bounce", "jump", "sakra", "прыг", "подпры"])) out.push("bounce");
  if (has(["float", "hover", "bob", "levitat", "suz", "парит", "левит", "покачив"])) out.push("float");
  if (has(["pop in", "pop-in", "appear", "paydo", "появ"])) out.push("pop");
  if (has(["fade", "xira", "проявл", "исчез"])) out.push("fade");
  return out;
}

function matchFunction(text: string, tokens: string[], fns: PlanContext["functions"]): Array<{ id: string; title: string; score: number }> {
  const words = tokens.filter((t) => !STOP.has(t) && t.length > 1);
  if (!words.length) return [];
  const scored = fns.map((f) => {
    const hay = `${f.title} ${f.id.replace(/[._-]/g, " ")} ${(f.keywords ?? []).join(" ")}`.toLowerCase();
    const titleWords = L.tokenize(f.title).filter((t) => !STOP.has(t));
    let hits = 0;
    for (const w of words) if (hay.includes(w) || (w.length > 4 && hay.includes(w.slice(0, w.length - 1)))) hits++;
    const coverage = titleWords.length ? titleWords.filter((tw) => words.some((w) => tw.startsWith(w) || w.startsWith(tw))).length / titleWords.length : 0;
    return { id: f.id, title: f.title, score: hits * 2 + coverage * 3 - Math.max(0, titleWords.length - words.length) * 0.2 };
  });
  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
}

function planClause(clause: string, ctx: PlanContext, lang: Lang): Action[] {
  const text = L.normalize(clause);
  const tokens = L.tokenize(clause);
  const has = (stems: string[]) => L.hasAny(text, tokens, stems);
  const W = L.INTENT_WORDS;

  if (has(W.help) && tokens.length <= 8) return [{ kind: "help" }];
  if (has(W.status) && tokens.length <= 6) return [{ kind: "status" }];

  const langKey = L.firstKey(text, tokens, L.LANG_NAMES);
  if (langKey && (has(W.language) || has(W.change) || has(W.open))) return [{ kind: "language", locale: langKey as Lang }];
  if (has(W.redo) && tokens.length <= 4) return [{ kind: "redo" }];
  if (has(W.undo) && tokens.length <= 4) return [{ kind: "undo" }];
  if (has(W.save) && tokens.length <= 4) return [{ kind: "save" }];

  if (has(W.scan)) {
    const idx = clause.indexOf(":");
    if (idx >= 0) return [{ kind: "scan", text: clause.slice(idx + 1) }];
  }
  const vaultWords = L.MODULE_WORDS.vault;
  if (has(vaultWords) && has(W.audit)) return [{ kind: "vaultAudit" }];

  const isCreate = has(W.create);
  const isAdd = has(W.add);
  const isRemove = has(W.remove);
  const moduleKey = L.firstKey(text, tokens, L.MODULE_WORDS);
  if (has(W.open) && moduleKey && !isCreate && !isAdd) return [{ kind: "navigate", module: moduleKey }];

  const exportHit = has(W.export);
  if (exportHit) {
    const format = /\breact\b|jsx/.test(text) ? "react" : /\bhtml\b/.test(text) ? "html" : /\bglb\b/.test(text) ? "glb" : /gltf/.test(text) ? "gltf" : /\bobj\b/.test(text) ? "obj" : /\bstl\b/.test(text) ? "stl" : /png|image|rasm|картин/.test(text) ? "png" : /json/.test(text) ? "json" : ctx.module === "studio" ? "glb" : "html";
    return [{ kind: "export", format }];
  }

  const colors = L.colorsAt(text, tokens);
  const mentions = shapeMentions(tokens);
  const material = materialAt(tokens, 0, tokens.length - 1);
  const animList = anims(text, tokens);
  const env = L.firstKey(text, tokens, L.ENVIRONMENTS);
  const rig = L.firstKey(text, tokens, L.LIGHTS);
  const sceneWord = has(SCENE_WORDS);
  const self = has(SELF_WORDS);
  const them = has(THEM_WORDS);
  const all = has(ALL_WORDS);

  // ---------- 3D
  const in3dContext = ctx.module === "studio" || (ctx.studioOpen && !ctx.builderOpen);
  if (mentions.length && (sceneWord || isCreate || isAdd || in3dContext) && !has(PAGE_WORDS.filter((w) => !["model"].includes(w)))) {
    const objects: ObjectSpec[] = mentions.map((m, i) => {
      const prev = i === 0 ? 0 : mentions[i - 1].index + 1;
      // Look ahead ("a sphere in gold") only up to a conjunction, so "a sphere and two red cubes" keeps red on the cubes.
      let next = i === mentions.length - 1 ? tokens.length - 1 : mentions[i + 1].index - 1;
      for (let j = m.index + 1; j <= next; j++) if (["and", "va", "и", "with", "bilan", "с", "plus", "also"].includes(tokens[j])) next = j - 1;
      return {
        shape: m.shape,
        count: L.numberBefore(tokens, m.index),
        color: colorAt(tokens, prev, m.index, text) ?? colorAt(tokens, m.index + 1, next, text),
        material: materialAt(tokens, prev, m.index) ?? materialAt(tokens, m.index + 1, next),
      };
    });
    const layout = has(["circle", "around", "ring of", "aylana", "doira", "круг", "по кругу"]) ? "circle" : has(["grid", "rows", "setka", "сетк"]) ? "grid" : has(["stack", "tower", "on top of each other", "ustma-ust", "минора", "башн", "друг на друг"]) ? "stack" : "row";
    const newScene = !ctx.studioOpen || (isCreate && (sceneWord || has(["new", "yangi", "нов"])));
    return [{ kind: "scene", newScene, objects, layout, pedestal: has(PEDESTAL), env, rig, anims: animList }];
  }
  if (sceneWord && isCreate) {
    return [{ kind: "scene", newScene: true, objects: [], layout: "row", pedestal: has(PEDESTAL), env, rig, anims: animList }];
  }
  if ((ctx.studioOpen && (ctx.module === "studio" || !ctx.builderOpen)) && (material || colors.length || animList.length || env || rig || isRemove || has(W.bigger) || has(W.smaller))) {
    const out: Action[] = [];
    if (env || rig) out.push({ kind: "scene", newScene: false, objects: [], layout: "row", pedestal: false, env, rig, anims: [] });
    if (material || colors.length || animList.length || isRemove || has(W.bigger) || has(W.smaller)) {
      const target = all ? "all" : ctx.studioSelected && !them ? "selected" : ctx.hasRecent3d ? "recent" : "selected";
      out.push({ kind: "edit3d", target, color: colors[0]?.hex ?? null, material, anims: animList, scale: has(W.bigger) ? 1.5 : has(W.smaller) ? 0.66 : null, remove: isRemove });
    }
    if (out.length) return out;
  }

  // ---------- Pages
  const pageTypeKey = L.firstKey(text, tokens, L.PAGE_TYPES) as PageType | null;
  const domainKey = L.firstKey(text, tokens, L.DOMAINS);
  const pageWord = has(PAGE_WORDS);
  if ((isCreate || has(["need", "want", "kerak", "нужен", "нужна", "нужно", "хочу"])) && (pageWord || pageTypeKey || domainKey) && !isAdd) {
    const { include, exclude } = scanSections(text, tokens);
    const type: PageType = pageTypeKey ?? (domainKey === "fashion" ? "shop" : "landing");
    return [
      {
        kind: "page",
        newProject: !ctx.builderOpen || has(NEW_PROJECT_WORDS) || has(["project", "loyiha", "проект"]),
        spec: { type, domain: domainKey ?? (type === "dashboard" ? "saas" : "saas"), lang, brand: detectName(clause), primary: colors[0]?.hex ?? null, dark: has(W.dark) ? true : has(W.light) ? false : null, include, exclude },
      },
    ];
  }

  // ---------- Builder components
  const compHits = L.findAll(text, tokens, L.COMPONENTS);
  if (isAdd && compHits.length) {
    return [{ kind: "addComponents", items: compHits.map((h) => ({ type: h.key, count: L.numberBefore(tokens, h.index) })) }];
  }
  if (isRemove && (compHits.length || self) && ctx.builderOpen) {
    return [{ kind: "removeComponents", types: compHits.map((h) => h.key), selected: self || !compHits.length }];
  }

  // ---------- Themes & palettes
  const themeWord = has(W.theme);
  const paletteWord = has(W.palette);
  const dark = has(W.dark);
  const light = has(W.light) && !has(["lighting", "yorug'lik", "освещ"]);
  if (themeWord || ((dark || light) && !compHits.length && !self && (paletteWord || has(["mode", "rejim", "режим", "site", "sayt", "сайт", "panel", "панел"])))) {
    const forSite = !themeWord && ctx.builderOpen && (ctx.module === "builder" || has(["site", "page", "sayt", "sahifa", "сайт", "страниц"]));
    if (forSite) return [{ kind: "sitePalette", dark: dark ? true : light ? false : undefined, primary: colors[0]?.hex }];
    return [{ kind: "panelTheme", mode: dark ? "dark" : light ? "light" : undefined, color: colors[0]?.hex }];
  }
  if (paletteWord && colors.length) {
    if (ctx.builderOpen) return [{ kind: "sitePalette", primary: colors[0].hex }];
    return [{ kind: "panelTheme", color: colors[0].hex }];
  }

  // ---------- Styling builder elements
  if (ctx.builderOpen) {
    const style: Record<string, string> = {};
    const what: string[] = [];
    const bg = has(BACKGROUND);
    const targetTypes = compHits.map((h) => h.key).filter((k) => k !== "section" || !bg);
    const target: "selected" | "page" | string[] = targetTypes.length ? targetTypes : bg && !self && !ctx.builderSelected ? "page" : "selected";
    if (colors.length) {
      const c = colors[0].hex;
      if (bg || (targetTypes.includes("button") && !has(TEXT_COLOR_WORDS))) {
        style.background = c;
        if (targetTypes.includes("button")) style.color = "#ffffff";
        what.push("background");
      } else {
        style.color = c;
        what.push("color");
      }
    }
    if (has(W.center)) (style.textAlign = "center"), what.push("center");
    else if (has(W.left)) (style.textAlign = "left"), what.push("left");
    else if (has(W.right)) (style.textAlign = "right"), what.push("right");
    if (has(W.bold)) (style.fontWeight = "800"), what.push("bold");
    if (has(W.bigger)) (style.fontSize = "1.4em"), what.push("bigger");
    if (has(W.smaller)) (style.fontSize = ".85em"), what.push("smaller");
    if (has(W.rounded)) (style.borderRadius = "999px"), what.push("rounded");
    if (has(W.shadow)) (style.boxShadow = "var(--shadow-lg)"), what.push("shadow");
    if (has(W.uppercase)) (style.textTransform = "uppercase"), (style.letterSpacing = "0.06em"), what.push("uppercase");
    if (has(W.hide)) (style.display = "none"), what.push("hidden");
    if (has(W.spacing)) (style.padding = has(W.smaller) ? "8px" : "48px 24px"), what.push("spacing");
    if (Object.keys(style).length) {
      if (target === "page" && style.background) return [{ kind: "sitePalette", primary: undefined, dark: undefined }, { kind: "style", target, style, what: what.join(", ") }];
      return [{ kind: "style", target, style, what: what.join(", ") }];
    }
  }

  if (has(W.open) && moduleKey) return [{ kind: "navigate", module: moduleKey }];

  // ---------- Fallback: any registered function
  const ranked = matchFunction(text, tokens, ctx.functions);
  if (ranked[0] && ranked[0].score >= 5 && (!ranked[1] || ranked[0].score - ranked[1].score >= 0.5)) return [{ kind: "function", id: ranked[0].id, title: ranked[0].title }];
  return [{ kind: "unknown", suggestions: ranked.slice(0, 4).map(({ id, title }) => ({ id, title })) }];
}

export function plan(input: string, ctx: PlanContext): Plan {
  const lang = L.detectLang(input);
  const clauses = splitClauses(input);
  const actions: Action[] = [];
  let virtual = { ...ctx };
  for (const c of clauses.length ? clauses : [input]) {
    const acts = planClause(c, virtual, lang);
    actions.push(...acts);
    // Later clauses see the effects of earlier ones ("create a scene with a cube. then make it gold").
    for (const a of acts) {
      if (a.kind === "page") virtual = { ...virtual, builderOpen: true, module: "builder" };
      if (a.kind === "scene" && (a.newScene || a.objects.length)) virtual = { ...virtual, studioOpen: true, module: "studio", hasRecent3d: a.objects.length > 0 || virtual.hasRecent3d };
      if (a.kind === "navigate") virtual = { ...virtual, module: a.module };
    }
  }
  return { lang, actions };
}
