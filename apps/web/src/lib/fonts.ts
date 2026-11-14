/** Curated Google Fonts (all support Latin; ✓cyr = Cyrillic for Russian/Uzbek Cyrillic). */
export const FONTS: Array<{ name: string; kind: "sans" | "serif" | "display" | "mono"; cyrillic: boolean }> = [
  { name: "Inter", kind: "sans", cyrillic: true },
  { name: "Manrope", kind: "sans", cyrillic: true },
  { name: "Montserrat", kind: "sans", cyrillic: true },
  { name: "Roboto", kind: "sans", cyrillic: true },
  { name: "Open Sans", kind: "sans", cyrillic: true },
  { name: "Rubik", kind: "sans", cyrillic: true },
  { name: "Nunito", kind: "sans", cyrillic: true },
  { name: "Raleway", kind: "sans", cyrillic: true },
  { name: "PT Sans", kind: "sans", cyrillic: true },
  { name: "Exo 2", kind: "sans", cyrillic: true },
  { name: "Onest", kind: "sans", cyrillic: true },
  { name: "Unbounded", kind: "display", cyrillic: true },
  { name: "Poppins", kind: "sans", cyrillic: false },
  { name: "DM Sans", kind: "sans", cyrillic: false },
  { name: "Space Grotesk", kind: "sans", cyrillic: false },
  { name: "Outfit", kind: "sans", cyrillic: false },
  { name: "Sora", kind: "sans", cyrillic: false },
  { name: "Work Sans", kind: "sans", cyrillic: false },
  { name: "Playfair Display", kind: "serif", cyrillic: true },
  { name: "Lora", kind: "serif", cyrillic: true },
  { name: "Merriweather", kind: "serif", cyrillic: true },
  { name: "PT Serif", kind: "serif", cyrillic: true },
  { name: "Fraunces", kind: "serif", cyrillic: false },
  { name: "DM Serif Display", kind: "display", cyrillic: false },
  { name: "Bebas Neue", kind: "display", cyrillic: false },
  { name: "JetBrains Mono", kind: "mono", cyrillic: true },
  { name: "Fira Code", kind: "mono", cyrillic: true },
];
const NAMES = new Set(FONTS.map((f) => f.name));
const fallback = (kind: string) => (kind === "serif" ? "Georgia, serif" : kind === "mono" ? "ui-monospace, monospace" : "ui-sans-serif, system-ui, sans-serif");
/** CSS font-family value for a curated font. */
export const fontStack = (name: string) => `"${name}", ${fallback(FONTS.find((f) => f.name === name)?.kind ?? "sans")}`;
/** First family in a CSS font-family list. */
export const firstFamily = (stack: string) => stack.split(",")[0].replace(/["']/g, "").trim();
/** Google Fonts stylesheet URL for the curated fonts used by these stacks (or null). */
export function googleFontsHref(...stacks: string[]): string | null {
  const used = [...new Set(stacks.map(firstFamily).filter((n) => NAMES.has(n)))];
  if (!used.length) return null;
  const subset = used.some((n) => FONTS.find((f) => f.name === n)?.cyrillic) ? "" : "";
  return `https://fonts.googleapis.com/css2?${used.map((n) => `family=${encodeURIComponent(n).replace(/%20/g, "+")}:wght@400;500;600;700;800`).join("&")}&display=swap${subset}`;
}
let loaded = new Set<string>();
/** Load a curated font into this page for previews. */
export function loadFont(name: string) {
  if (loaded.has(name) || !NAMES.has(name)) return;
  loaded = new Set([...loaded, name]);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = googleFontsHref(fontStack(name))!;
  document.head.appendChild(link);
}
