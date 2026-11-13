/** Framework-neutral element description: rendered on the canvas, and serialized to HTML and JSX. */
export const SLOT = { slot: true } as const;
export type Child = Spec | typeof SLOT | string;
export interface Spec {
  tag: string;
  attrs?: Record<string, string | number | boolean | undefined>;
  style?: Record<string, string | number | undefined>;
  children?: Child[];
  /** Raw HTML (custom HTML component) — sandboxed on the canvas. */
  rawHtml?: string;
}

export const isSlot = (c: Child): c is typeof SLOT => typeof c === "object" && "slot" in c;

type HAttrs = Record<string, string | number | boolean | undefined | Record<string, string | number | undefined>>;

export function h(tag: string, attrs: HAttrs = {}, ...children: Child[]): Spec {
  const { style, ...rest } = attrs as Record<string, unknown>;
  return { tag, attrs: rest as Spec["attrs"], style: style as Spec["style"], children };
}

/** Split a multi-line prop into trimmed, non-empty lines. */
export const lines = (v: unknown): string[] =>
  String(v ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

/** Split "a|b|c" into parts. */
export const parts = (line: string, n: number): string[] => {
  const p = line.split("|").map((s) => s.trim());
  while (p.length < n) p.push("");
  return p;
};
