/**
 * Online multinomial Naive Bayes over word stems + character trigrams.
 * Classes are panel function ids. It is seeded from function titles/keywords and keeps learning from
 * (a) user feedback, (b) confirmed suggestions and (c) its own self-tests — all on the device.
 */
import { stems, trigrams } from "./text";

export interface NBState {
  classes: Record<string, { docs: number; total: number; f: Record<string, number> }>;
  docs: number;
  vocab: number;
}

export const emptyNB = (): NBState => ({ classes: {}, docs: 0, vocab: 0 });

const features = (text: string) => [...stems(text).map((s) => `w:${s}`), ...trigrams(text).map((t) => `c:${t}`)];

export function train(nb: NBState, text: string, label: string, weight = 1) {
  const c = (nb.classes[label] ??= { docs: 0, total: 0, f: {} });
  c.docs += weight;
  nb.docs += weight;
  for (const f of features(text)) {
    if (c.f[f] === undefined) nb.vocab++;
    c.f[f] = (c.f[f] ?? 0) + weight;
    c.total += weight;
  }
}

/** Remove a label's evidence for a text (when the user says a suggestion was wrong). */
export function untrain(nb: NBState, text: string, label: string, weight = 1) {
  const c = nb.classes[label];
  if (!c) return;
  c.docs = Math.max(0.1, c.docs - weight);
  for (const f of features(text)) {
    if (!c.f[f]) continue;
    c.f[f] = Math.max(0, c.f[f] - weight);
    c.total = Math.max(1, c.total - weight);
  }
}

export interface Prediction {
  label: string;
  p: number;
}

export function predict(nb: NBState, text: string, limit = 5, allowed?: Set<string>): Prediction[] {
  const fs = features(text);
  if (!fs.length || !nb.docs) return [];
  const V = Math.max(1, nb.vocab);
  const labels = Object.keys(nb.classes).filter((l) => !allowed || allowed.has(l));
  const scores = labels.map((l) => {
    const c = nb.classes[l];
    // Uniform-ish prior: functions shouldn't win just because they have many seed words.
    let s = Math.log((c.docs + 1) / (nb.docs + labels.length)) * 0.3;
    const denom = Math.log(c.total + V);
    let hits = 0;
    for (const f of fs) {
      const n = c.f[f] ?? 0;
      if (n) hits++;
      s += Math.log(n + 1) - denom;
    }
    return { label: l, s, hits };
  });
  const relevant = scores.filter((x) => x.hits > 0);
  if (!relevant.length) return [];
  const max = Math.max(...relevant.map((x) => x.s));
  const exp = relevant.map((x) => ({ label: x.label, e: Math.exp(x.s - max) }));
  const sum = exp.reduce((a, b) => a + b.e, 0);
  return exp.map((x) => ({ label: x.label, p: x.e / sum })).sort((a, b) => b.p - a.p).slice(0, limit);
}

/** Keep the model small: drop rare features from big classes. */
export function prune(nb: NBState, maxPerClass = 600) {
  for (const c of Object.values(nb.classes)) {
    const entries = Object.entries(c.f);
    if (entries.length <= maxPerClass) continue;
    entries.sort((a, b) => b[1] - a[1]);
    c.f = Object.fromEntries(entries.slice(0, maxPerClass));
    c.total = Object.values(c.f).reduce((a, b) => a + b, 0);
  }
  nb.vocab = new Set(Object.values(nb.classes).flatMap((c) => Object.keys(c.f))).size;
}
