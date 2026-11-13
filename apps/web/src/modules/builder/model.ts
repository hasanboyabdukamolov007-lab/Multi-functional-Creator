import { uid } from "../../lib/download";

export interface BNode {
  id: string;
  type: string;
  props: Record<string, unknown>;
  style: Record<string, string>;
  children: BNode[];
}

export interface SiteTokens {
  primary: string;
  primaryText: string;
  bg: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  radius: string;
  font: string;
  headingFont: string;
  maxWidth: string;
  /** Optional corner radius for all buttons (falls back to a fraction of radius). */
  buttonRadius?: string;
}

export interface BPage {
  id: string;
  name: string;
  path: string;
  title: string;
  root: BNode;
}

export interface BuilderDoc {
  version: 1;
  pages: BPage[];
  tokens: SiteTokens;
}

export const DEFAULT_TOKENS: SiteTokens = {
  primary: "#5b4cf0",
  primaryText: "#ffffff",
  bg: "#ffffff",
  surface: "#f6f7fb",
  text: "#14161f",
  muted: "#5f6677",
  border: "#e3e6ee",
  radius: "12px",
  font: `"Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`,
  headingFont: `"Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`,
  maxWidth: "1120px",
};

export function newPage(name = "Home", path = "/"): BPage {
  return { id: uid("page"), name, path, title: name, root: { id: uid("root"), type: "page", props: {}, style: {}, children: [] } };
}

export function newDoc(): BuilderDoc {
  return { version: 1, pages: [newPage()], tokens: { ...DEFAULT_TOKENS } };
}

/** Shorthand used by templates and the copilot: n("heading", { text: "Hi" }, [], { color: "red" }). */
export function n(type: string, props: Record<string, unknown> = {}, children: BNode[] = [], style: Record<string, string> = {}): BNode {
  return { id: uid(), type, props, style, children };
}

export function walk(node: BNode, fn: (n: BNode, parent: BNode | null, index: number) => void, parent: BNode | null = null, index = 0) {
  fn(node, parent, index);
  node.children.forEach((c, i) => walk(c, fn, node, i));
}

export function findNode(root: BNode, id: string): { node: BNode; parent: BNode | null; index: number } | null {
  let hit: { node: BNode; parent: BNode | null; index: number } | null = null;
  walk(root, (n, parent, index) => {
    if (!hit && n.id === id) hit = { node: n, parent, index };
  });
  return hit;
}

export function pathTo(root: BNode, id: string): BNode[] {
  const path: BNode[] = [];
  const rec = (n: BNode): boolean => {
    path.push(n);
    if (n.id === id) return true;
    for (const c of n.children) if (rec(c)) return true;
    path.pop();
    return false;
  };
  return rec(root) ? path : [];
}

export function cloneWithNewIds(node: BNode): BNode {
  return { ...node, id: uid(), props: structuredClone(node.props), style: { ...node.style }, children: node.children.map(cloneWithNewIds) };
}

/** Normalize untrusted node input (from the code editor or the copilot): fill ids/defaults, drop unknown types. */
export function normalizeNode(input: unknown, known: (type: string) => boolean, path = "node"): BNode {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error(`${path} must be an object`);
  const o = input as Record<string, unknown>;
  if (typeof o.type !== "string" || !known(o.type)) throw new Error(`${path}.type "${String(o.type)}" is not a known component`);
  const props = o.props && typeof o.props === "object" && !Array.isArray(o.props) ? (o.props as Record<string, unknown>) : {};
  const styleIn = o.style && typeof o.style === "object" && !Array.isArray(o.style) ? (o.style as Record<string, unknown>) : {};
  const style: Record<string, string> = {};
  for (const [k, v] of Object.entries(styleIn)) if (typeof v === "string" || typeof v === "number") style[k] = String(v);
  const children = Array.isArray(o.children) ? o.children.map((c, i) => normalizeNode(c, known, `${path}.children[${i}]`)) : [];
  return { id: typeof o.id === "string" && /^[\w-]{1,64}$/.test(o.id) ? o.id : uid(), type: o.type, props, style, children };
}

/** Ensure every id in a tree is unique (duplicates get fresh ids). */
export function dedupeIds(root: BNode) {
  const seen = new Set<string>();
  walk(root, (n) => {
    if (seen.has(n.id)) n.id = uid();
    seen.add(n.id);
  });
}
