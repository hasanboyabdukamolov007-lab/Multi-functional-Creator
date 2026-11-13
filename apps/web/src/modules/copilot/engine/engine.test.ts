import { describe, expect, it } from "vitest";
import { plan, splitClauses, type PlanContext } from "./planner";
import { generatePage, onColor } from "./pageGen";
import { animationTracks, objectsFromSpecs } from "./sceneGen";
import { detectLang } from "./lexicon";

const ctx = (o: Partial<PlanContext> = {}): PlanContext => ({ module: "home", builderOpen: false, builderSelected: null, studioOpen: false, studioSelected: false, hasRecent3d: false, functions: [], ...o });
const kinds = (input: string, c = ctx()) => plan(input, c).actions.map((a) => a.kind);

describe("language detection", () => {
  it("detects en, uz and ru", () => {
    expect(detectLang("Create a landing page")).toBe("en");
    expect(detectLang("Qahvaxona uchun sayt yarat")).toBe("uz");
    expect(detectLang("Создай сайт для кофейни")).toBe("ru");
  });
});

describe("page planning", () => {
  it("builds a domain-aware landing page with sections and a name (en)", () => {
    const p = plan('Create a landing page for a coffee shop called "Bean There" with pricing and contact, without faq', ctx());
    const a = p.actions[0];
    expect(a.kind).toBe("page");
    if (a.kind !== "page") return;
    expect(a.spec).toMatchObject({ type: "landing", domain: "restaurant", brand: "Bean There", lang: "en" });
    expect(a.spec.include).toEqual(expect.arrayContaining(["pricing", "contact"]));
    expect(a.spec.exclude).toContain("faq");
    expect(a.newProject).toBe(true);
  });

  it("understands Uzbek and Russian page requests", () => {
    const uz = plan("Klinika uchun qorong'i admin panel yarat", ctx()).actions[0];
    expect(uz).toMatchObject({ kind: "page", spec: { type: "dashboard", domain: "clinic", lang: "uz", dark: true } });
    const ru = plan("Создай интернет-магазин одежды в розовых тонах", ctx()).actions[0];
    expect(ru).toMatchObject({ kind: "page", spec: { type: "shop", domain: "fashion", lang: "ru", primary: "#e93d82" } });
  });

  it("generates complete, localized pages", () => {
    const g = generatePage({ type: "landing", domain: "restaurant", lang: "uz", brand: "Choyxona", primary: null, dark: null, include: ["pricing"], exclude: ["faq"] });
    const types = g.nodes.map((n) => n.type);
    expect(types[0]).toBe("navbar");
    expect(types).toEqual(expect.arrayContaining(["hero", "features", "pricing", "contact", "footer"]));
    expect(types).not.toContain("faq");
    expect(JSON.stringify(g.nodes)).toContain("Choyxona");
    expect(JSON.stringify(g.nodes)).toContain("Stol band qilish");
    const dash = generatePage({ type: "dashboard", domain: "saas", lang: "ru", brand: null, primary: "#ffc53d", dark: true, include: [], exclude: [] });
    expect(dash.kind).toBe("panel");
    expect(dash.tokens.primaryText).toBe("#111318"); // dark text on yellow for contrast
  });

  it("picks readable text colors", () => {
    expect(onColor("#ffffff")).toBe("#111318");
    expect(onColor("#1e3a8a")).toBe("#ffffff");
  });
});

describe("3D planning", () => {
  it("parses objects with counts, colors, materials, pedestal, lighting and animation", () => {
    const a = plan("Create a 3D scene with a gold sphere and two red glass cubes on a pedestal, sunset lighting, make them spin", ctx()).actions[0];
    expect(a.kind).toBe("scene");
    if (a.kind !== "scene") return;
    expect(a.newScene).toBe(true);
    expect(a.pedestal).toBe(true);
    expect(a.env).toBe("sunset");
    expect(a.anims).toContain("spin");
    expect(a.objects).toEqual([
      { shape: "sphere", count: 1, color: null, material: "gold" },
      { shape: "box", count: 2, color: "#e5484d", material: "glass" },
    ]);
  });

  it("handles Russian and Uzbek scene requests and the torus knot phrase", () => {
    const ru = plan("Добавь три красные звезды по кругу", ctx({ studioOpen: true, module: "studio" })).actions[0];
    expect(ru).toMatchObject({ kind: "scene", newScene: false, layout: "circle", objects: [{ shape: "shape-star", count: 3, color: "#e5484d" }] });
    const uz = plan("Ikkita ko'k shar qo'sh", ctx({ studioOpen: true, module: "studio" })).actions[0];
    expect(uz).toMatchObject({ kind: "scene", objects: [{ shape: "sphere", count: 2, color: "#0090ff" }] });
    const ruCount = plan("Создай 3D-сцену с золотым шаром и двумя стеклянными кубами", ctx()).actions[0];
    expect(ruCount).toMatchObject({ objects: [{ shape: "sphere", count: 1, material: "gold" }, { shape: "box", count: 2, material: "glass" }] });
    const knot = plan("create a 3d scene with a gold torus knot", ctx()).actions[0];
    expect(knot).toMatchObject({ objects: [{ shape: "torusKnot", material: "gold" }] });
  });

  it("applies follow-up edits to recent objects", () => {
    const a = plan("make them gold and bounce", ctx({ studioOpen: true, module: "studio", hasRecent3d: true })).actions[0];
    expect(a).toMatchObject({ kind: "edit3d", target: "recent", material: "gold", anims: ["bounce"] });
  });

  it("lays out and animates generated objects", () => {
    const objs = objectsFromSpecs([{ shape: "sphere", count: 3, color: null, material: null }], "row", 0.6);
    expect(objs.map((o) => o.position[0])).toEqual([-1.7, 0, 1.7]);
    const tracks = animationTracks(objs, ["spin", "float"], 4);
    expect(tracks.filter((t) => t.property === "rotation")).toHaveLength(3);
    expect(tracks.filter((t) => t.property === "position")).toHaveLength(3);
  });
});

describe("builder edits, panel and fallbacks", () => {
  it("styles named components and the selection", () => {
    const a = plan("make all buttons orange and rounded", ctx({ builderOpen: true, module: "builder" })).actions[0];
    expect(a).toMatchObject({ kind: "style", target: ["button"], style: { background: "#f76b15", color: "#ffffff", borderRadius: "999px" } });
    const b = plan("center it", ctx({ builderOpen: true, module: "builder", builderSelected: "heading" })).actions[0];
    expect(b).toMatchObject({ kind: "style", target: "selected", style: { textAlign: "center" } });
  });

  it("adds components with counts", () => {
    expect(plan("add a faq and two buttons", ctx({ builderOpen: true })).actions[0]).toMatchObject({ kind: "addComponents", items: [{ type: "faq", count: 1 }, { type: "button", count: 2 }] });
  });

  it("handles themes, language, navigation, vault and multi-step requests", () => {
    expect(plan("dark theme", ctx()).actions[0]).toMatchObject({ kind: "panelTheme", mode: "dark" });
    expect(plan("theme from #0f766e", ctx()).actions[0]).toMatchObject({ kind: "panelTheme", color: "#0f766e" });
    expect(plan("Tilni rus tiliga o'zgartir", ctx()).actions[0]).toMatchObject({ kind: "language", locale: "ru" });
    expect(plan("открой хранилище", ctx()).actions[0]).toMatchObject({ kind: "navigate", module: "vault" });
    expect(kinds("audit my vault secrets")).toEqual(["vaultAudit"]);
    expect(splitClauses("create a 3d scene with a cube. then make it gold")).toHaveLength(2);
    expect(kinds("create a 3d scene with a cube. then make it gold")).toEqual(["scene", "edit3d"]);
  });

  it("falls back to registered functions, and admits when it can't help", () => {
    const fns = [{ id: "studio.view.grid", title: "Toggle grid" }, { id: "builder.view.outlines", title: "Toggle container outlines" }];
    expect(plan("toggle grid", ctx({ functions: fns })).actions[0]).toMatchObject({ kind: "function", id: "studio.view.grid" });
    expect(plan("write me a poem about autumn", ctx({ functions: fns })).actions[0].kind).toBe("unknown");
  });
});
