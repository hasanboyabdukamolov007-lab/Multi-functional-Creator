import { n, newDoc, type BNode, type BuilderDoc } from "../builder/model";

/**
 * Turn an HTML page into a Builder document. Simple elements become real, editable components
 * (headings, paragraphs, images, buttons, sections); anything richer is kept exactly as Custom HTML,
 * so nothing is lost. Relative links and images are pointed at the repository's raw files.
 */
export function htmlToDoc(html: string, opts: { baseUrl: string; name: string; css?: string[] }): BuilderDoc {
  const dom = new DOMParser().parseFromString(html, "text/html");
  const abs = (u: string | null) => {
    if (!u || /^(https?:|data:|mailto:|tel:|#|\/\/)/i.test(u)) return u ?? "";
    try {
      return new URL(u, opts.baseUrl).href;
    } catch {
      return u;
    }
  };
  dom.querySelectorAll("[src]").forEach((e) => e.setAttribute("src", abs(e.getAttribute("src"))));
  dom.querySelectorAll("a[href]").forEach((e) => {
    const h = e.getAttribute("href")!;
    // Links between pages of the same site stay relative; files (pdf, images) point at the repo.
    if (!/\.html?($|[?#])/i.test(h) && !h.startsWith("#")) e.setAttribute("href", abs(h));
  });
  dom.querySelectorAll("script").forEach((s) => s.remove());

  const textOnly = (e: Element) => [...e.childNodes].every((c) => c.nodeType === 3 || (c.nodeType === 1 && /^(B|STRONG|EM|I|SPAN|BR)$/.test((c as Element).tagName)));
  const raw = (e: Element) => n("html", { html: e.outerHTML });
  const convert = (e: Element, depth: number): BNode => {
    const tag = e.tagName;
    const txt = (e.textContent ?? "").trim().replace(/\s+/g, " ");
    if (/^H[1-6]$/.test(tag) && textOnly(e)) return n("heading", { text: txt, level: Number(tag[1]) });
    if (tag === "P" && textOnly(e)) return n("text", { text: txt, size: "base" });
    if (tag === "IMG") return n("image", { src: e.getAttribute("src") ?? "", alt: e.getAttribute("alt") ?? "", rounded: false });
    if ((tag === "BUTTON" || (tag === "A" && /btn|button|cta/i.test(e.getAttribute("class") ?? ""))) && textOnly(e)) {
      return n("button", { text: txt, href: e.getAttribute("href") ?? "", variant: "primary", size: "md" });
    }
    // Page-level bands become Builder sections with their children converted, one level deep.
    if (depth === 0 && /^(SECTION|HEADER|FOOTER|MAIN|ARTICLE|DIV|NAV)$/.test(tag) && e.children.length > 0 && e.children.length <= 40) {
      return n("section", { tone: "default" }, [...e.children].map((c) => convert(c, depth + 1)));
    }
    return raw(e);
  };

  const doc = newDoc();
  const page = doc.pages[0];
  page.name = opts.name;
  page.title = dom.title || opts.name;
  const styles = [...dom.querySelectorAll("style")].map((s) => s.textContent ?? "").concat(opts.css ?? []).filter((s) => s.trim());
  const nodes: BNode[] = [];
  if (styles.length) nodes.push(n("html", { html: `<style>\n${styles.join("\n\n")}\n</style>` }));
  for (const el of [...dom.body.children]) {
    if (el.tagName === "STYLE" || el.tagName === "LINK") continue;
    nodes.push(convert(el, 0));
  }
  page.root.children = nodes;
  return doc;
}

/** Same-repo stylesheets a page links to, resolved to repository paths. */
export function linkedCss(html: string, pagePath: string): string[] {
  const dom = new DOMParser().parseFromString(html, "text/html");
  const dir = pagePath.includes("/") ? pagePath.slice(0, pagePath.lastIndexOf("/") + 1) : "";
  return [...dom.querySelectorAll('link[rel="stylesheet"][href]')]
    .map((l) => l.getAttribute("href")!)
    .filter((h) => !/^(https?:)?\/\//i.test(h))
    .map((h) => {
      const parts = (h.startsWith("/") ? h.slice(1) : dir + h).split("/");
      const out: string[] = [];
      for (const p of parts) p === ".." ? out.pop() : p !== "." && out.push(p);
      return out.join("/");
    });
}
