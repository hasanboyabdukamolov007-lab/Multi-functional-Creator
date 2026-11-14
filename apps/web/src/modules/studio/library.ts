/**
 * 3D asset library: parametric models assembled from primitives (no downloads, fully editable,
 * every part is its own object under a named group).
 */
import { DEFAULT_MATERIAL, makeGroup, makePrimitive, type MaterialSpec, type PrimitiveType, type SceneObject, type Vec3 } from "./model";

type Part = [PrimitiveType, Vec3, Partial<Record<string, number>>, Partial<MaterialSpec>, Vec3?, Vec3?];
const M = (color: string, o: Partial<MaterialSpec> = {}): Partial<MaterialSpec> => ({ color, ...o });
const wood = M("#9a6b3f", { roughness: 0.7 });
const darkWood = M("#5b3a22", { roughness: 0.75 });
const metal = M("#c9ced6", { metalness: 1, roughness: 0.25 });
const leaf = M("#3f9b4f", { roughness: 0.85 });

export const LIBRARY: Record<string, { name: string; parts: Part[] }> = {
  tree: { name: "Tree", parts: [["cylinder", [0, 0.6, 0], { radiusTop: 0.12, radiusBottom: 0.18, height: 1.2 }, darkWood], ["icosahedron", [0, 1.6, 0], { radius: 0.75, detail: 1 }, leaf], ["icosahedron", [0.35, 1.35, 0.2], { radius: 0.45, detail: 1 }, leaf], ["icosahedron", [-0.3, 1.4, -0.2], { radius: 0.5, detail: 1 }, leaf]] },
  pine: { name: "Pine tree", parts: [["cylinder", [0, 0.3, 0], { radiusTop: 0.1, radiusBottom: 0.14, height: 0.6 }, darkWood], ["cone", [0, 0.95, 0], { radius: 0.7, height: 0.9 }, M("#2f7d45")], ["cone", [0, 1.45, 0], { radius: 0.52, height: 0.75 }, M("#2f7d45")], ["cone", [0, 1.9, 0], { radius: 0.34, height: 0.6 }, M("#2f7d45")]] },
  table: { name: "Table", parts: [["box", [0, 0.75, 0], { width: 1.6, height: 0.08, depth: 0.9 }, wood], ...([[-0.7, -0.38], [0.7, -0.38], [-0.7, 0.38], [0.7, 0.38]] as const).map(([x, z]): Part => ["box", [x, 0.36, z], { width: 0.08, height: 0.72, depth: 0.08 }, darkWood])] },
  chair: { name: "Chair", parts: [["box", [0, 0.45, 0], { width: 0.5, height: 0.06, depth: 0.5 }, wood], ["box", [0, 0.8, -0.22], { width: 0.5, height: 0.65, depth: 0.06 }, wood], ...([[-0.21, -0.21], [0.21, -0.21], [-0.21, 0.21], [0.21, 0.21]] as const).map(([x, z]): Part => ["cylinder", [x, 0.22, z], { radiusTop: 0.025, radiusBottom: 0.025, height: 0.44 }, darkWood])] },
  lamp: { name: "Desk lamp", parts: [["cylinder", [0, 0.03, 0], { radiusTop: 0.25, radiusBottom: 0.28, height: 0.06 }, metal], ["cylinder", [0, 0.5, 0], { radiusTop: 0.025, radiusBottom: 0.025, height: 0.95 }, metal], ["cone", [0, 1.0, 0], { radius: 0.32, height: 0.3 }, M("#f2a93b", { roughness: 0.4 }), [180, 0, 0]], ["sphere", [0, 0.92, 0], { radius: 0.08 }, M("#fff6d6", { emissive: "#ffd27a", emissiveIntensity: 2 })]] },
  house: { name: "House", parts: [["box", [0, 0.6, 0], { width: 1.6, height: 1.2, depth: 1.4 }, M("#efe6d8")], ["cone", [0, 1.55, 0], { radius: 1.25, height: 0.8, radialSegments: 4 }, M("#b4442e"), [0, 45, 0]], ["box", [0, 0.35, 0.71], { width: 0.35, height: 0.7, depth: 0.02 }, darkWood], ["box", [-0.5, 0.75, 0.71], { width: 0.3, height: 0.3, depth: 0.02 }, M("#9fd3ff", { metalness: 0.2, roughness: 0.1 })], ["box", [0.5, 0.75, 0.71], { width: 0.3, height: 0.3, depth: 0.02 }, M("#9fd3ff", { metalness: 0.2, roughness: 0.1 })]] },
  rocket: { name: "Rocket", parts: [["cylinder", [0, 1, 0], { radiusTop: 0.32, radiusBottom: 0.32, height: 1.4 }, M("#eef0f6", { metalness: 0.3, roughness: 0.3 })], ["cone", [0, 1.95, 0], { radius: 0.32, height: 0.5 }, M("#e5484d")], ["sphere", [0, 1.25, 0.3], { radius: 0.11 }, M("#5bc0eb", { metalness: 0.4, roughness: 0.1 })], ...([0, 120, 240] as const).map((a): Part => ["box", [Math.sin((a * Math.PI) / 180) * 0.38, 0.4, Math.cos((a * Math.PI) / 180) * 0.38], { width: 0.05, height: 0.45, depth: 0.3 }, M("#e5484d"), [0, a, 0]]), ["cone", [0, 0.15, 0], { radius: 0.2, height: 0.3 }, M("#ffb347", { emissive: "#ff7a00", emissiveIntensity: 2.5 }), [180, 0, 0]]] },
  snowman: { name: "Snowman", parts: [["sphere", [0, 0.5, 0], { radius: 0.5 }, M("#ffffff", { roughness: 0.9 })], ["sphere", [0, 1.15, 0], { radius: 0.36 }, M("#ffffff", { roughness: 0.9 })], ["sphere", [0, 1.65, 0], { radius: 0.26 }, M("#ffffff", { roughness: 0.9 })], ["cone", [0, 1.65, 0.3], { radius: 0.05, height: 0.25 }, M("#f28c28"), [90, 0, 0]], ["cylinder", [0, 1.95, 0], { radiusTop: 0.22, radiusBottom: 0.22, height: 0.3 }, M("#1c1c1c")]] },
  mushroom: { name: "Mushroom", parts: [["cylinder", [0, 0.3, 0], { radiusTop: 0.15, radiusBottom: 0.2, height: 0.6 }, M("#f4ecd8")], ["sphere", [0, 0.62, 0], { radius: 0.5, widthSegments: 48, heightSegments: 24 }, M("#d93a3a", { roughness: 0.5 }), undefined, [1, 0.55, 1]], ...([[0.2, 0.85, 0.2], [-0.25, 0.82, 0.05], [0.05, 0.9, -0.25]] as const).map(([x, y, z]): Part => ["sphere", [x, y, z], { radius: 0.07 }, M("#ffffff")])] },
  car: { name: "Toy car", parts: [["box", [0, 0.35, 0], { width: 1.6, height: 0.35, depth: 0.8 }, M("#2563eb", { metalness: 0.4, roughness: 0.3, clearcoat: 1 })], ["box", [-0.1, 0.65, 0], { width: 0.85, height: 0.3, depth: 0.7 }, M("#93c5fd", { metalness: 0.2, roughness: 0.05, transmission: 0.4 })], ...([[-0.5, 0.42], [0.5, 0.42], [-0.5, -0.42], [0.5, -0.42]] as const).map(([x, z]): Part => ["cylinder", [x, 0.18, z], { radiusTop: 0.18, radiusBottom: 0.18, height: 0.12 }, M("#1c1c1c", { roughness: 0.8 }), [90, 0, 0]])] },
  trophy: { name: "Trophy", parts: [["box", [0, 0.1, 0], { width: 0.6, height: 0.2, depth: 0.6 }, darkWood], ["cylinder", [0, 0.4, 0], { radiusTop: 0.06, radiusBottom: 0.12, height: 0.4 }, M("#e6b74a", { metalness: 1, roughness: 0.2 })], ["cylinder", [0, 0.85, 0], { radiusTop: 0.38, radiusBottom: 0.14, height: 0.5 }, M("#e6b74a", { metalness: 1, roughness: 0.2 })], ...([-1, 1] as const).map((s): Part => ["torus", [s * 0.4, 0.85, 0], { radius: 0.13, tube: 0.03 }, M("#e6b74a", { metalness: 1, roughness: 0.2 }), [0, 0, 90]])] },
  crystal: { name: "Crystal cluster", parts: ([[0, 0, 0, 1.2], [0.3, 0, 0.15, 0.8], [-0.25, 0, 0.2, 0.7], [0.1, 0, -0.3, 0.9]] as const).map(([x, y, z, h], i): Part => ["octahedron", [x, y + h * 0.5, z], { radius: 0.3, detail: 0 }, M(["#a78bfa", "#c4b5fd", "#8b5cf6", "#ddd6fe"][i], { transmission: 0.6, roughness: 0.05, metalness: 0.1 }), [0, i * 30, (i - 1.5) * 10], [0.6, h * 1.4, 0.6]]) },
  plant: { name: "Potted plant", parts: [["cylinder", [0, 0.25, 0], { radiusTop: 0.32, radiusBottom: 0.24, height: 0.5 }, M("#c2410c", { roughness: 0.8 })], ["cylinder", [0, 0.49, 0], { radiusTop: 0.29, radiusBottom: 0.29, height: 0.04 }, M("#4a3321")], ...([0, 60, 120, 180, 240, 300] as const).map((a): Part => ["capsule", [Math.sin((a * Math.PI) / 180) * 0.15, 0.85, Math.cos((a * Math.PI) / 180) * 0.15], { radius: 0.07, length: 0.55 }, leaf, [Math.cos((a * Math.PI) / 180) * 25, 0, -Math.sin((a * Math.PI) / 180) * 25]])] },
  bench: { name: "Park bench", parts: [...([0.42, 0.56] as const).map((y, i): Part => ["box", [0, y, i ? -0.18 : 0], { width: 1.8, height: 0.06, depth: i ? 0.06 : 0.45 }, wood, i ? [-12, 0, 0] : undefined]), ["box", [0, 0.75, -0.25], { width: 1.8, height: 0.3, depth: 0.05 }, wood, [-12, 0, 0]], ...([-0.8, 0.8] as const).map((x): Part => ["box", [x, 0.2, 0], { width: 0.06, height: 0.4, depth: 0.45 }, M("#2b2b2b", { metalness: 0.8, roughness: 0.4 })])] },
};

/** Build a library model as a group of editable parts, placed at `at`. */
export function buildModel(id: keyof typeof LIBRARY | string, at: Vec3 = [0, 0, 0]): SceneObject[] {
  const def = LIBRARY[id];
  if (!def) throw new Error(`Unknown model ${id}`);
  const group = makeGroup({ name: def.name, position: at });
  const parts = def.parts.map(([type, pos, params, mat, rot, scale], i) => {
    const p = makePrimitive(type, { name: `${def.name} part ${i + 1}`, parentId: group.id, position: pos, rotation: rot ?? [0, 0, 0], scale: scale ?? [1, 1, 1], material: { ...DEFAULT_MATERIAL, ...mat } });
    p.geometry = { ...(p.geometry as { kind: "primitive"; type: PrimitiveType; params: Record<string, number>; subdivision: number }), params: { ...(p.geometry as { params: Record<string, number> }).params, ...params } as Record<string, number> };
    return p;
  });
  return [group, ...parts];
}
