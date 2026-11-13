import { DEFAULT_MATERIAL, MATERIAL_PRESETS, PRIMITIVES, makeExtrude, makePrimitive, type SceneObject, type ShapeType, type Track, type Vec3 } from "../../studio/model";
import type { Anim, ObjectSpec } from "./planner";

const PALETTE = ["#5b4cf0", "#e93d82", "#0090ff", "#30a46c", "#ffc53d", "#f76b15", "#12a594", "#8e4ec6"];

export function objectsFromSpecs(specs: ObjectSpec[], layout: "row" | "circle" | "grid" | "stack", baseY: number): SceneObject[] {
  const flat: Array<ObjectSpec & { n: number }> = [];
  for (const s of specs) for (let i = 0; i < Math.max(1, Math.min(24, s.count)); i++) flat.push({ ...s, n: i });
  const total = flat.length;
  return flat.map((s, i) => {
    let position: Vec3;
    if (layout === "circle" && total > 1) {
      const r = Math.max(1.6, total * 0.42);
      const a = (i / total) * Math.PI * 2;
      position = [Math.cos(a) * r, baseY, Math.sin(a) * r];
    } else if (layout === "grid") {
      const cols = Math.ceil(Math.sqrt(total));
      position = [((i % cols) - (cols - 1) / 2) * 1.6, baseY, (Math.floor(i / cols) - (Math.ceil(total / cols) - 1) / 2) * 1.6];
    } else if (layout === "stack") {
      position = [0, baseY + i * 1.15, 0];
    } else {
      position = [(i - (total - 1) / 2) * 1.7, baseY, 0];
    }
    const sameShape = flat.filter((x) => x.shape === s.shape).length;
    const nth = flat.slice(0, i + 1).filter((x) => x.shape === s.shape).length;
    const name = `${s.shape.replace("shape-", "")}${sameShape > 1 ? ` ${nth}` : ""}`.replace(/^./, (ch) => ch.toUpperCase());
    const material = { ...DEFAULT_MATERIAL, color: s.color ?? (s.material ? DEFAULT_MATERIAL.color : PALETTE[i % PALETTE.length]), ...(s.material ? MATERIAL_PRESETS[s.material]?.m : {}), ...(s.material && s.color ? { color: s.color } : {}) };
    if (s.shape.startsWith("shape-")) return makeExtrude(s.shape.slice(6) as ShapeType, { name, position, material });
    const type = (PRIMITIVES as readonly string[]).includes(s.shape) ? (s.shape as (typeof PRIMITIVES)[number]) : "box";
    const flatShape = type === "plane" || type === "circle" || type === "ring";
    return makePrimitive(type, { name, position: flatShape ? [position[0], 0.01, position[2]] : position, material });
  });
}

/** Keyframe tracks for simple named animations, phase-shifted per object so groups feel alive. */
export function animationTracks(objs: SceneObject[], anims: Anim[], duration: number): Track[] {
  const tracks: Track[] = [];
  objs.forEach((o, i) => {
    const [x, y, z] = o.position;
    const phase = objs.length > 1 ? (i / objs.length) * duration * 0.25 : 0;
    for (const a of anims) {
      if (a === "spin") tracks.push({ objectId: o.id, property: "rotation", keyframes: [{ t: 0, value: [...o.rotation], easing: "linear" }, { t: duration, value: [o.rotation[0], o.rotation[1] + 360, o.rotation[2]], easing: "linear" }] });
      if (a === "bounce") tracks.push({ objectId: o.id, property: "position", keyframes: [{ t: 0, value: [x, y + 1.2, z], easing: "linear" }, { t: Math.min(duration, duration / 2 + phase), value: [x, y, z], easing: "bounce" }, { t: duration, value: [x, y + 1.2, z], easing: "easeOut" }] });
      if (a === "float") tracks.push({ objectId: o.id, property: "position", keyframes: [{ t: 0, value: [x, y, z], easing: "easeInOut" }, { t: duration / 2, value: [x, y + 0.35, z], easing: "easeInOut" }, { t: duration, value: [x, y, z], easing: "easeInOut" }] });
      if (a === "pop") tracks.push({ objectId: o.id, property: "scale", keyframes: [{ t: 0, value: [0.001, 0.001, 0.001], easing: "linear" }, { t: Math.min(duration, 0.2 + phase), value: [0.001, 0.001, 0.001], easing: "linear" }, { t: Math.min(duration, 0.9 + phase), value: [...o.scale], easing: "back" }] });
      if (a === "fade" && o.material) tracks.push({ objectId: o.id, property: "opacity", keyframes: [{ t: 0, value: [0], easing: "linear" }, { t: Math.min(duration, 1.5 + phase), value: [1], easing: "easeOut" }] });
    }
  });
  // Several animations on the same property: keep the last one (e.g. bounce + float).
  const seen = new Map<string, Track>();
  for (const t of tracks) seen.set(`${t.objectId}:${t.property}`, t);
  return [...seen.values()];
}
