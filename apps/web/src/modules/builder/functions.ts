import { registry, type AppFunction } from "../../lib/registry";
import { downloadText, pickFile, slugify } from "../../lib/download";
import { toast } from "../../lib/ui";
import { scanForLeaks } from "@mfc/core";
import { previewInNewTab, useBuilder, useBuilderUi } from "./store";
import { auditPage, contrastRatio } from "./a11y";
import { CATALOG, CATALOG_MAP, defFor } from "./catalog";
import { TEMPLATES } from "./templates";
import { pageHtml, pageReact, siteCss } from "./exporters";
import { DEFAULT_TOKENS, n, type SiteTokens } from "./model";

const B = () => useBuilder.getState();
const hasProject = () => (B().projectId ? true : "Open a builder project first");
const hasSelection = () => (!B().projectId ? "Open a builder project first" : B().selectedId ? true : "Select an element first");
const hasNonRootSelection = () => {
  const r = hasSelection();
  if (r !== true) return r;
  return B().selected()?.type === "page" ? "Select an element other than the page" : true;
};

function styleFn(id: string, title: string, style: Record<string, string | null>, keywords: string[] = []): AppFunction {
  return {
    id: `builder.style.${id}`,
    title: `Style: ${title}`,
    category: "Builder · Style",
    keywords: ["style", "css", ...keywords],
    when: hasSelection,
    run: () => B().update(B().selectedId!, { style }, `style:${id}`),
  };
}

const PALETTES: Array<[string, string, Partial<SiteTokens>]> = [
  ["indigo", "Indigo", { primary: "#5b4cf0", primaryText: "#ffffff" }],
  ["ocean", "Ocean", { primary: "#0b74de", primaryText: "#ffffff" }],
  ["emerald", "Emerald", { primary: "#059669", primaryText: "#ffffff" }],
  ["sunset", "Sunset", { primary: "#ea580c", primaryText: "#ffffff" }],
  ["rose", "Rose", { primary: "#e11d48", primaryText: "#ffffff" }],
  ["violet", "Violet", { primary: "#7c3aed", primaryText: "#ffffff" }],
  ["graphite", "Graphite", { primary: "#111827", primaryText: "#ffffff" }],
  ["gold", "Gold", { primary: "#b7791f", primaryText: "#ffffff" }],
  ["dark-mode", "Dark mode site", { bg: "#0c0e14", surface: "#151823", text: "#eef0f6", muted: "#9aa1b2", border: "#262b3a" }],
  ["light-mode", "Light mode site", { bg: "#ffffff", surface: "#f6f7fb", text: "#14161f", muted: "#5f6677", border: "#e3e6ee" }],
];
const FONTS: Array<[string, string, string]> = [
  ["system", "System sans", DEFAULT_TOKENS.font],
  ["serif", "Classic serif", `Georgia, "Times New Roman", serif`],
  ["humanist", "Humanist sans", `"Segoe UI", Candara, "Trebuchet MS", sans-serif`],
  ["geometric", "Geometric sans", `"Avenir Next", Avenir, Montserrat, "Century Gothic", sans-serif`],
  ["mono", "Monospace", `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`],
  ["rounded", "Rounded", `ui-rounded, "SF Pro Rounded", "Nunito", "Varela Round", sans-serif`],
];

export function registerBuilderFunctions() {
  const fns: AppFunction[] = [];

  // Insert every component
  for (const c of CATALOG.filter((x) => x.type !== "page")) {
    fns.push({
      id: `builder.insert.${c.type}`,
      title: `Insert ${c.label}`,
      category: "Builder · Insert",
      keywords: ["add", "component", c.category.toLowerCase(), c.type],
      when: hasProject,
      run: () => ({ id: B().insert(c.type).id }),
    });
  }
  // Common variants
  for (let lvl = 1; lvl <= 6; lvl++) fns.push({ id: `builder.insert.heading-h${lvl}`, title: `Insert heading H${lvl}`, category: "Builder · Insert", when: hasProject, run: () => B().insert(n("heading", { ...defFor("heading").defaults, level: lvl })).id });
  for (const v of ["primary", "secondary", "ghost", "danger"]) fns.push({ id: `builder.insert.button-${v}`, title: `Insert ${v} button`, category: "Builder · Insert", when: hasProject, run: () => B().insert(n("button", { ...defFor("button").defaults, variant: v })).id });
  for (const tone of ["info", "success", "warning", "danger"]) fns.push({ id: `builder.insert.alert-${tone}`, title: `Insert ${tone} alert`, category: "Builder · Insert", when: hasProject, run: () => B().insert(n("alert", { ...defFor("alert").defaults, tone })).id });
  for (const tone of ["surface", "primary", "dark"]) fns.push({ id: `builder.insert.section-${tone}`, title: `Insert ${tone} section`, category: "Builder · Insert", when: hasProject, run: () => B().insert(n("section", { tone })).id });

  // Templates
  for (const tp of TEMPLATES) {
    fns.push({
      id: `builder.template.${tp.id}`,
      title: `Template: ${tp.name}`,
      category: "Builder · Templates",
      keywords: ["template", "starter", "page", tp.description],
      run: async (_a, ctx) => {
        if (!B().projectId) {
          const { projectsApi } = await import("../../lib/projects");
          const p = await projectsApi.create(tp.name, tp.id === "admin-dashboard" ? "panel" : tp.id === "mobile-app" ? "app" : "site");
          ctx.navigate(`/builder?project=${p.id}`);
          await B().open(p.id);
        } else if (ctx.module !== "builder") ctx.navigate(`/builder?project=${B().projectId}`);
        const root = B().page().root;
        B().mutate((doc, page) => {
          if (tp.tokens) Object.assign(doc.tokens, tp.tokens);
          page.root.children.push(...tp.build());
        });
        toast(`Inserted "${tp.name}" (${root.children.length ? "appended" : "new page"})`, "success");
      },
    });
  }

  // Editing
  fns.push(
    { id: "builder.undo", title: "Undo", category: "Builder · Edit", shortcut: "mod+z", when: () => (B().projectId && inBuilder() ? (B().past.length ? true : "Nothing to undo") : "Builder not active"), run: () => B().undo() },
    { id: "builder.redo", title: "Redo", category: "Builder · Edit", shortcut: "mod+shift+z", when: () => (B().projectId && inBuilder() ? (B().future.length ? true : "Nothing to redo") : "Builder not active"), run: () => B().redo() },
    { id: "builder.delete", title: "Delete selected element", category: "Builder · Edit", shortcut: "delete", when: () => (inBuilder() ? hasNonRootSelection() : "Builder not active"), run: () => B().remove(B().selectedId!) },
    { id: "builder.duplicate", title: "Duplicate selected element", category: "Builder · Edit", shortcut: "mod+d", when: () => (inBuilder() ? hasNonRootSelection() : "Builder not active"), run: () => B().duplicate(B().selectedId!) },
    { id: "builder.copy", title: "Copy element", category: "Builder · Edit", shortcut: "mod+c", ai: false, when: () => (inBuilder() ? hasNonRootSelection() : "Builder not active"), run: () => B().copy() },
    { id: "builder.cut", title: "Cut element", category: "Builder · Edit", shortcut: "mod+x", ai: false, when: () => (inBuilder() ? hasNonRootSelection() : "Builder not active"), run: () => B().cut() },
    { id: "builder.paste", title: "Paste element", category: "Builder · Edit", shortcut: "mod+v", ai: false, when: () => (inBuilder() && B().clipboard ? true : "Clipboard is empty"), run: () => B().paste() },
    { id: "builder.move-up", title: "Move element up", category: "Builder · Edit", shortcut: "alt+arrowup", when: hasNonRootSelection, run: () => B().move(B().selectedId!, -1) },
    { id: "builder.move-down", title: "Move element down", category: "Builder · Edit", shortcut: "alt+arrowdown", when: hasNonRootSelection, run: () => B().move(B().selectedId!, 1) },
    {
      id: "builder.select-parent",
      title: "Select parent element",
      category: "Builder · Edit",
      shortcut: "esc",
      when: () => (inBuilder() ? hasNonRootSelection() : "Builder not active"),
      run: () => {
        const root = B().page().root;
        const find = (node: typeof root, id: string): string | null => {
          for (const c of node.children) {
            if (c.id === id) return node.id;
            const r = find(c, id);
            if (r) return r;
          }
          return null;
        };
        B().select(find(root, B().selectedId!));
      },
    },
    { id: "builder.deselect", title: "Clear selection", category: "Builder · Edit", when: hasSelection, run: () => B().select(null) },
    { id: "builder.unwrap", title: "Unwrap container (keep children)", category: "Builder · Edit", when: hasNonRootSelection, run: () => B().unwrap(B().selectedId!) },
    { id: "builder.clear-page", title: "Clear current page", category: "Builder · Edit", when: hasProject, run: () => B().mutate((_d, p) => (p.root.children = [])) },
    { id: "builder.reset-style", title: "Reset element styles", category: "Builder · Style", when: hasSelection, run: () => B().update(B().selectedId!, { style: Object.fromEntries(Object.keys(B().selected()!.style).map((k) => [k, null])) }) },
  );
  for (const w of ["row", "column", "section", "box", "container", "grid"]) {
    fns.push({ id: `builder.wrap.${w}`, title: `Wrap selection in ${CATALOG_MAP.get(w)!.label}`, category: "Builder · Edit", when: hasNonRootSelection, run: () => B().wrap(B().selectedId!, w) });
  }

  // Pages
  fns.push(
    { id: "builder.page.new", title: "Add a page", category: "Builder · Pages", params: { type: "object", properties: { name: { type: "string" } } }, when: hasProject, run: (a) => B().addPage(String(a.name ?? "New page")).id },
    { id: "builder.page.delete", title: "Delete current page", category: "Builder · Pages", when: () => (B().doc.pages.length > 1 ? hasProject() : "Only one page"), run: () => B().removePage(B().page().id) },
  );

  // View
  fns.push(
    { id: "builder.view.desktop", title: "Preview: desktop", category: "Builder · View", when: hasProject, run: () => B().setDevice("desktop") },
    { id: "builder.view.tablet", title: "Preview: tablet", category: "Builder · View", when: hasProject, run: () => B().setDevice("tablet") },
    { id: "builder.view.mobile", title: "Preview: mobile", category: "Builder · View", when: hasProject, run: () => B().setDevice("mobile") },
    { id: "builder.view.zoom-in", title: "Zoom in", category: "Builder · View", when: hasProject, run: () => B().setZoom(B().zoom + 0.1) },
    { id: "builder.view.zoom-out", title: "Zoom out", category: "Builder · View", when: hasProject, run: () => B().setZoom(B().zoom - 0.1) },
    { id: "builder.view.zoom-reset", title: "Reset zoom", category: "Builder · View", when: hasProject, run: () => B().setZoom(1) },
    { id: "builder.view.outlines", title: "Toggle container outlines", category: "Builder · View", when: hasProject, run: () => B().toggleOutlines() },
    { id: "builder.view.code", title: "Toggle code editor", category: "Builder · View", shortcut: "mod+e", when: () => (inBuilder() ? hasProject() : "Builder not active"), run: () => B().setCodeOpen(!B().codeOpen) },
  );

  // Export / import / save
  const leakGuard = (content: string) => {
    const f = scanForLeaks(content);
    if (f.length) toast(`Warning: ${f.length} possible hard-coded secret(s) in this export (${f.map((x) => x.title).join(", ")}). Move them to the Secrets Vault.`, "warning");
  };
  fns.push(
    { id: "builder.save", title: "Save project now", category: "Builder · Project", shortcut: "mod+s", when: hasProject, run: () => B().saveNow().then(() => toast("Saved", "success")) },
    { id: "builder.export.html", title: "Export page as HTML", category: "Builder · Export", ai: false, when: hasProject, run: () => { const html = pageHtml(B().doc, B().page()); leakGuard(html); downloadText(`${slugify(B().page().name)}.html`, html, "text/html"); } },
    { id: "builder.export.react", title: "Export page as React component", category: "Builder · Export", ai: false, when: hasProject, run: () => { const jsx = pageReact(B().page()); leakGuard(jsx); downloadText(`${slugify(B().page().name)}.jsx`, jsx); downloadText("site.css", siteCss(B().doc), "text/css"); } },
    { id: "builder.export.css", title: "Export site stylesheet", category: "Builder · Export", ai: false, when: hasProject, run: () => downloadText("site.css", siteCss(B().doc), "text/css") },
    { id: "builder.export.json", title: "Export project document (JSON)", category: "Builder · Export", ai: false, when: hasProject, run: () => downloadText(`${slugify(B().projectName)}.builder.json`, JSON.stringify(B().doc, null, 2), "application/json") },
    {
      id: "builder.import.json",
      title: "Import project document (JSON)",
      category: "Builder · Export",
      ai: false,
      when: hasProject,
      run: async () => {
        const f = await pickFile(".json,application/json");
        if (!f) return;
        B().replaceDoc(JSON.parse(await f.text()));
        toast("Document imported", "success");
      },
    },
    {
      id: "builder.scan-leaks",
      title: "Scan page export for hard-coded secrets",
      category: "Builder · Export",
      keywords: ["security", "secret", "leak"],
      when: hasProject,
      run: () => {
        const f = scanForLeaks(pageHtml(B().doc, B().page()) + "\n" + pageReact(B().page()));
        toast(f.length ? `${f.length} possible secret(s): ${f.map((x) => `${x.title} (line ${x.line})`).join(", ")}` : "No hard-coded secrets found", f.length ? "warning" : "success");
        return f;
      },
    },
  );

  // Site palettes & fonts
  for (const [id, name, tokens] of PALETTES) fns.push({ id: `builder.palette.${id}`, title: `Site palette: ${name}`, category: "Builder · Design tokens", keywords: ["color", "brand", "theme"], when: hasProject, run: () => B().setTokens(tokens) });
  for (const [id, name, font] of FONTS) fns.push({ id: `builder.font.${id}`, title: `Site font: ${name}`, category: "Builder · Design tokens", keywords: ["typography", "font"], when: hasProject, run: () => B().setTokens({ font, headingFont: font }) });
  for (const [id, r] of [["sharp", "2px"], ["soft", "12px"], ["round", "22px"]] as const) fns.push({ id: `builder.radius.${id}`, title: `Site corners: ${id}`, category: "Builder · Design tokens", when: hasProject, run: () => B().setTokens({ radius: r }) });
  fns.push({ id: "builder.tokens.reset", title: "Reset site design tokens", category: "Builder · Design tokens", when: hasProject, run: () => B().setTokens({ ...DEFAULT_TOKENS }) });

  // Style quick actions on the selected element
  for (const a of ["left", "center", "right", "justify"]) fns.push(styleFn(`align-${a}`, `text align ${a}`, { textAlign: a }));
  for (const [k, v] of [["xs", ".75rem"], ["sm", ".875rem"], ["base", "1rem"], ["lg", "1.125rem"], ["xl", "1.25rem"], ["2xl", "1.5rem"], ["3xl", "1.875rem"], ["4xl", "2.25rem"], ["5xl", "3rem"]]) fns.push(styleFn(`text-${k}`, `font size ${k}`, { fontSize: v }, ["font", "size"]));
  for (const w of ["300", "400", "500", "600", "700", "800"]) fns.push(styleFn(`weight-${w}`, `font weight ${w}`, { fontWeight: w }, ["bold", "font"]));
  for (const p of [0, 8, 16, 24, 32, 48, 64]) fns.push(styleFn(`padding-${p}`, `padding ${p}px`, { padding: `${p}px` }));
  for (const m of [0, 8, 16, 24, 32, 48]) fns.push(styleFn(`margin-${m}`, `margin ${m}px`, { margin: `${m}px` }));
  fns.push(styleFn("margin-auto", "center horizontally (margin auto)", { marginLeft: "auto", marginRight: "auto" }));
  for (const g of [0, 8, 16, 24, 32, 48]) fns.push(styleFn(`gap-${g}`, `gap ${g}px`, { gap: `${g}px` }));
  for (const [k, v] of [["none", "0"], ["sm", "4px"], ["md", "8px"], ["lg", "12px"], ["xl", "16px"], ["2xl", "24px"], ["full", "999px"]]) fns.push(styleFn(`radius-${k}`, `corner radius ${k}`, { borderRadius: v }, ["rounded", "corner"]));
  for (const [k, v] of [["none", "none"], ["sm", "var(--shadow-sm)"], ["md", "var(--shadow-md)"], ["lg", "var(--shadow-lg)"], ["xl", "0 30px 80px -20px rgb(0 0 0 / .35)"]]) fns.push(styleFn(`shadow-${k}`, `shadow ${k}`, { boxShadow: v }, ["elevation"]));
  for (const [k, v] of [["transparent", "transparent"], ["page", "var(--color-bg)"], ["surface", "var(--color-surface)"], ["primary", "var(--color-primary)"], ["dark", "#0d0f16"], ["gradient", "linear-gradient(135deg, var(--color-primary), #ff4f9a)"]]) fns.push(styleFn(`bg-${k}`, `background ${k}`, { background: v }, ["background", "color", "fill"]));
  for (const [k, v] of [["default", "var(--color-text)"], ["muted", "var(--color-muted)"], ["primary", "var(--color-primary)"], ["white", "#ffffff"]]) fns.push(styleFn(`color-${k}`, `text color ${k}`, { color: v }, ["color", "text"]));
  for (const [k, v] of [["none", "none"], ["thin", "1px solid var(--color-border)"], ["thick", "2px solid var(--color-border)"], ["primary", "2px solid var(--color-primary)"]]) fns.push(styleFn(`border-${k}`, `border ${k}`, { border: v }));
  for (const [k, v] of [["auto", "auto"], ["full", "100%"], ["3-4", "75%"], ["half", "50%"], ["third", "33.333%"], ["quarter", "25%"], ["fit", "fit-content"]]) fns.push(styleFn(`width-${k}`, `width ${v}`, { width: v }, ["size"]));
  for (const v of ["480px", "640px", "768px", "960px", "1120px", "1280px", "none"]) fns.push(styleFn(`maxw-${v.replace("px", "")}`, `max width ${v}`, { maxWidth: v }, ["size"]));
  fns.push(
    styleFn("flex-row", "flex row", { display: "flex", flexDirection: "row", flexWrap: "wrap" }, ["layout"]),
    styleFn("flex-col", "flex column", { display: "flex", flexDirection: "column" }, ["layout", "stack"]),
    styleFn("grid-2", "grid 2 columns", { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }, ["layout"]),
    styleFn("grid-3", "grid 3 columns", { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }, ["layout"]),
    styleFn("grid-4", "grid 4 columns", { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }, ["layout"]),
    styleFn("block", "display block", { display: "block" }, ["layout"]),
    styleFn("hidden", "hide element", { display: "none" }, ["visibility"]),
  );
  for (const [k, v] of [["start", "flex-start"], ["center", "center"], ["end", "flex-end"], ["between", "space-between"], ["around", "space-around"]]) fns.push(styleFn(`justify-${k}`, `justify ${k}`, { justifyContent: v }, ["layout", "flex"]));
  for (const [k, v] of [["start", "flex-start"], ["center", "center"], ["end", "flex-end"], ["stretch", "stretch"]]) fns.push(styleFn(`items-${k}`, `align items ${k}`, { alignItems: v }, ["layout", "flex"]));
  for (const o of ["100", "75", "50", "25"]) fns.push(styleFn(`opacity-${o}`, `opacity ${o}%`, { opacity: String(Number(o) / 100) }));
  for (const [k, v] of [["none", "0"], ["half", "50vh"], ["screen", "100vh"]]) fns.push(styleFn(`minh-${k}`, `min height ${v}`, { minHeight: v }, ["size", "height"]));
  fns.push(styleFn("sticky-top", "stick to top", { position: "sticky", top: "0", zIndex: "10" }, ["position"]));
  for (const [k, v] of [["tight", "1.15"], ["normal", "1.6"], ["relaxed", "1.85"]]) fns.push(styleFn(`leading-${k}`, `line height ${k}`, { lineHeight: v }, ["typography"]));
  for (const [k, v] of [["tight", "-0.03em"], ["normal", "0"], ["wide", "0.08em"]]) fns.push(styleFn(`tracking-${k}`, `letter spacing ${k}`, { letterSpacing: v }, ["typography"]));
  for (const v of ["none", "uppercase", "capitalize"]) fns.push(styleFn(`case-${v}`, `text transform ${v}`, { textTransform: v }, ["typography"]));
  for (const v of ["hidden", "auto"]) fns.push(styleFn(`overflow-${v}`, `overflow ${v}`, { overflow: v }));

  registry.register(fns);
}

function inBuilder() {
  return window.location.pathname.startsWith("/builder");
}

/** Extra element-level style actions (typography, media, layering). */
export function registerBuilderExtraFunctions() {
  const fns: AppFunction[] = [
    styleFn("italic", "italic", { fontStyle: "italic" }, ["typography"]),
    styleFn("underline", "underline", { textDecoration: "underline" }, ["typography"]),
    styleFn("strike", "strikethrough", { textDecoration: "line-through" }, ["typography"]),
    styleFn("font-serif", "serif font", { fontFamily: `Georgia, "Times New Roman", serif` }, ["typography"]),
    styleFn("font-mono", "monospace font", { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }, ["typography"]),
    styleFn("gradient-text", "gradient text", { background: "linear-gradient(120deg, var(--color-text), var(--color-primary))", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }, ["typography", "color"]),
    styleFn("glass", "frosted glass", { background: "color-mix(in srgb, var(--color-surface) 60%, transparent)", backdropFilter: "blur(14px)", border: "1px solid color-mix(in srgb, var(--color-border) 60%, transparent)" }, ["glassmorphism", "blur"]),
    styleFn("aspect-video", "aspect ratio 16:9", { aspectRatio: "16 / 9" }, ["media", "size"]),
    styleFn("aspect-square", "aspect ratio 1:1", { aspectRatio: "1 / 1" }, ["media", "size"]),
    styleFn("aspect-photo", "aspect ratio 4:3", { aspectRatio: "4 / 3" }, ["media", "size"]),
    styleFn("fit-cover", "image fit cover", { objectFit: "cover" }, ["media", "image"]),
    styleFn("fit-contain", "image fit contain", { objectFit: "contain" }, ["media", "image"]),
    styleFn("cursor-pointer", "pointer cursor", { cursor: "pointer" }),
    styleFn("transition", "smooth transitions", { transition: "all .2s ease" }, ["animation"]),
    styleFn("relative", "position relative", { position: "relative" }, ["position"]),
    styleFn("z-top", "bring to front (z-index)", { position: "relative", zIndex: "10" }, ["layer", "position"]),
    styleFn("full-bleed", "full-bleed width", { width: "100vw", marginLeft: "calc(50% - 50vw)" }, ["layout", "size"]),
  ];
  for (const d of ["next", "previous"] as const) {
    fns.push({
      id: `builder.page.${d}`,
      title: `Go to ${d} page`,
      category: "Builder · Pages",
      when: () => (B().doc.pages.length > 1 ? hasProject() : "Only one page"),
      run: () => {
        const pages = B().doc.pages;
        const i = pages.findIndex((p) => p.id === B().page().id);
        B().setPage(pages[(i + (d === "next" ? 1 : -1) + pages.length) % pages.length].id);
      },
    });
  }
  fns.push(
    { id: "builder.preview", title: "Preview page in a new tab", category: "Builder · View", keywords: ["open", "live", "browser"], ai: false, when: hasProject, run: () => previewInNewTab() },
    {
      id: "builder.a11y-check",
      title: "Check accessibility & SEO",
      category: "Builder · Quality",
      keywords: ["accessibility", "a11y", "wcag", "contrast", "seo", "audit", "check"],
      when: hasProject,
      run: () => {
        useBuilderUi.getState().set({ a11yOpen: true });
        const r = auditPage(B().page(), B().doc.tokens);
        return { score: r.score, issues: r.issues.map((i) => `${i.severity}: ${i.message}`) };
      },
    },
    { id: "builder.page.settings", title: "Page settings & SEO", category: "Builder · Pages", keywords: ["seo", "meta", "title", "description", "og"], when: hasProject, run: () => useBuilderUi.getState().set({ pageSettingsId: B().page().id }) },
    {
      id: "builder.fix-contrast",
      title: "Fix color contrast automatically",
      category: "Builder · Quality",
      keywords: ["accessibility", "contrast", "wcag"],
      when: hasProject,
      run: () => {
        const tk = B().doc.tokens;
        const dark = (contrastRatio(tk.bg, "#000000") ?? 21) < (contrastRatio(tk.bg, "#ffffff") ?? 1);
        const patch: Partial<SiteTokens> = {};
        if ((contrastRatio(tk.text, tk.bg) ?? 21) < 4.5) patch.text = dark ? "#f2f4f8" : "#14161f";
        if ((contrastRatio(tk.muted, tk.bg) ?? 21) < 4.5) patch.muted = dark ? "#a7aec0" : "#555c6e";
        if ((contrastRatio(tk.primaryText, tk.primary) ?? 21) < 4.5) patch.primaryText = (contrastRatio("#ffffff", tk.primary) ?? 0) >= (contrastRatio("#111318", tk.primary) ?? 0) ? "#ffffff" : "#111318";
        B().setTokens(patch);
        return { fixed: Object.keys(patch) };
      },
    },
  );
  fns.push({ id: "builder.select-root", title: "Select page root", category: "Builder · Edit", when: hasProject, run: () => B().select(B().page().root.id) });
  registry.register(fns);
}
