import type { Easing, Keyframe, Track } from "./model";

const c1 = 1.70158;
export const EASE: Record<Easing, (x: number) => number> = {
  linear: (x) => x,
  easeIn: (x) => x * x * x,
  easeOut: (x) => 1 - Math.pow(1 - x, 3),
  easeInOut: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  step: () => 0,
  back: (x) => 1 + (c1 + 1) * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2),
  elastic: (x) => (x === 0 || x === 1 ? x : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
  bounce: (x) => {
    const n1 = 7.5625, d1 = 2.75;
    if (x < 1 / d1) return n1 * x * x;
    if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
    if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
    return n1 * (x -= 2.625 / d1) * x + 0.984375;
  },
};

/** Value of a track at time t. The easing of the *destination* keyframe shapes each segment. */
export function sampleTrack(track: Track, t: number): number[] | null {
  const k = track.keyframes;
  if (!k.length) return null;
  if (t <= k[0].t) return k[0].value;
  const last = k[k.length - 1];
  if (t >= last.t) return last.value;
  let i = 0;
  while (i < k.length - 1 && k[i + 1].t < t) i++;
  const a = k[i], b = k[i + 1];
  const span = b.t - a.t || 1;
  const x = EASE[b.easing]((t - a.t) / span);
  return a.value.map((v, j) => v + ((b.value[j] ?? v) - v) * x);
}

export function upsertKeyframe(track: Track, kf: Keyframe, epsilon = 1 / 120) {
  const i = track.keyframes.findIndex((k) => Math.abs(k.t - kf.t) < epsilon);
  if (i >= 0) track.keyframes[i] = { ...kf, easing: kf.easing ?? track.keyframes[i].easing };
  else track.keyframes.push(kf);
  track.keyframes.sort((a, b) => a.t - b.t);
}

export function keyTimes(tracks: Track[], objectId?: string): number[] {
  const s = new Set<number>();
  for (const tr of tracks) if (!objectId || tr.objectId === objectId) for (const k of tr.keyframes) s.add(Math.round(k.t * 1000) / 1000);
  return [...s].sort((a, b) => a - b);
}
