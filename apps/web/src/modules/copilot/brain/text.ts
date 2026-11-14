/** Language-agnostic text helpers shared by retrieval, the classifier and the self-trainer. */

export const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’ʻʼ`´]/g, "'")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();

const STOP = new Set(
  (
    "a an the and or of to in on for with is are was be it this that these those what which who how why when where do does did can could should would will me my i you your we our us please about " +
    "va bilan uchun bu u nima qanday nega qachon qayerda menga men sen siz biz ham yoki edi emas kerak haqida " +
    "и в во на с со по для это что как почему когда где мне мой ты вы мы не ли бы или а же то о об про"
  ).split(" "),
);

export const tokens = (s: string): string[] =>
  normalize(s)
    .split(/[^\p{L}\p{N}#+.]+/u)
    .map((t) => t.replace(/^\.+|\.+$/g, ""))
    .filter((t) => t.length > 1 && !STOP.has(t));

/** Crude multilingual stemmer: Uzbek and Russian inflect at the end, so a 6-letter prefix is a good key. */
export const stem = (t: string) => (t.length > 6 ? t.slice(0, 6) : t);
export const stems = (s: string) => tokens(s).map(stem);

/** Character trigrams catch typos and inflections ("flexbx", "flexboxni"). */
export function trigrams(s: string): string[] {
  const out: string[] = [];
  for (const t of tokens(s)) {
    const w = `^${t}$`;
    for (let i = 0; i + 3 <= w.length; i++) out.push(w.slice(i, i + 3));
  }
  return out;
}

export function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Deterministic PRNG so experiments and self-tests are reproducible per seed. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}
export const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
