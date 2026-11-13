import type { BNode, BPage, BuilderDoc } from "./model";
import { specFor } from "./catalog";
import { isSlot, type Child, type Spec } from "./spec";
import { SITE_CSS, tokenVars } from "./siteCss";

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string) => esc(s).replace(/"/g, "&quot;");
const kebab = (k: string) => k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

function styleString(style: Record<string, unknown> | undefined): string {
  if (!style) return "";
  return Object.entries(style)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k.startsWith("--") ? k : kebab(k)}: ${v}`)
    .join("; ");
}

/** Merge the node's own style overrides onto the root element of its spec. */
export function specWithNode(node: BNode): Spec {
  const spec = specFor(node);
  return Object.keys(node.style).length ? { ...spec, style: { ...(spec.style ?? {}), ...node.style } } : spec;
}

// ------------------------------------------------------------------- HTML
function htmlOf(spec: Spec, children: BNode[], depth: number): string {
  const pad = "  ".repeat(depth);
  const attrs = Object.entries(spec.attrs ?? {})
    .filter(([, v]) => v !== undefined && v !== false && v !== "")
    .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${escAttr(String(v))}"`))
    .join("");
  const st = styleString(spec.style);
  const open = `<${spec.tag}${attrs}${st ? ` style="${escAttr(st)}"` : ""}>`;
  if (VOID.has(spec.tag)) return `${pad}${open}`;
  if (spec.rawHtml !== undefined) return `${pad}${open}\n${spec.rawHtml}\n${pad}</${spec.tag}>`;
  const kids = spec.children ?? [];
  if (kids.length === 1 && typeof kids[0] === "string") return `${pad}${open}${esc(kids[0])}</${spec.tag}>`;
  const inner = kids.map((c) => childHtml(c, children, depth + 1)).filter(Boolean).join("\n");
  return inner ? `${pad}${open}\n${inner}\n${pad}</${spec.tag}>` : `${pad}${open}</${spec.tag}>`;
}

function childHtml(c: Child, children: BNode[], depth: number): string {
  if (typeof c === "string") return `${"  ".repeat(depth)}${esc(c)}`;
  if (isSlot(c)) return children.map((n) => nodeHtml(n, depth)).join("\n");
  return htmlOf(c, children, depth);
}

export function nodeHtml(node: BNode, depth = 0): string {
  return htmlOf(specWithNode(node), node.children, depth);
}

/** Full HTML document for a page. With `cssHref` the stylesheet is linked instead of inlined (multi-page sites). */
export function pageHtml(doc: BuilderDoc, page: BPage, opts: { cssHref?: string } = {}): string {
  const vars = Object.entries(tokenVars(doc.tokens)).map(([k, v]) => `  ${k}: ${v};`).join("\n");
  const title = esc(page.title || page.name);
  const meta = [
    page.description ? `<meta name="description" content="${escAttr(page.description)}" />` : "",
    `<meta property="og:title" content="${title}" />`,
    page.description ? `<meta property="og:description" content="${escAttr(page.description)}" />` : "",
    page.ogImage ? `<meta property="og:image" content="${escAttr(page.ogImage)}" />` : "",
    `<meta name="twitter:card" content="${page.ogImage ? "summary_large_image" : "summary"}" />`,
    `<meta name="theme-color" content="${escAttr(doc.tokens.primary)}" />`,
  ].filter(Boolean).join("\n");
  return `<!doctype html>
<html lang="${escAttr(page.lang || "en")}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
${meta}
${opts.cssHref ? `<link rel="stylesheet" href="${escAttr(opts.cssHref)}" />` : `<style>
.site {
${vars}
}
html, body { margin: 0; }
${SITE_CSS.trim()}
</style>`}
</head>
<body class="site">
${nodeHtml(page.root, 0)}
</body>
</html>
`;
}

export function siteCss(doc: BuilderDoc): string {
  const vars = Object.entries(tokenVars(doc.tokens)).map(([k, v]) => `  ${k}: ${v};`).join("\n");
  return `.site {\n${vars}\n}\nhtml, body { margin: 0; }\n${SITE_CSS.trim()}\n`;
}

// ------------------------------------------------------------------- React (JSX)
const REACT_ATTR: Record<string, string> = {
  class: "className", for: "htmlFor", tabindex: "tabIndex", readonly: "readOnly", autoplay: "autoPlay", playsinline: "playsInline", autocomplete: "autoComplete",
  maxlength: "maxLength", minlength: "minLength", inputmode: "inputMode", allowfullscreen: "allowFullScreen", colspan: "colSpan", rowspan: "rowSpan", srcset: "srcSet",
  crossorigin: "crossOrigin", enctype: "encType", novalidate: "noValidate", datetime: "dateTime", spellcheck: "spellCheck", contenteditable: "contentEditable",
  checked: "defaultChecked", value: "defaultValue",
};

export function reactAttrName(k: string, tag: string): string {
  if (REACT_ATTR[k]) {
    // <option value> and <input type=radio value> keep their real value attribute.
    if (k === "value" && (tag === "option" || tag === "input")) return "value";
    return REACT_ATTR[k];
  }
  if (k.startsWith("data-") || k.startsWith("aria-")) return k;
  return k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function jsxValue(v: unknown): string {
  if (typeof v === "number") return `{${v}}`;
  return JSON.stringify(String(v));
}

function jsxOf(spec: Spec, children: BNode[], depth: number): string {
  const pad = "  ".repeat(depth);
  const attrs = Object.entries(spec.attrs ?? {})
    .filter(([, v]) => v !== undefined && v !== false && v !== "")
    .map(([k, v]) => {
      const name = reactAttrName(k, spec.tag);
      if (spec.tag === "input" && k === "value" && (spec.attrs?.type === "range" || !spec.attrs?.type)) return ` defaultValue=${jsxValue(v)}`;
      return v === true ? ` ${name}` : ` ${name}=${jsxValue(v)}`;
    })
    .join("");
  const st = spec.style && Object.keys(spec.style).length ? ` style={${JSON.stringify(Object.fromEntries(Object.entries(spec.style).filter(([, v]) => v !== undefined && v !== "")))}}` : "";
  if (spec.rawHtml !== undefined) return `${pad}<${spec.tag}${attrs}${st} dangerouslySetInnerHTML={{ __html: ${JSON.stringify(spec.rawHtml)} }} />`;
  const kids = spec.children ?? [];
  if (VOID.has(spec.tag) || (!kids.length && !children.length)) return `${pad}<${spec.tag}${attrs}${st} />`;
  if (kids.length === 1 && typeof kids[0] === "string") return `${pad}<${spec.tag}${attrs}${st}>{${JSON.stringify(kids[0])}}</${spec.tag}>`;
  const inner = kids
    .map((c) => (typeof c === "string" ? `${"  ".repeat(depth + 1)}{${JSON.stringify(c)}}` : isSlot(c) ? children.map((n) => nodeJsx(n, depth + 1)).join("\n") : jsxOf(c, children, depth + 1)))
    .filter(Boolean)
    .join("\n");
  return inner ? `${pad}<${spec.tag}${attrs}${st}>\n${inner}\n${pad}</${spec.tag}>` : `${pad}<${spec.tag}${attrs}${st} />`;
}

export function nodeJsx(node: BNode, depth = 0): string {
  return jsxOf(specWithNode(node), node.children, depth);
}

export function pageReact(page: BPage): string {
  const name = (page.name.replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : "")).replace(/^./, (c) => c.toUpperCase()) || "Page") + "Page";
  return `import "./site.css";

export default function ${/^[A-Z]/.test(name) ? name : `P${name}`}() {
  return (
    <div className="site">
${nodeJsx(page.root, 3)}
    </div>
  );
}
`;
}
