import { uid } from "../../lib/download";

export type Vec3 = [number, number, number];
export const PRIMITIVES = ["box", "sphere", "cylinder", "cone", "torus", "torusKnot", "plane", "circle", "ring", "icosahedron", "dodecahedron", "octahedron", "tetrahedron", "capsule"] as const;
export type PrimitiveType = (typeof PRIMITIVES)[number];
export const SHAPES = ["star", "heart", "hexagon", "roundedRect", "arrow", "gear"] as const;
export type ShapeType = (typeof SHAPES)[number];
export const LIGHT_TYPES = ["ambient", "directional", "point", "spot", "hemisphere"] as const;
export type LightType = (typeof LIGHT_TYPES)[number];
export const EASINGS = ["linear", "easeIn", "easeOut", "easeInOut", "step", "back", "elastic", "bounce"] as const;
export type Easing = (typeof EASINGS)[number];
export const ENVIRONMENTS = ["studio", "sunset", "night", "warehouse", "none"] as const;
export type EnvironmentPreset = (typeof ENVIRONMENTS)[number];
export const TRACK_PROPS = ["position", "rotation", "scale", "opacity"] as const;
export type TrackProp = (typeof TRACK_PROPS)[number];

export type GeometrySpec =
  | { kind: "primitive"; type: PrimitiveType; params: Record<string, number>; subdivision: number }
  | { kind: "extrude"; shape: ShapeType; depth: number; bevel: boolean; bevelSize: number; bevelThickness: number; bevelSegments: number; subdivision: number }
  | { kind: "model"; assetId: string };

export interface MaterialSpec {
  color: string;
  metalness: number;
  roughness: number;
  emissive: string;
  emissiveIntensity: number;
  opacity: number;
  transmission: number;
  clearcoat: number;
  wireframe: boolean;
  flatShading: boolean;
}

export interface LightSpec {
  type: LightType;
  color: string;
  groundColor: string;
  intensity: number;
  distance: number;
  angle: number;
  penumbra: number;
}

export interface SceneObject {
  id: string;
  name: string;
  kind: "mesh" | "light" | "camera" | "group";
  parentId: string | null;
  geometry?: GeometrySpec;
  material?: MaterialSpec;
  light?: LightSpec;
  camera?: { fov: number };
  position: Vec3;
  /** Euler rotation in degrees (XYZ). */
  rotation: Vec3;
  scale: Vec3;
  visible: boolean;
  castShadow: boolean;
  receiveShadow: boolean;
}

export interface Keyframe {
  t: number;
  value: number[];
  easing: Easing;
}
export interface Track {
  objectId: string;
  property: TrackProp;
  keyframes: Keyframe[];
}

export interface SceneSettings {
  background: string;
  environment: EnvironmentPreset;
  envIntensity: number;
  showGrid: boolean;
  showAxes: boolean;
  shadows: boolean;
  fog: boolean;
  duration: number;
  fps: number;
  loop: boolean;
}

export interface Asset {
  name: string;
  format: "gltf" | "glb" | "obj" | "fbx" | "stl";
  dataUrl: string;
}

export interface SceneDoc {
  version: 1;
  objects: SceneObject[];
  tracks: Track[];
  settings: SceneSettings;
  assets?: Record<string, Asset>;
}

export const PRIMITIVE_DEFAULTS: Record<PrimitiveType, Record<string, number>> = {
  box: { width: 1, height: 1, depth: 1, segments: 1 },
  sphere: { radius: 0.6, widthSegments: 48, heightSegments: 32 },
  cylinder: { radiusTop: 0.5, radiusBottom: 0.5, height: 1.2, radialSegments: 48 },
  cone: { radius: 0.6, height: 1.2, radialSegments: 48 },
  torus: { radius: 0.6, tube: 0.22, radialSegments: 32, tubularSegments: 96 },
  torusKnot: { radius: 0.5, tube: 0.16, tubularSegments: 160, radialSegments: 24, p: 2, q: 3 },
  plane: { width: 2, height: 2, segments: 1 },
  circle: { radius: 0.8, segments: 64 },
  ring: { innerRadius: 0.4, outerRadius: 0.8, segments: 64 },
  icosahedron: { radius: 0.7, detail: 0 },
  dodecahedron: { radius: 0.7, detail: 0 },
  octahedron: { radius: 0.7, detail: 0 },
  tetrahedron: { radius: 0.8, detail: 0 },
  capsule: { radius: 0.35, length: 0.8, capSegments: 12, radialSegments: 32 },
};

export const DEFAULT_MATERIAL: MaterialSpec = { color: "#8b7cff", metalness: 0.1, roughness: 0.45, emissive: "#000000", emissiveIntensity: 1, opacity: 1, transmission: 0, clearcoat: 0, wireframe: false, flatShading: false };

export const MATERIAL_PRESETS: Record<string, { name: string; m: Partial<MaterialSpec> }> = {
  gold: { name: "Gold", m: { color: "#e6b74a", metalness: 1, roughness: 0.22 } },
  silver: { name: "Silver", m: { color: "#d9dde3", metalness: 1, roughness: 0.18 } },
  copper: { name: "Copper", m: { color: "#d07d52", metalness: 1, roughness: 0.28 } },
  bronze: { name: "Bronze", m: { color: "#a9713f", metalness: 1, roughness: 0.38 } },
  chrome: { name: "Chrome", m: { color: "#ffffff", metalness: 1, roughness: 0.02 } },
  brushedSteel: { name: "Brushed steel", m: { color: "#b8bec7", metalness: 1, roughness: 0.48 } },
  glossyPlastic: { name: "Glossy plastic", m: { metalness: 0, roughness: 0.12, clearcoat: 0.8 } },
  mattePlastic: { name: "Matte plastic", m: { metalness: 0, roughness: 0.7, clearcoat: 0 } },
  rubber: { name: "Rubber", m: { color: "#222428", metalness: 0, roughness: 0.92 } },
  glass: { name: "Clear glass", m: { color: "#ffffff", metalness: 0, roughness: 0.02, transmission: 1, opacity: 1 } },
  frostedGlass: { name: "Frosted glass", m: { color: "#eef4ff", metalness: 0, roughness: 0.35, transmission: 0.9 } },
  ceramic: { name: "Ceramic", m: { color: "#f4f1ea", metalness: 0, roughness: 0.25, clearcoat: 1 } },
  clay: { name: "Clay", m: { color: "#c9b6a3", metalness: 0, roughness: 1 } },
  wood: { name: "Walnut (tint)", m: { color: "#6b4a2f", metalness: 0, roughness: 0.65 } },
  neon: { name: "Neon glow", m: { color: "#00e5ff", emissive: "#00e5ff", emissiveIntensity: 2.5, metalness: 0, roughness: 0.4 } },
  lava: { name: "Lava glow", m: { color: "#ff4d00", emissive: "#ff2a00", emissiveIntensity: 1.8, roughness: 0.6 } },
  jade: { name: "Jade", m: { color: "#3fa77a", metalness: 0, roughness: 0.2, transmission: 0.35, clearcoat: 0.6 } },
  pearl: { name: "Pearl", m: { color: "#f5efe6", metalness: 0.2, roughness: 0.18, clearcoat: 1 } },
  carbon: { name: "Carbon", m: { color: "#1b1d22", metalness: 0.4, roughness: 0.35, clearcoat: 1 } },
  ice: { name: "Ice", m: { color: "#cfefff", metalness: 0, roughness: 0.08, transmission: 0.8 } },
  velvet: { name: "Velvet", m: { color: "#6d1a36", metalness: 0, roughness: 1 } },
  hologram: { name: "Hologram", m: { color: "#7cf7ff", emissive: "#3d7bff", emissiveIntensity: 0.8, opacity: 0.55, metalness: 0.2, roughness: 0.2 } },
  wireframe: { name: "Wireframe", m: { wireframe: true, color: "#8b7cff" } },
  toon: { name: "Flat / low-poly", m: { flatShading: true, roughness: 0.8, metalness: 0 } },
};

export const SWATCHES: Record<string, string> = {
  white: "#f5f5f7", black: "#16171b", red: "#e5484d", orange: "#f76b15", yellow: "#ffc53d", green: "#30a46c", teal: "#12a594", blue: "#0090ff", indigo: "#5b4cf0", purple: "#8e4ec6", pink: "#e93d82", grey: "#8b8d98", brown: "#a1734e", sky: "#7ce2fe", lime: "#bdee63", navy: "#1e2a5a",
};

export const DEFAULT_SETTINGS: SceneSettings = { background: "#15171f", environment: "studio", envIntensity: 1, showGrid: true, showAxes: false, shadows: true, fog: false, duration: 5, fps: 30, loop: true };

const base = (o: Partial<SceneObject> & Pick<SceneObject, "kind" | "name">): SceneObject => ({
  id: uid("obj"),
  parentId: null,
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
  visible: true,
  castShadow: true,
  receiveShadow: true,
  ...o,
});

export function makePrimitive(type: PrimitiveType, o: Partial<SceneObject> = {}): SceneObject {
  const lift = type === "plane" || type === "circle" || type === "ring" ? 0 : 0.6;
  const flat = type === "plane" || type === "circle" || type === "ring";
  return base({
    kind: "mesh",
    name: type[0].toUpperCase() + type.slice(1),
    geometry: { kind: "primitive", type, params: { ...PRIMITIVE_DEFAULTS[type] }, subdivision: 0 },
    material: { ...DEFAULT_MATERIAL },
    position: [0, lift, 0],
    rotation: flat ? [-90, 0, 0] : [0, 0, 0],
    ...o,
  });
}

export function makeExtrude(shape: ShapeType, o: Partial<SceneObject> = {}): SceneObject {
  return base({
    kind: "mesh",
    name: shape[0].toUpperCase() + shape.slice(1),
    geometry: { kind: "extrude", shape, depth: 0.3, bevel: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 4, subdivision: 0 },
    material: { ...DEFAULT_MATERIAL },
    position: [0, 0.8, 0],
    ...o,
  });
}

export function makeLight(type: LightType, o: Partial<SceneObject> = {}): SceneObject {
  const pos: Record<LightType, Vec3> = { ambient: [0, 3, 0], directional: [4, 6, 3], point: [2, 3, 2], spot: [-3, 5, 3], hemisphere: [0, 5, 0] };
  return base({
    kind: "light",
    name: `${type[0].toUpperCase() + type.slice(1)} light`,
    light: { type, color: "#ffffff", groundColor: "#3a3530", intensity: type === "ambient" ? 0.4 : type === "hemisphere" ? 0.6 : type === "directional" ? 2 : 20, distance: 0, angle: 35, penumbra: 0.4 },
    position: pos[type],
    castShadow: type === "directional" || type === "spot",
    receiveShadow: false,
    ...o,
  });
}

export function makeCamera(o: Partial<SceneObject> = {}): SceneObject {
  return base({ kind: "camera", name: "Camera", camera: { fov: 45 }, position: [4, 3, 6], rotation: [-20, 33, 0], castShadow: false, receiveShadow: false, ...o });
}

export function makeGroup(o: Partial<SceneObject> = {}): SceneObject {
  return base({ kind: "group", name: "Group", castShadow: false, receiveShadow: false, ...o });
}

export function newScene(): SceneDoc {
  const floor = makePrimitive("plane", { name: "Floor", geometry: { kind: "primitive", type: "plane", params: { width: 12, height: 12, segments: 1 }, subdivision: 0 }, material: { ...DEFAULT_MATERIAL, color: "#2a2d38", roughness: 0.9 }, castShadow: false });
  const cube = makePrimitive("box", { name: "Cube", material: { ...DEFAULT_MATERIAL } });
  return { version: 1, objects: [floor, cube, makeLight("directional", { name: "Key light" }), makeLight("ambient", { name: "Fill light" })], tracks: [], settings: { ...DEFAULT_SETTINGS } };
}

export function isSceneDoc(d: unknown): d is SceneDoc {
  const o = d as SceneDoc;
  return !!o && Array.isArray(o.objects) && Array.isArray(o.tracks) && !!o.settings;
}
