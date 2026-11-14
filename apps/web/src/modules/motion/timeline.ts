/** Keyframe timeline model, cubic-bezier easing and exporters (CSS @keyframes, Web Animations API). Pure + tested. */
export type Bezier = [number, number, number, number];
export type Prop = "x" | "y" | "scale" | "rotate" | "opacity";
export interface Key {
  t: number; // 0..1 of the duration
  v: number;
  ease: Bezier; // easing of the segment that starts at this key
}
export interface Anim {
  duration: number; // seconds
  loop: boolean;
  shape: "box" | "circle" | "text" | "emoji";
  label: string;
  color: string;
  tracks: Record<Prop, Key[]>;
}

export const EASES: Record<string, Bezier> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1],
  "out-expo": [0.16, 1, 0.3, 1],
  "in-out-back": [0.68, -0.6, 0.32, 1.6],
  overshoot: [0.34, 1.56, 0.64, 1],
};
export const DEFAULT_VALUE: Record<Prop, number> = { x: 0, y: 0, scale: 1, rotate: 0, opacity: 1 };
export const RANGE: Record<Prop, [number, number, number]> = { x: [-300, 300, 1], y: [-200, 200, 1], scale: [0, 3, 0.01], rotate: [-720, 720, 1], opacity: [0, 1, 0.01] };

/** y for a given x on a CSS cubic-bezier (Newton–Raphson with bisection fallback). */
export function bezierAt([x1, y1, x2, y2]: Bezier, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const cx = (t: number) => 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3;
  const cy = (t: number) => 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t * t * (1 - t) + t ** 3;
  const dx = (t: number) => 3 * x1 * (1 - t) ** 2 + 6 * (x2 - x1) * t * (1 - t) + 3 * (1 - x2) * t * t;
  let t = x;
  for (let i = 0; i < 8; i++) {
    const d = dx(t);
    if (Math.abs(d) < 1e-6) break;
    const e = cx(t) - x;
    if (Math.abs(e) < 1e-6) return cy(t);
    t -= e / d;
  }
  if (t < 0 || t > 1 || Math.abs(cx(t) - x) > 1e-4) {
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 40; i++) {
      if (cx(t) < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
  }
  return cy(t);
}

/** Value of one track at normalized time p (0..1). */
export function valueAt(keys: Key[], p: number, prop: Prop): number {
  if (!keys.length) return DEFAULT_VALUE[prop];
  const ks = [...keys].sort((a, b) => a.t - b.t);
  if (p <= ks[0].t) return ks[0].v;
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i];
    const b = ks[i + 1];
    if (p <= b.t) {
      const local = (p - a.t) / Math.max(1e-6, b.t - a.t);
      return a.v + (b.v - a.v) * bezierAt(a.ease, local);
    }
  }
  return ks[ks.length - 1].v;
}

export function sample(anim: Anim, p: number): Record<Prop, number> {
  return Object.fromEntries((Object.keys(anim.tracks) as Prop[]).map((k) => [k, valueAt(anim.tracks[k], p, k)])) as Record<Prop, number>;
}

const transform = (v: Record<Prop, number>) => `translate(${+v.x.toFixed(2)}px, ${+v.y.toFixed(2)}px) rotate(${+v.rotate.toFixed(2)}deg) scale(${+v.scale.toFixed(3)})`;
const bz = (e: Bezier) => `cubic-bezier(${e.map((n) => +n.toFixed(3)).join(", ")})`;

/**
 * CSS @keyframes. Tracks can have keys at different times, so we emit a stop at every distinct key time
 * plus intermediate samples, which keeps per-track easing exact enough for any browser.
 */
export function toCss(anim: Anim, name = "mfc-anim"): string {
  const times = new Set<number>();
  for (const k of Object.values(anim.tracks)) for (const key of k) times.add(+key.t.toFixed(4));
  for (let i = 0; i <= 20; i++) times.add(i / 20);
  const stops = [...times].sort((a, b) => a - b);
  const frames = stops.map((p) => {
    const v = sample(anim, p);
    return `  ${+(p * 100).toFixed(2)}% { transform: ${transform(v)}; opacity: ${+v.opacity.toFixed(3)}; }`;
  });
  return `@keyframes ${name} {\n${frames.join("\n")}\n}\n.${name} {\n  animation: ${name} ${anim.duration}s linear ${anim.loop ? "infinite" : "1 both"};\n}\n@media (prefers-reduced-motion: reduce) { .${name} { animation: none; } }`;
}

/** Web Animations API snippet (each track as its own animation so easings stay exact). */
export function toWaapi(anim: Anim): string {
  const lines = (Object.keys(anim.tracks) as Prop[])
    .filter((p) => anim.tracks[p].length > 1)
    .map((p) => {
      const ks = [...anim.tracks[p]].sort((a, b) => a.t - b.t);
      const cssProp = p === "opacity" ? "opacity" : p === "x" ? "translate" : p === "y" ? "translate" : p === "rotate" ? "rotate" : "scale";
      const val = (v: number) => (p === "opacity" ? v : p === "x" ? `${v}px 0` : p === "y" ? `0 ${v}px` : p === "rotate" ? `${v}deg` : v);
      const frames = ks.map((k, i) => `{ ${cssProp}: ${JSON.stringify(val(k.v))}, offset: ${+k.t.toFixed(4)}${i < ks.length - 1 ? `, easing: "${bz(k.ease)}"` : ""} }`).join(", ");
      return `el.animate([${frames}], { duration: ${Math.round(anim.duration * 1000)}, iterations: ${anim.loop ? "Infinity" : 1}, fill: "both", composite: "add" });`;
    });
  return `// const el = document.querySelector(".target");\nif (!matchMedia("(prefers-reduced-motion: reduce)").matches) {\n  ${lines.join("\n  ")}\n}`;
}

export const STARTER: Anim = {
  duration: 2.4,
  loop: true,
  shape: "box",
  label: "Hi!",
  color: "#6d5efc",
  tracks: {
    x: [{ t: 0, v: -160, ease: EASES["out-expo"] }, { t: 0.5, v: 160, ease: EASES["in-out-back"] }, { t: 1, v: -160, ease: EASES.linear }],
    y: [{ t: 0, v: 0, ease: EASES["ease-out"] }, { t: 0.25, v: -60, ease: EASES["ease-in"] }, { t: 0.5, v: 0, ease: EASES["ease-out"] }, { t: 0.75, v: -60, ease: EASES["ease-in"] }, { t: 1, v: 0, ease: EASES.linear }],
    scale: [{ t: 0, v: 1, ease: EASES.overshoot }, { t: 0.5, v: 1.3, ease: EASES["ease-in-out"] }, { t: 1, v: 1, ease: EASES.linear }],
    rotate: [{ t: 0, v: 0, ease: EASES["ease-in-out"] }, { t: 1, v: 360, ease: EASES.linear }],
    opacity: [{ t: 0, v: 1, ease: EASES.linear }],
  },
};
