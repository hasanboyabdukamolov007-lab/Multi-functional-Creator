import type { BNode, BPage, SiteTokens } from "./model";
import { walk } from "./model";

export interface Issue {
  severity: "error" | "warning";
  rule: string;
  message: string;
  nodeId?: string;
}

function luminance(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  const ch = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch((v >> 16) & 255) + 0.7152 * ch((v >> 8) & 255) + 0.0722 * ch(v & 255);
}

/** WCAG contrast ratio, or null when either color isn't a plain hex value. */
export function contrastRatio(a: string, b: string): number | null {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const lines = (v: unknown) => String(v ?? "").split("\n").map((s) => s.trim()).filter(Boolean);

/** Accessibility and SEO checks for one page (WCAG 2.1 AA oriented). */
export function auditPage(page: BPage, tokens: SiteTokens): { issues: Issue[]; score: number } {
  const issues: Issue[] = [];
  const add = (severity: Issue["severity"], rule: string, message: string, nodeId?: string) => issues.push({ severity, rule, message, nodeId });

  const pairs: Array<[string, string, string, number]> = [
    ["Body text on background", tokens.text, tokens.bg, 4.5],
    ["Muted text on background", tokens.muted, tokens.bg, 4.5],
    ["Body text on surfaces", tokens.text, tokens.surface, 4.5],
    ["Button text on primary color", tokens.primaryText, tokens.primary, 4.5],
    ["Links (primary) on background", tokens.primary, tokens.bg, 3],
  ];
  for (const [label, fg, bg, min] of pairs) {
    const r = contrastRatio(fg, bg);
    if (r !== null && r < min) add(r < 3 ? "error" : "warning", "contrast", `${label}: contrast ${r.toFixed(2)}:1 is below ${min}:1`);
  }

  if (!page.title?.trim()) add("error", "seo-title", "The page has no title (Pages → page settings).");
  if (!page.description?.trim()) add("warning", "seo-description", "Add a meta description (Pages → page settings) for search results and link previews.");

  let h1 = 0;
  let lastLevel = 0;
  const headingLevel = (n: BNode): number | null => {
    if (n.type === "heading") return Math.min(6, Math.max(1, Number(n.props.level ?? 2)));
    if (n.type === "hero") return 1;
    if (n.type === "pageheader") return 1;
    if (["features", "pricing", "faq", "cta", "contact"].includes(n.type)) return 2;
    return null;
  };
  walk(page.root, (n) => {
    const level = headingLevel(n);
    if (level) {
      if (level === 1) h1++;
      if (lastLevel && level > lastLevel + 1) add("warning", "heading-order", `Heading level jumps from H${lastLevel} to H${level}.`, n.id);
      lastLevel = level;
    }
    const p = n.props;
    switch (n.type) {
      case "image":
        if (!String(p.alt ?? "").trim()) add("error", "img-alt", "Image is missing alt text (describe it, or mark decorative).", n.id);
        break;
      case "avatar":
        if (!String(p.name ?? "").trim()) add("warning", "img-alt", "Avatar has no name for screen readers.", n.id);
        break;
      case "button":
        if (!String(p.text ?? "").trim()) add("error", "button-name", "Button has no text.", n.id);
        break;
      case "link":
        if (!String(p.text ?? "").trim()) add("error", "link-name", "Link has no text.", n.id);
        else if (/^(click here|here|read more|more)$/i.test(String(p.text).trim())) add("warning", "link-name", `Link text “${p.text}” doesn't say where it goes.`, n.id);
        if (!String(p.href ?? "").trim() || p.href === "#") add("warning", "link-href", "Link points nowhere (#).", n.id);
        break;
      case "input":
      case "textarea":
      case "select":
      case "slider":
        if (!String(p.label ?? "").trim()) add(p.placeholder ? "warning" : "error", "form-label", p.placeholder ? "Field relies on its placeholder; add a visible label." : "Form field has no label.", n.id);
        break;
      case "embed":
        if (!String(p.title ?? "").trim()) add("error", "frame-title", "Embedded frame needs a title.", n.id);
        break;
      case "video":
        if (p.autoplay && !p.muted) add("warning", "media-autoplay", "Autoplaying video with sound is disruptive; mute it or turn off autoplay.", n.id);
        break;
      case "navbar":
        if (lines(p.links).some((l) => !l.includes("|"))) add("warning", "link-href", "Some navigation links have no URL (use Label|URL).", n.id);
        break;
      case "html":
        add("warning", "custom-html", "Custom HTML can't be checked automatically — verify it by hand.", n.id);
        break;
    }
    if (n.style.display === "none") add("warning", "hidden", "Element is hidden; make sure that's intentional.", n.id);
  });
  if (h1 === 0) add("warning", "h1", "The page has no top-level heading (H1).");
  if (h1 > 1) add("warning", "h1", `The page has ${h1} top-level headings; keep one H1 per page.`);

  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.length - errors;
  return { issues, score: Math.max(0, 100 - errors * 12 - warnings * 4) };
}
