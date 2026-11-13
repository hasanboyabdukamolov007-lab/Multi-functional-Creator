import type { BNode } from "./model";
import { h, lines, parts, SLOT, type Child, type Spec } from "./spec";
import { PLACEHOLDER_IMG, SITE_ICONS } from "./icons";

export type PropKind = "text" | "textarea" | "lines" | "number" | "select" | "boolean" | "color" | "url" | "code";
export interface PropField {
  key: string;
  label: string;
  kind: PropKind;
  options?: string[];
  hint?: string;
}

export interface ComponentDef {
  type: string;
  label: string;
  category: "Layout" | "Typography" | "Media" | "Forms" | "Data" | "Navigation" | "Sections" | "Feedback" | "Advanced";
  description: string;
  /** Accepts child nodes (has a SLOT in its spec). */
  container?: boolean;
  /** Prop edited by double-clicking the element on the canvas. */
  textProp?: string;
  defaults: Record<string, unknown>;
  fields: PropField[];
  render: (p: Record<string, any>, node: BNode) => Spec;
}

const F = {
  text: (key: string, label = key): PropField => ({ key, label, kind: "text" }),
  area: (key: string, label = key): PropField => ({ key, label, kind: "textarea" }),
  lines: (key: string, label: string, hint: string): PropField => ({ key, label, kind: "lines", hint }),
  num: (key: string, label = key): PropField => ({ key, label, kind: "number" }),
  sel: (key: string, label: string, options: string[]): PropField => ({ key, label, kind: "select", options }),
  bool: (key: string, label = key): PropField => ({ key, label, kind: "boolean" }),
  url: (key: string, label = key): PropField => ({ key, label, kind: "url" }),
};

const btn = (text: string, href: string, variant = "primary", extra: Record<string, any> = {}): Spec =>
  href ? h("a", { class: `btn btn-${variant}`, href, ...extra }, text) : h("button", { class: `btn btn-${variant}`, type: "button", ...extra }, text);

const svgIcon = (name: string, size = 24): Spec =>
  h(
    "svg",
    { viewBox: "0 0 24 24", width: size, height: size, fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" },
    h("path", { d: SITE_ICONS[name] ?? SITE_ICONS.star }),
  );

const labelled = (label: string, control: Spec): Spec => h("label", { class: "field" }, ...(label ? [h("span", { class: "field-label" }, label)] : []), control);

export const CATALOG: ComponentDef[] = [
  // ---------------------------------------------------------------- Layout
  {
    type: "page", label: "Page", category: "Layout", description: "Page root", container: true, defaults: {}, fields: [],
    render: () => h("main", { class: "page-root" }, SLOT),
  },
  {
    type: "section", label: "Section", category: "Layout", description: "Full-width band with vertical padding", container: true,
    defaults: { tone: "default" }, fields: [F.sel("tone", "Tone", ["default", "surface", "primary", "dark"])],
    render: (p) => h("section", { class: `section tone-${p.tone ?? "default"}` }, h("div", { class: "container" }, SLOT)),
  },
  {
    type: "container", label: "Container", category: "Layout", description: "Centered max-width wrapper", container: true, defaults: {}, fields: [],
    render: () => h("div", { class: "container" }, SLOT),
  },
  {
    type: "row", label: "Row", category: "Layout", description: "Horizontal flex row that wraps", container: true,
    defaults: { gap: 16, align: "center", justify: "flex-start" },
    fields: [F.num("gap", "Gap (px)"), F.sel("align", "Align", ["flex-start", "center", "flex-end", "stretch", "baseline"]), F.sel("justify", "Justify", ["flex-start", "center", "flex-end", "space-between", "space-around"])],
    render: (p) => h("div", { class: "row", style: { gap: `${p.gap ?? 16}px`, alignItems: p.align, justifyContent: p.justify } }, SLOT),
  },
  {
    type: "column", label: "Column", category: "Layout", description: "Vertical stack", container: true,
    defaults: { gap: 12 }, fields: [F.num("gap", "Gap (px)")],
    render: (p) => h("div", { class: "stack", style: { gap: `${p.gap ?? 12}px` } }, SLOT),
  },
  {
    type: "grid", label: "Grid", category: "Layout", description: "Responsive auto-fit grid", container: true,
    defaults: { minWidth: 240, gap: 24 }, fields: [F.num("minWidth", "Min column (px)"), F.num("gap", "Gap (px)")],
    render: (p) => h("div", { class: "grid", style: { gap: `${p.gap ?? 24}px`, gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${p.minWidth ?? 240}px), 1fr))` } }, SLOT),
  },
  {
    type: "box", label: "Box", category: "Layout", description: "Bordered surface panel", container: true, defaults: {}, fields: [],
    render: () => h("div", { class: "box" }, SLOT),
  },
  {
    type: "spacer", label: "Spacer", category: "Layout", description: "Vertical whitespace", defaults: { height: 32 }, fields: [F.num("height", "Height (px)")],
    render: (p) => h("div", { "aria-hidden": "true", style: { height: `${p.height ?? 32}px` } }),
  },
  {
    type: "divider", label: "Divider", category: "Layout", description: "Horizontal rule", defaults: {}, fields: [],
    render: () => h("hr", { class: "divider" }),
  },

  // ---------------------------------------------------------------- Typography
  {
    type: "heading", label: "Heading", category: "Typography", description: "Title h1–h6", textProp: "text",
    defaults: { text: "A clear, confident headline", level: 2 }, fields: [F.text("text", "Text"), F.sel("level", "Level", ["1", "2", "3", "4", "5", "6"])],
    render: (p) => h(`h${Math.min(6, Math.max(1, Number(p.level) || 2))}`, {}, String(p.text ?? "")),
  },
  {
    type: "text", label: "Paragraph", category: "Typography", description: "Body text", textProp: "text",
    defaults: { text: "Explain the value in one or two short sentences. Keep it specific and useful.", size: "base" },
    fields: [F.area("text", "Text"), F.sel("size", "Size", ["sm", "base", "lg", "xl"])],
    render: (p) => h("p", { class: `text-${p.size ?? "base"}` }, String(p.text ?? "")),
  },
  {
    type: "quote", label: "Quote", category: "Typography", description: "Blockquote with citation", textProp: "text",
    defaults: { text: "This changed how our team ships.", cite: "Alex Kim, CTO" }, fields: [F.area("text", "Quote"), F.text("cite", "Citation")],
    render: (p) => h("blockquote", { class: "quote" }, h("p", {}, String(p.text ?? "")), ...(p.cite ? [h("cite", {}, `— ${p.cite}`)] : [])),
  },
  {
    type: "code", label: "Code block", category: "Typography", description: "Preformatted code", defaults: { code: "npm install\nnpm run dev" }, fields: [{ key: "code", label: "Code", kind: "code" }],
    render: (p) => h("pre", { class: "code" }, h("code", {}, String(p.code ?? ""))),
  },
  {
    type: "list", label: "List", category: "Typography", description: "Bulleted or numbered list",
    defaults: { items: "Fast to set up\nSecure by default\nScales with you", ordered: false }, fields: [F.lines("items", "Items", "One per line"), F.bool("ordered", "Numbered")],
    render: (p) => h(p.ordered ? "ol" : "ul", { class: "list" }, ...lines(p.items).map((i) => h("li", {}, i))),
  },
  {
    type: "link", label: "Link", category: "Typography", description: "Text link", textProp: "text",
    defaults: { text: "Learn more →", href: "#", newTab: false }, fields: [F.text("text", "Text"), F.url("href", "URL"), F.bool("newTab", "Open in new tab")],
    render: (p) => h("a", { class: "link", href: String(p.href ?? "#"), ...(p.newTab ? { target: "_blank", rel: "noopener noreferrer" } : {}) }, String(p.text ?? "")),
  },
  {
    type: "badge", label: "Badge", category: "Typography", description: "Small pill label", textProp: "text",
    defaults: { text: "New", tone: "primary" }, fields: [F.text("text", "Text"), F.sel("tone", "Tone", ["primary", "neutral", "success", "warning", "danger"])],
    render: (p) => h("span", { class: `badge badge-${p.tone ?? "primary"}` }, String(p.text ?? "")),
  },

  // ---------------------------------------------------------------- Media
  {
    type: "image", label: "Image", category: "Media", description: "Responsive image",
    defaults: { src: PLACEHOLDER_IMG, alt: "Product screenshot", rounded: true }, fields: [F.url("src", "Source URL"), F.text("alt", "Alt text"), F.bool("rounded", "Rounded")],
    render: (p) => h("img", { class: `img ${p.rounded ? "rounded" : ""}`, src: String(p.src || PLACEHOLDER_IMG), alt: String(p.alt ?? ""), loading: "lazy" }),
  },
  {
    type: "video", label: "Video", category: "Media", description: "HTML5 video",
    defaults: { src: "", poster: "", controls: true, autoplay: false, loop: false, muted: false },
    fields: [F.url("src", "Video URL"), F.url("poster", "Poster URL"), F.bool("controls", "Controls"), F.bool("autoplay", "Autoplay"), F.bool("loop", "Loop"), F.bool("muted", "Muted")],
    render: (p) => h("video", { class: "img rounded", src: p.src || undefined, poster: p.poster || undefined, controls: !!p.controls, autoplay: !!p.autoplay, loop: !!p.loop, muted: !!p.muted, playsinline: true }),
  },
  {
    type: "icon", label: "Icon", category: "Media", description: "Built-in line icon",
    defaults: { name: "sparkles", size: 28, boxed: true }, fields: [F.sel("name", "Icon", Object.keys(SITE_ICONS)), F.num("size", "Size (px)"), F.bool("boxed", "Boxed")],
    render: (p) => h("span", { class: `icon ${p.boxed ? "icon-boxed" : ""}` }, svgIcon(String(p.name), Number(p.size) || 28)),
  },
  {
    type: "avatar", label: "Avatar", category: "Media", description: "Image or initials",
    defaults: { name: "Ada Lovelace", src: "", size: 48 }, fields: [F.text("name", "Name"), F.url("src", "Image URL"), F.num("size", "Size (px)")],
    render: (p) => {
      const size = `${Number(p.size) || 48}px`;
      if (p.src) return h("img", { class: "avatar", src: String(p.src), alt: String(p.name ?? ""), style: { width: size, height: size } });
      const initials = String(p.name ?? "?").split(/\s+/).map((s) => s[0]).join("").slice(0, 2).toUpperCase();
      return h("span", { class: "avatar", role: "img", "aria-label": String(p.name ?? ""), style: { width: size, height: size } }, initials);
    },
  },
  {
    type: "embed", label: "Embed", category: "Media", description: "Embed a URL (maps, video, forms)",
    defaults: { src: "https://www.openstreetmap.org/export/embed.html?bbox=69.2,41.27,69.3,41.33", title: "Map", height: 360 },
    fields: [F.url("src", "Embed URL"), F.text("title", "Title"), F.num("height", "Height (px)")],
    render: (p) => h("iframe", { class: "embed", src: String(p.src ?? ""), title: String(p.title ?? "Embedded content"), loading: "lazy", style: { height: `${Number(p.height) || 360}px` } }),
  },

  // ---------------------------------------------------------------- Forms
  {
    type: "form", label: "Form", category: "Forms", description: "Form container", container: true,
    defaults: { action: "", method: "post" }, fields: [F.url("action", "Action URL"), F.sel("method", "Method", ["post", "get"])],
    render: (p) => h("form", { class: "stack form", action: p.action || undefined, method: String(p.method ?? "post") }, SLOT),
  },
  {
    type: "input", label: "Text input", category: "Forms", description: "Labelled input",
    defaults: { label: "Email", name: "email", type: "email", placeholder: "you@company.com", required: true },
    fields: [F.text("label", "Label"), F.text("name", "Name"), F.sel("type", "Type", ["text", "email", "password", "number", "tel", "url", "date", "search"]), F.text("placeholder", "Placeholder"), F.bool("required", "Required")],
    render: (p) => labelled(String(p.label ?? ""), h("input", { class: "input", name: String(p.name ?? ""), type: String(p.type ?? "text"), placeholder: String(p.placeholder ?? ""), required: !!p.required })),
  },
  {
    type: "textarea", label: "Text area", category: "Forms", description: "Multi-line input",
    defaults: { label: "Message", name: "message", placeholder: "How can we help?", rows: 4 }, fields: [F.text("label", "Label"), F.text("name", "Name"), F.text("placeholder", "Placeholder"), F.num("rows", "Rows")],
    render: (p) => labelled(String(p.label ?? ""), h("textarea", { class: "input", name: String(p.name ?? ""), placeholder: String(p.placeholder ?? ""), rows: Number(p.rows) || 4 })),
  },
  {
    type: "select", label: "Select", category: "Forms", description: "Dropdown",
    defaults: { label: "Plan", name: "plan", options: "Starter\nPro\nEnterprise" }, fields: [F.text("label", "Label"), F.text("name", "Name"), F.lines("options", "Options", "One per line")],
    render: (p) => labelled(String(p.label ?? ""), h("select", { class: "input", name: String(p.name ?? "") }, ...lines(p.options).map((o) => h("option", { value: o }, o)))),
  },
  {
    type: "checkbox", label: "Checkbox", category: "Forms", description: "Single checkbox", textProp: "label",
    defaults: { label: "I agree to the terms", name: "terms", checked: false }, fields: [F.text("label", "Label"), F.text("name", "Name"), F.bool("checked", "Checked")],
    render: (p) => h("label", { class: "check" }, h("input", { type: "checkbox", name: String(p.name ?? ""), checked: !!p.checked }), h("span", {}, String(p.label ?? ""))),
  },
  {
    type: "switch", label: "Switch", category: "Forms", description: "Toggle switch", textProp: "label",
    defaults: { label: "Email notifications", name: "notify", checked: true }, fields: [F.text("label", "Label"), F.text("name", "Name"), F.bool("checked", "On")],
    render: (p) => h("label", { class: "check switch" }, h("input", { type: "checkbox", role: "switch", name: String(p.name ?? ""), checked: !!p.checked }), h("span", { class: "switch-track", "aria-hidden": "true" }), h("span", {}, String(p.label ?? ""))),
  },
  {
    type: "radio", label: "Radio group", category: "Forms", description: "Pick one option",
    defaults: { label: "Billing", name: "billing", options: "Monthly\nYearly (save 20%)" }, fields: [F.text("label", "Label"), F.text("name", "Name"), F.lines("options", "Options", "One per line")],
    render: (p) =>
      h("fieldset", { class: "fieldset" }, h("legend", { class: "field-label" }, String(p.label ?? "")), ...lines(p.options).map((o, i) => h("label", { class: "check" }, h("input", { type: "radio", name: String(p.name ?? "radio"), value: o, checked: i === 0 }), h("span", {}, o)))),
  },
  {
    type: "slider", label: "Slider", category: "Forms", description: "Range input",
    defaults: { label: "Team size", name: "size", min: 1, max: 100, value: 10 }, fields: [F.text("label", "Label"), F.text("name", "Name"), F.num("min", "Min"), F.num("max", "Max"), F.num("value", "Value")],
    render: (p) => labelled(String(p.label ?? ""), h("input", { class: "range", type: "range", name: String(p.name ?? ""), min: Number(p.min) || 0, max: Number(p.max) || 100, value: Number(p.value) || 0 })),
  },
  {
    type: "button", label: "Button", category: "Forms", description: "Button or link button", textProp: "text",
    defaults: { text: "Get started", href: "", variant: "primary", size: "md", fullWidth: false, submit: false },
    fields: [F.text("text", "Text"), F.url("href", "Link (optional)"), F.sel("variant", "Variant", ["primary", "secondary", "ghost", "danger"]), F.sel("size", "Size", ["sm", "md", "lg"]), F.bool("fullWidth", "Full width"), F.bool("submit", "Submit button")],
    render: (p) => {
      const cls = `btn btn-${p.variant ?? "primary"} btn-${p.size ?? "md"} ${p.fullWidth ? "btn-block" : ""}`.trim();
      return p.href ? h("a", { class: cls, href: String(p.href) }, String(p.text ?? "")) : h("button", { class: cls, type: p.submit ? "submit" : "button" }, String(p.text ?? ""));
    },
  },

  // ---------------------------------------------------------------- Data
  {
    type: "table", label: "Table", category: "Data", description: "Data table",
    defaults: { columns: "Customer, Plan, MRR, Status", rows: "Acme Inc, Pro, $1,200, Active\nGlobex, Starter, $240, Trial\nInitech, Enterprise, $8,900, Active", striped: true },
    fields: [F.text("columns", "Columns (comma-separated)"), F.lines("rows", "Rows", "One row per line, cells separated by commas"), F.bool("striped", "Striped")],
    render: (p) => {
      const cols = String(p.columns ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      return h(
        "div",
        { class: "table-wrap" },
        h(
          "table",
          { class: `table ${p.striped ? "striped" : ""}` },
          h("thead", {}, h("tr", {}, ...cols.map((c) => h("th", { scope: "col" }, c)))),
          h("tbody", {}, ...lines(p.rows).map((r) => h("tr", {}, ...r.split(",").map((c) => h("td", {}, c.trim()))))),
        ),
      );
    },
  },
  {
    type: "stat", label: "Stat / KPI", category: "Data", description: "Metric card",
    defaults: { label: "Monthly revenue", value: "$48,210", delta: "+12.4%", trend: "up" }, fields: [F.text("label", "Label"), F.text("value", "Value"), F.text("delta", "Change"), F.sel("trend", "Trend", ["up", "down", "flat"])],
    render: (p) => h("div", { class: "box stat" }, h("div", { class: "stat-label" }, String(p.label ?? "")), h("div", { class: "stat-value" }, String(p.value ?? "")), ...(p.delta ? [h("div", { class: `stat-delta trend-${p.trend ?? "flat"}` }, String(p.delta))] : [])),
  },
  {
    type: "progress", label: "Progress", category: "Data", description: "Progress bar",
    defaults: { label: "Storage used", value: 64 }, fields: [F.text("label", "Label"), F.num("value", "Percent")],
    render: (p) => {
      const v = Math.max(0, Math.min(100, Number(p.value) || 0));
      return h("div", { class: "stack", style: { gap: "6px" } }, h("div", { class: "row", style: { justifyContent: "space-between" } }, h("span", { class: "text-sm" }, String(p.label ?? "")), h("span", { class: "text-sm muted" }, `${v}%`)), h("div", { class: "progress", role: "progressbar", "aria-valuenow": v, "aria-valuemin": 0, "aria-valuemax": 100 }, h("span", { style: { width: `${v}%` } })));
    },
  },
  {
    type: "chart", label: "Bar chart", category: "Data", description: "Simple SVG bar chart",
    defaults: { title: "Signups per month", labels: "Jan, Feb, Mar, Apr, May, Jun", values: "120, 180, 150, 240, 310, 280" },
    fields: [F.text("title", "Title"), F.text("labels", "Labels (comma-separated)"), F.text("values", "Values (comma-separated)")],
    render: (p) => {
      const labels = String(p.labels ?? "").split(",").map((s) => s.trim());
      const values = String(p.values ?? "").split(",").map((s) => Number(s.trim()) || 0);
      const max = Math.max(1, ...values);
      const W = 600, H = 240, pad = 28, bw = (W - pad * 2) / Math.max(1, values.length);
      const bars: Child[] = values.flatMap((v, i) => {
        const bh = ((H - pad * 2) * v) / max;
        const x = pad + i * bw + bw * 0.15;
        return [
          h("rect", { x: x.toFixed(1), y: (H - pad - bh).toFixed(1), width: (bw * 0.7).toFixed(1), height: bh.toFixed(1), rx: 4, fill: "currentColor" }, h("title", {}, `${labels[i] ?? ""}: ${v}`)),
          h("text", { x: (x + bw * 0.35).toFixed(1), y: H - 8, "text-anchor": "middle", "font-size": 12, fill: "var(--color-muted)" }, labels[i] ?? ""),
        ];
      });
      return h("figure", { class: "box chart" }, ...(p.title ? [h("figcaption", { class: "stat-label" }, String(p.title))] : []), h("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": String(p.title ?? "Bar chart"), style: { width: "100%", height: "auto", color: "var(--color-primary)" } }, ...bars));
    },
  },
  {
    type: "card", label: "Card", category: "Data", description: "Image, title, text and link",
    defaults: { image: "", title: "Card title", text: "A short description that supports the title.", linkText: "Read more", href: "#" },
    fields: [F.url("image", "Image URL"), F.text("title", "Title"), F.area("text", "Text"), F.text("linkText", "Link text"), F.url("href", "Link URL")],
    render: (p) =>
      h("article", { class: "box card" }, ...(p.image ? [h("img", { class: "img rounded", src: String(p.image), alt: "" })] : []), h("h3", {}, String(p.title ?? "")), h("p", { class: "muted" }, String(p.text ?? "")), ...(p.linkText ? [h("a", { class: "link", href: String(p.href ?? "#") }, String(p.linkText))] : [])),
  },

  // ---------------------------------------------------------------- Navigation
  {
    type: "navbar", label: "Navbar", category: "Navigation", description: "Top navigation bar",
    defaults: { brand: "Acme", links: "Product|#product\nPricing|#pricing\nDocs|#docs", ctaText: "Sign up", ctaHref: "#signup", sticky: true },
    fields: [F.text("brand", "Brand"), F.lines("links", "Links", "Label|URL per line"), F.text("ctaText", "Button text"), F.url("ctaHref", "Button URL"), F.bool("sticky", "Sticky")],
    render: (p) =>
      h(
        "header",
        { class: `navbar ${p.sticky ? "sticky" : ""}` },
        h(
          "div",
          { class: "container row", style: { justifyContent: "space-between" } },
          h("a", { class: "brand", href: "/" }, String(p.brand ?? "")),
          h("nav", { class: "row nav-links", "aria-label": "Main" }, ...lines(p.links).map((l) => {
            const [label, href] = parts(l, 2);
            return h("a", { href: href || "#" }, label);
          })),
          ...(p.ctaText ? [btn(String(p.ctaText), String(p.ctaHref || "#"), "primary", { class: "btn btn-primary btn-sm" })] : []),
        ),
      ),
  },
  {
    type: "footer", label: "Footer", category: "Navigation", description: "Site footer",
    defaults: { text: "© 2026 Acme Inc. All rights reserved.", links: "Privacy|/privacy\nTerms|/terms\nContact|/contact" },
    fields: [F.text("text", "Text"), F.lines("links", "Links", "Label|URL per line")],
    render: (p) => h("footer", { class: "footer" }, h("div", { class: "container row", style: { justifyContent: "space-between", flexWrap: "wrap" } }, h("span", { class: "muted text-sm" }, String(p.text ?? "")), h("nav", { class: "row", "aria-label": "Footer" }, ...lines(p.links).map((l) => {
      const [label, href] = parts(l, 2);
      return h("a", { class: "muted text-sm", href: href || "#" }, label);
    })))),
  },
  {
    type: "breadcrumb", label: "Breadcrumb", category: "Navigation", description: "Location trail",
    defaults: { items: "Home|/\nProjects|/projects\nWebsite redesign" }, fields: [F.lines("items", "Items", "Label|URL per line (last is current)")],
    render: (p) => {
      const items = lines(p.items);
      return h("nav", { class: "breadcrumb", "aria-label": "Breadcrumb" }, h("ol", {}, ...items.map((l, i) => {
        const [label, href] = parts(l, 2);
        return h("li", {}, i === items.length - 1 || !href ? h("span", { "aria-current": "page" }, label) : h("a", { href }, label));
      })));
    },
  },
  {
    type: "tabs", label: "Tabs", category: "Navigation", description: "Tab bar (visual)",
    defaults: { tabs: "Overview\nActivity\nSettings", active: 0 }, fields: [F.lines("tabs", "Tabs", "One per line"), F.num("active", "Active index")],
    render: (p) => h("div", { class: "tabs", role: "tablist" }, ...lines(p.tabs).map((tab, i) => h("button", { class: `tab ${i === Number(p.active) ? "active" : ""}`, role: "tab", type: "button", "aria-selected": i === Number(p.active) ? "true" : "false" }, tab))),
  },

  // ---------------------------------------------------------------- Sections
  {
    type: "hero", label: "Hero", category: "Sections", description: "Headline, subcopy and CTAs",
    defaults: { eyebrow: "New · v2.0 is live", title: "Ship beautiful products, faster", subtitle: "Design, build and deploy from one place — with an expert AI copilot at your side.", primaryText: "Start free", primaryHref: "#signup", secondaryText: "Book a demo", secondaryHref: "#demo", align: "center" },
    fields: [F.text("eyebrow", "Eyebrow"), F.text("title", "Title"), F.area("subtitle", "Subtitle"), F.text("primaryText", "Primary button"), F.url("primaryHref", "Primary URL"), F.text("secondaryText", "Secondary button"), F.url("secondaryHref", "Secondary URL"), F.sel("align", "Align", ["center", "left"])],
    render: (p) =>
      h(
        "section",
        { class: `section hero align-${p.align ?? "center"}` },
        h(
          "div",
          { class: "container stack", style: { gap: "20px" } },
          ...(p.eyebrow ? [h("span", { class: "badge badge-primary" }, String(p.eyebrow))] : []),
          h("h1", { class: "hero-title" }, String(p.title ?? "")),
          h("p", { class: "text-xl muted hero-sub" }, String(p.subtitle ?? "")),
          h("div", { class: "row hero-actions" }, ...(p.primaryText ? [btn(String(p.primaryText), String(p.primaryHref || "#"), "primary", { class: "btn btn-primary btn-lg" })] : []), ...(p.secondaryText ? [btn(String(p.secondaryText), String(p.secondaryHref || "#"), "secondary", { class: "btn btn-secondary btn-lg" })] : [])),
        ),
      ),
  },
  {
    type: "features", label: "Feature grid", category: "Sections", description: "Icon + title + text grid",
    defaults: { title: "Everything you need", subtitle: "Powerful building blocks that work together.", items: "bolt|Blazing fast|Pages load in milliseconds on any device.\nshield|Secure by default|Secrets are encrypted and never shipped to the browser.\nusers|Built for teams|Roles, audit logs and live collaboration.", columns: 3 },
    fields: [F.text("title", "Title"), F.text("subtitle", "Subtitle"), F.lines("items", "Features", "icon|Title|Description per line"), F.num("columns", "Max columns")],
    render: (p) =>
      h(
        "section",
        { class: "section" },
        h(
          "div",
          { class: "container stack", style: { gap: "32px" } },
          h("div", { class: "stack center", style: { gap: "8px" } }, h("h2", {}, String(p.title ?? "")), ...(p.subtitle ? [h("p", { class: "muted text-lg" }, String(p.subtitle))] : [])),
          h("div", { class: "grid", style: { gap: "24px", gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${Math.round(1000 / (Number(p.columns) || 3))}px), 1fr))` } }, ...lines(p.items).map((l) => {
            const [icon, title, text] = parts(l, 3);
            return h("div", { class: "box stack", style: { gap: "10px" } }, h("span", { class: "icon icon-boxed" }, svgIcon(icon || "star", 22)), h("h3", {}, title), h("p", { class: "muted" }, text));
          })),
        ),
      ),
  },
  {
    type: "pricing", label: "Pricing table", category: "Sections", description: "Plans side by side",
    defaults: { title: "Simple, transparent pricing", plans: "Starter|$0|/month|1 project;Community support;Basic analytics|\nPro|$29|/month|Unlimited projects;Priority support;Advanced analytics;Custom domains|featured\nEnterprise|Custom||SSO & SCIM;Dedicated success manager;99.99% SLA|" },
    fields: [F.text("title", "Title"), F.lines("plans", "Plans", "Name|Price|Period|feature;feature|featured per line")],
    render: (p) =>
      h("section", { class: "section" }, h("div", { class: "container stack", style: { gap: "32px" } }, h("h2", { class: "center" }, String(p.title ?? "")), h("div", { class: "grid", style: { gap: "24px", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))" } }, ...lines(p.plans).map((l) => {
        const [name, price, period, feats, featured] = parts(l, 5);
        return h("div", { class: `box plan ${featured ? "featured" : ""}` }, h("h3", {}, name), h("div", { class: "plan-price" }, price, h("span", { class: "muted text-sm" }, period)), h("ul", { class: "list checks" }, ...feats.split(";").filter(Boolean).map((f) => h("li", {}, f.trim()))), btn(featured ? "Get started" : "Choose plan", "#signup", featured ? "primary" : "secondary", { class: `btn btn-${featured ? "primary" : "secondary"} btn-block` }));
      })))),
  },
  {
    type: "testimonial", label: "Testimonial", category: "Sections", description: "Customer quote",
    defaults: { quote: "We replaced four tools with this panel and cut our release time in half.", author: "Dilnoza Rahimova", role: "Head of Product, Uzum" },
    fields: [F.area("quote", "Quote"), F.text("author", "Author"), F.text("role", "Role")],
    render: (p) => h("figure", { class: "box testimonial" }, h("blockquote", { class: "text-lg" }, `“${p.quote ?? ""}”`), h("figcaption", { class: "row" }, h("span", { class: "avatar", style: { width: "40px", height: "40px" } }, String(p.author ?? "?").split(/\s+/).map((s) => s[0]).join("").slice(0, 2)), h("span", { class: "stack", style: { gap: "0" } }, h("strong", {}, String(p.author ?? "")), h("span", { class: "muted text-sm" }, String(p.role ?? ""))))),
  },
  {
    type: "faq", label: "FAQ", category: "Sections", description: "Expandable questions",
    defaults: { title: "Frequently asked questions", items: "Is there a free plan?|Yes — the Starter plan is free forever.\nCan I export my code?|Yes. Export clean HTML or React at any time.\nWhere are my secrets stored?|In an encrypted vault, never in your code." },
    fields: [F.text("title", "Title"), F.lines("items", "Questions", "Question|Answer per line")],
    render: (p) => h("section", { class: "section" }, h("div", { class: "container stack narrow", style: { gap: "16px" } }, h("h2", { class: "center" }, String(p.title ?? "")), ...lines(p.items).map((l) => {
      const [q, a] = parts(l, 2);
      return h("details", { class: "box faq" }, h("summary", {}, q), h("p", { class: "muted" }, a));
    }))),
  },
  {
    type: "cta", label: "Call to action", category: "Sections", description: "Closing banner",
    defaults: { title: "Ready to build something great?", text: "Start free. No credit card required.", buttonText: "Create your account", buttonHref: "#signup" },
    fields: [F.text("title", "Title"), F.text("text", "Text"), F.text("buttonText", "Button text"), F.url("buttonHref", "Button URL")],
    render: (p) => h("section", { class: "section" }, h("div", { class: "container" }, h("div", { class: "cta stack center", style: { gap: "16px" } }, h("h2", {}, String(p.title ?? "")), h("p", { class: "text-lg" }, String(p.text ?? "")), btn(String(p.buttonText ?? "Get started"), String(p.buttonHref || "#"), "light", { class: "btn btn-light btn-lg" })))),
  },
  {
    type: "statsband", label: "Stats band", category: "Sections", description: "Row of big numbers",
    defaults: { items: "10k+|Teams\n99.99%|Uptime\n4.9/5|Rating\n24/7|Support" }, fields: [F.lines("items", "Stats", "Value|Label per line")],
    render: (p) => h("section", { class: "section tone-surface" }, h("div", { class: "container grid", style: { gap: "24px", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 160px), 1fr))" } }, ...lines(p.items).map((l) => {
      const [v, label] = parts(l, 2);
      return h("div", { class: "stack center", style: { gap: "4px" } }, h("div", { class: "stat-value big" }, v), h("div", { class: "muted" }, label));
    }))),
  },
  {
    type: "logos", label: "Logo cloud", category: "Sections", description: "Trusted-by names",
    defaults: { title: "Trusted by teams at", names: "Northwind\nGlobex\nInitech\nUmbrella\nHooli" }, fields: [F.text("title", "Title"), F.lines("names", "Names", "One per line")],
    render: (p) => h("section", { class: "section" }, h("div", { class: "container stack center", style: { gap: "16px" } }, h("p", { class: "muted text-sm upper" }, String(p.title ?? "")), h("div", { class: "row logos", style: { justifyContent: "center", gap: "32px", flexWrap: "wrap" } }, ...lines(p.names).map((n) => h("span", { class: "logo-name" }, n))))),
  },
  {
    type: "contact", label: "Contact form", category: "Sections", description: "Name, email, message",
    defaults: { title: "Get in touch", text: "We usually reply within one business day.", action: "", buttonText: "Send message" },
    fields: [F.text("title", "Title"), F.text("text", "Text"), F.url("action", "Form action URL"), F.text("buttonText", "Button text")],
    render: (p) => h("section", { class: "section" }, h("div", { class: "container narrow stack", style: { gap: "16px" } }, h("h2", {}, String(p.title ?? "")), h("p", { class: "muted" }, String(p.text ?? "")), h("form", { class: "stack form", method: "post", action: p.action || undefined }, labelled("Name", h("input", { class: "input", name: "name", required: true, autocomplete: "name" })), labelled("Email", h("input", { class: "input", type: "email", name: "email", required: true, autocomplete: "email" })), labelled("Message", h("textarea", { class: "input", name: "message", rows: 5, required: true })), h("button", { class: "btn btn-primary", type: "submit" }, String(p.buttonText ?? "Send"))))),
  },
  {
    type: "appshell", label: "Admin app shell", category: "Sections", description: "Sidebar + content area for dashboards", container: true,
    defaults: { brand: "Admin", items: "Overview\nCustomers\nOrders\nProducts\nReports\nSettings", active: 0 },
    fields: [F.text("brand", "Brand"), F.lines("items", "Menu items", "One per line"), F.num("active", "Active index")],
    render: (p) => h("div", { class: "appshell" }, h("aside", { class: "appshell-side" }, h("div", { class: "brand" }, String(p.brand ?? "")), h("nav", { class: "stack", style: { gap: "2px" }, "aria-label": "Sidebar" }, ...lines(p.items).map((it, i) => h("a", { href: "#", class: `side-link ${i === Number(p.active) ? "active" : ""}` }, it)))), h("div", { class: "appshell-main stack", style: { gap: "24px" } }, SLOT)),
  },
  {
    type: "pageheader", label: "Page header", category: "Sections", description: "Title, subtitle and action",
    defaults: { title: "Overview", subtitle: "Your business at a glance", actionText: "Export" }, fields: [F.text("title", "Title"), F.text("subtitle", "Subtitle"), F.text("actionText", "Action")],
    render: (p) => h("div", { class: "row", style: { justifyContent: "space-between", flexWrap: "wrap" } }, h("div", { class: "stack", style: { gap: "4px" } }, h("h1", { class: "h2" }, String(p.title ?? "")), h("p", { class: "muted" }, String(p.subtitle ?? ""))), ...(p.actionText ? [h("button", { class: "btn btn-secondary", type: "button" }, String(p.actionText))] : [])),
  },

  // ---------------------------------------------------------------- Feedback
  {
    type: "alert", label: "Alert", category: "Feedback", description: "Inline message",
    defaults: { tone: "info", title: "Heads up", text: "Your trial ends in 3 days." }, fields: [F.sel("tone", "Tone", ["info", "success", "warning", "danger"]), F.text("title", "Title"), F.text("text", "Text")],
    render: (p) => h("div", { class: `alert alert-${p.tone ?? "info"}`, role: p.tone === "danger" ? "alert" : "status" }, h("strong", {}, String(p.title ?? "")), h("span", {}, String(p.text ?? ""))),
  },
  {
    type: "accordion", label: "Accordion item", category: "Feedback", description: "Expandable panel",
    defaults: { summary: "Show details", text: "Hidden content revealed on click.", open: false }, fields: [F.text("summary", "Summary"), F.area("text", "Content"), F.bool("open", "Open")],
    render: (p) => h("details", { class: "box faq", open: !!p.open }, h("summary", {}, String(p.summary ?? "")), h("p", { class: "muted" }, String(p.text ?? ""))),
  },
  {
    type: "empty", label: "Empty state", category: "Feedback", description: "Nothing here yet",
    defaults: { icon: "sparkles", title: "No projects yet", text: "Create your first project to get started.", actionText: "New project" },
    fields: [F.sel("icon", "Icon", Object.keys(SITE_ICONS)), F.text("title", "Title"), F.text("text", "Text"), F.text("actionText", "Action")],
    render: (p) => h("div", { class: "box stack center empty", style: { gap: "10px" } }, h("span", { class: "icon icon-boxed" }, svgIcon(String(p.icon ?? "sparkles"), 24)), h("h3", {}, String(p.title ?? "")), h("p", { class: "muted" }, String(p.text ?? "")), ...(p.actionText ? [h("button", { class: "btn btn-primary", type: "button" }, String(p.actionText))] : [])),
  },
  {
    type: "spinner", label: "Spinner", category: "Feedback", description: "Loading indicator", defaults: { size: 28 }, fields: [F.num("size", "Size (px)")],
    render: (p) => h("span", { class: "spinner", role: "status", "aria-label": "Loading", style: { width: `${Number(p.size) || 28}px`, height: `${Number(p.size) || 28}px` } }),
  },

  // ---------------------------------------------------------------- Advanced
  {
    type: "html", label: "Custom HTML", category: "Advanced", description: "Raw HTML snippet (sandboxed in the editor)",
    defaults: { html: "<p>Custom <strong>HTML</strong> goes here.</p>" }, fields: [{ key: "html", label: "HTML", kind: "code" }],
    render: (p) => ({ tag: "div", attrs: { class: "custom-html" }, rawHtml: String(p.html ?? "") }),
  },
];

export const CATALOG_MAP = new Map(CATALOG.map((c) => [c.type, c]));
export const isKnownType = (t: string) => CATALOG_MAP.has(t);
export const CATEGORIES = [...new Set(CATALOG.filter((c) => c.type !== "page").map((c) => c.category))];

export function defFor(type: string): ComponentDef {
  return CATALOG_MAP.get(type) ?? CATALOG_MAP.get("box")!;
}

export function specFor(node: BNode): Spec {
  const def = defFor(node.type);
  return def.render({ ...def.defaults, ...node.props }, node);
}
