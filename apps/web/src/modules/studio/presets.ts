import { DEFAULT_MATERIAL, DEFAULT_SETTINGS, MATERIAL_PRESETS, makeExtrude, makeLight, makePrimitive, type SceneDoc } from "./model";

export interface ScenePreset {
  id: string;
  name: string;
  build: () => SceneDoc;
}

const mat = (k: keyof typeof MATERIAL_PRESETS, color?: string) => ({ ...DEFAULT_MATERIAL, ...MATERIAL_PRESETS[k].m, ...(color ? { color } : {}) });

export const SCENE_PRESETS: ScenePreset[] = [
  {
    id: "product-showcase",
    name: "Product showcase",
    build: () => {
      const pedestal = makePrimitive("cylinder", { name: "Pedestal", geometry: { kind: "primitive", type: "cylinder", params: { radiusTop: 1.2, radiusBottom: 1.3, height: 0.4, radialSegments: 64 }, subdivision: 0 }, position: [0, 0.2, 0], material: mat("ceramic", "#ece8e1") });
      const hero = makePrimitive("torusKnot", { name: "Hero object", position: [0, 1.55, 0], material: mat("gold") });
      const floor = makePrimitive("plane", { name: "Floor", geometry: { kind: "primitive", type: "plane", params: { width: 30, height: 30, segments: 1 }, subdivision: 0 }, material: { ...DEFAULT_MATERIAL, color: "#1a1c24", roughness: 0.95 }, castShadow: false });
      return {
        version: 1,
        objects: [floor, pedestal, hero, makeLight("spot", { name: "Key spot", position: [3, 6, 3], light: { type: "spot", color: "#ffffff", groundColor: "#000", intensity: 80, distance: 0, angle: 30, penumbra: 0.6 } }), makeLight("ambient", { name: "Fill", light: { type: "ambient", color: "#b9c4ff", groundColor: "#000", intensity: 0.25, distance: 0, angle: 30, penumbra: 0 } })],
        tracks: [{ objectId: hero.id, property: "rotation", keyframes: [{ t: 0, value: [0, 0, 0], easing: "linear" }, { t: 6, value: [0, 360, 0], easing: "linear" }] }, { objectId: hero.id, property: "position", keyframes: [{ t: 0, value: [0, 1.55, 0], easing: "easeInOut" }, { t: 3, value: [0, 1.8, 0], easing: "easeInOut" }, { t: 6, value: [0, 1.55, 0], easing: "easeInOut" }] }],
        settings: { ...DEFAULT_SETTINGS, background: "#101218", environment: "studio", duration: 6, fog: true },
      };
    },
  },
  {
    id: "solar-system",
    name: "Mini solar system",
    build: () => {
      const sun = makePrimitive("sphere", { name: "Sun", position: [0, 1.5, 0], scale: [1.4, 1.4, 1.4], material: mat("lava", "#ffb000"), castShadow: false });
      const planets = [
        { name: "Mercury", r: 2.2, size: 0.25, color: "#a8a39d", period: 3 },
        { name: "Earth", r: 3.4, size: 0.4, color: "#3b82f6", period: 6 },
        { name: "Mars", r: 4.6, size: 0.32, color: "#d1563b", period: 9 },
      ];
      const objs = [sun];
      const tracks: SceneDoc["tracks"] = [];
      for (const p of planets) {
        const o = makePrimitive("sphere", { name: p.name, scale: [p.size / 0.6, p.size / 0.6, p.size / 0.6], position: [p.r, 1.5, 0], material: { ...DEFAULT_MATERIAL, color: p.color, roughness: 0.7 } });
        objs.push(o);
        const kf = [];
        const steps = 12;
        for (let i = 0; i <= steps; i++) {
          const a = (i / steps) * Math.PI * 2;
          kf.push({ t: (9 * i) / steps, value: [Math.cos(a * (9 / p.period)) * p.r, 1.5, Math.sin(a * (9 / p.period)) * p.r], easing: "linear" as const });
        }
        tracks.push({ objectId: o.id, property: "position", keyframes: kf });
      }
      return { version: 1, objects: [...objs, makeLight("point", { name: "Sunlight", position: [0, 1.5, 0], light: { type: "point", color: "#ffd9a0", groundColor: "#000", intensity: 60, distance: 0, angle: 30, penumbra: 0 } }), makeLight("ambient", { name: "Space ambient", light: { type: "ambient", color: "#6070a0", groundColor: "#000", intensity: 0.15, distance: 0, angle: 30, penumbra: 0 } })], tracks, settings: { ...DEFAULT_SETTINGS, background: "#04050b", environment: "night", showGrid: false, duration: 9 } };
    },
  },
  {
    id: "abstract-composition",
    name: "Abstract composition",
    build: () => {
      const objs = [
        makePrimitive("plane", { name: "Floor", geometry: { kind: "primitive", type: "plane", params: { width: 30, height: 30, segments: 1 }, subdivision: 0 }, material: { ...DEFAULT_MATERIAL, color: "#efe9e1", roughness: 1 }, castShadow: false }),
        makePrimitive("sphere", { name: "Sphere", position: [-1.2, 0.6, 0.4], material: mat("glossyPlastic", "#e93d82") }),
        makePrimitive("box", { name: "Block", position: [0.6, 0.5, -0.6], rotation: [0, 30, 0], material: mat("mattePlastic", "#0090ff") }),
        makePrimitive("torus", { name: "Ring", position: [1.6, 0.8, 0.9], rotation: [70, 0, 20], material: mat("chrome") }),
        makeExtrude("star", { name: "Star", position: [-0.2, 1.8, -0.2], rotation: [0, 0, 12], material: mat("gold") }),
        makePrimitive("icosahedron", { name: "Gem", position: [0.2, 0.4, 1.4], scale: [0.6, 0.6, 0.6], material: mat("glass") }),
        makeLight("directional", { name: "Sun", position: [5, 8, 4] }),
        makeLight("hemisphere", { name: "Sky" }),
      ];
      return { version: 1, objects: objs, tracks: [], settings: { ...DEFAULT_SETTINGS, background: "#f3eee7", environment: "studio", showGrid: false } };
    },
  },
];
