import { registry, type AppFunction } from "../../lib/registry";
import { downloadBlob, downloadText, pickFile, slugify } from "../../lib/download";
import { toast } from "../../lib/ui";
import { projectsApi } from "../../lib/projects";
import { useStudio } from "./store";
import { exportScene, readModelFile, snapshotPng } from "./io";
import { SCENE_PRESETS } from "./presets";
import { LIBRARY, buildModel } from "./library";
import { ENVIRONMENTS, EASINGS, LIGHT_TYPES, MATERIAL_PRESETS, PRIMITIVES, SHAPES, SWATCHES, makeCamera, makeExtrude, makeGroup, makeLight, makePrimitive, type SceneObject, type Vec3 } from "./model";

const S = () => useStudio.getState();
const inStudio = () => window.location.pathname.startsWith("/studio");
const hasScene = () => (S().projectId ? true : "Open a 3D scene first");
const hasSel = () => (!S().projectId ? "Open a 3D scene first" : S().selectedId ? true : "Select an object first");
const hasMeshSel = () => {
  const r = hasSel();
  if (r !== true) return r;
  return S().selected()?.material ? true : "Select a mesh";
};
const studioKey = (fn: () => true | string) => () => (inStudio() ? fn() : "3D Studio not active");

function transform(id: string, title: string, fn: (o: SceneObject) => Partial<SceneObject>): AppFunction {
  return { id: `studio.transform.${id}`, title, category: "3D · Transform", when: hasSel, run: () => S().update(S().selectedId!, fn(S().selected()!)) };
}

async function ensureScene(ctx: { navigate: (p: string) => void; module: string }, name = "Untitled scene") {
  if (!S().projectId) {
    const p = await projectsApi.create(name, "scene3d");
    ctx.navigate(`/studio?project=${p.id}`);
    await S().open(p.id);
  } else if (ctx.module !== "studio") ctx.navigate(`/studio?project=${S().projectId}`);
}

export function registerStudioFunctions() {
  const fns: AppFunction[] = [];

  // Add objects
  for (const p of PRIMITIVES) fns.push({ id: `studio.add.${p}`, title: `Add ${p}`, category: "3D · Add", keywords: ["3d", "mesh", "primitive"], when: hasScene, run: () => S().add(makePrimitive(p)).id });
  for (const sh of SHAPES) fns.push({ id: `studio.add.shape-${sh}`, title: `Add extruded ${sh} (bevelled)`, category: "3D · Add", keywords: ["3d", "extrude", "bevel", "shape"], when: hasScene, run: () => S().add(makeExtrude(sh)).id });
  for (const l of LIGHT_TYPES) fns.push({ id: `studio.add.light-${l}`, title: `Add ${l} light`, category: "3D · Add", keywords: ["3d", "light", "lighting"], when: hasScene, run: () => S().add(makeLight(l)).id });
  fns.push(
    { id: "studio.add.camera", title: "Add camera", category: "3D · Add", when: hasScene, run: () => S().add(makeCamera()).id },
    { id: "studio.add.group", title: "Add empty group", category: "3D · Add", when: hasScene, run: () => S().add(makeGroup()).id },
    {
      id: "studio.import",
      title: "Import 3D model (GLB, GLTF, OBJ, FBX, STL)",
      category: "3D · File",
      ai: false,
      when: hasScene,
      run: async () => {
        const f = await pickFile(".glb,.gltf,.obj,.fbx,.stl");
        if (!f) return;
        const asset = await readModelFile(f);
        const assetId = S().addAsset(asset);
        S().add({ ...makeGroup({ name: asset.name }), kind: "mesh", geometry: { kind: "model", assetId }, castShadow: true, receiveShadow: true });
        toast(`Imported ${f.name}`, "success");
      },
    },
  );

  // 3D asset library (parametric, fully editable parts)
  for (const [id, def] of Object.entries(LIBRARY)) {
    fns.push({ id: `studio.library.${id}`, title: `Add model: ${def.name}`, category: "3D · Library", keywords: ["model", "asset", "library", id, def.name.toLowerCase()], when: hasScene, run: () => { const objs = buildModel(id, [(Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2]); S().addMany(objs); S().select(objs[0].id); return objs[0].id; } });
  }
  // Recording
  for (const format of ["webm", "gif"] as const) {
    fns.push({
      id: `studio.record.${format}`,
      title: `Record the viewport as ${format.toUpperCase()} (plays the timeline)`,
      category: "3D · Export",
      keywords: ["video", "record", "gif", "webm", "render", "animation"],
      ai: false,
      when: hasScene,
      run: async () => {
        const canvas = document.querySelector<HTMLCanvasElement>(".studio-viewport canvas");
        if (!canvas) throw new Error("Open the 3D viewport first");
        const { recordCanvas } = await import("../../lib/recorder");
        const seconds = Math.min(20, S().doc.settings.duration || 5);
        S().setTime(0);
        S().setPlaying(true);
        toast(`Recording ${seconds}s…`, "info");
        const blob = await recordCanvas(canvas, { seconds, format, fps: format === "gif" ? 15 : 30, maxSize: 540 });
        S().setPlaying(false);
        downloadBlob(`${slugify(S().projectName) || "scene"}.${format}`, blob);
        toast(`Saved ${format.toUpperCase()} (${Math.round(blob.size / 1024)} KB)`, "success");
      },
    });
  }

  // Lighting rigs
  fns.push(
    { id: "studio.rig.three-point", title: "Lighting rig: three-point", category: "3D · Lighting", when: hasScene, run: () => S().addMany([makeLight("directional", { name: "Key", position: [4, 5, 4], light: { type: "directional", color: "#fff4e6", groundColor: "#000", intensity: 2.4, distance: 0, angle: 30, penumbra: 0 } }), makeLight("directional", { name: "Fill", position: [-5, 3, 2], castShadow: false, light: { type: "directional", color: "#dfe8ff", groundColor: "#000", intensity: 0.8, distance: 0, angle: 30, penumbra: 0 } }), makeLight("directional", { name: "Rim", position: [0, 4, -6], castShadow: false, light: { type: "directional", color: "#ffffff", groundColor: "#000", intensity: 1.6, distance: 0, angle: 30, penumbra: 0 } })]) },
    { id: "studio.rig.softbox", title: "Lighting rig: studio softbox", category: "3D · Lighting", when: hasScene, run: () => { S().addMany([makeLight("spot", { name: "Softbox", position: [0, 6, 3], light: { type: "spot", color: "#ffffff", groundColor: "#000", intensity: 90, distance: 0, angle: 45, penumbra: 1 } }), makeLight("hemisphere", { name: "Bounce" })]); S().setSettings({ environment: "studio" }); } },
    { id: "studio.rig.sunset", title: "Lighting rig: golden hour", category: "3D · Lighting", when: hasScene, run: () => { S().add(makeLight("directional", { name: "Low sun", position: [-6, 2, -3], light: { type: "directional", color: "#ffb36b", groundColor: "#000", intensity: 3, distance: 0, angle: 30, penumbra: 0 } }), false); S().setSettings({ environment: "sunset", background: "#2a1424" }); } },
  );

  // Materials & colors
  for (const [k, v] of Object.entries(MATERIAL_PRESETS)) fns.push({ id: `studio.material.${k}`, title: `Material: ${v.name}`, category: "3D · Material", keywords: ["material", "pbr", "texture"], when: hasMeshSel, run: () => S().update(S().selectedId!, { material: { ...S().selected()!.material!, ...v.m } }) });
  for (const [k, c] of Object.entries(SWATCHES)) fns.push({ id: `studio.color.${k}`, title: `Color: ${k}`, category: "3D · Material", keywords: ["color", "colour"], when: hasMeshSel, run: () => S().update(S().selectedId!, { material: { ...S().selected()!.material!, color: c } }) });
  fns.push(
    { id: "studio.material.toggle-wireframe", title: "Toggle wireframe", category: "3D · Material", when: hasMeshSel, run: () => { const m = S().selected()!.material!; S().update(S().selectedId!, { material: { ...m, wireframe: !m.wireframe } }); } },
    { id: "studio.material.toggle-flat", title: "Toggle flat shading", category: "3D · Material", when: hasMeshSel, run: () => { const m = S().selected()!.material!; S().update(S().selectedId!, { material: { ...m, flatShading: !m.flatShading } }); } },
  );

  // Mesh editing
  const geo = () => S().selected()?.geometry;
  const subdividable = () => { const r = hasSel(); if (r !== true) return r; const g = geo(); return g && g.kind !== "model" ? true : "Select a primitive or extruded mesh"; };
  fns.push(
    { id: "studio.mesh.subdivide", title: "Subdivide (+1 level, Loop)", category: "3D · Mesh", keywords: ["smooth", "subdivision"], when: subdividable, run: () => { const g = geo()!; if (g.kind === "model") return; S().update(S().selectedId!, { geometry: { ...g, subdivision: Math.min(3, g.subdivision + 1) } }); } },
    { id: "studio.mesh.unsubdivide", title: "Reduce subdivision (−1 level)", category: "3D · Mesh", when: subdividable, run: () => { const g = geo()!; if (g.kind === "model") return; S().update(S().selectedId!, { geometry: { ...g, subdivision: Math.max(0, g.subdivision - 1) } }); } },
    { id: "studio.mesh.bevel-toggle", title: "Toggle bevel (extruded shapes)", category: "3D · Mesh", when: () => (geo()?.kind === "extrude" ? true : "Select an extruded shape"), run: () => { const g = geo()!; if (g.kind === "extrude") S().update(S().selectedId!, { geometry: { ...g, bevel: !g.bevel } }); } },
    { id: "studio.mesh.extrude-deeper", title: "Extrude deeper", category: "3D · Mesh", when: () => (geo()?.kind === "extrude" ? true : "Select an extruded shape"), run: () => { const g = geo()!; if (g.kind === "extrude") S().update(S().selectedId!, { geometry: { ...g, depth: Math.round((g.depth + 0.1) * 100) / 100 } }); } },
    { id: "studio.mesh.extrude-shallower", title: "Extrude shallower", category: "3D · Mesh", when: () => (geo()?.kind === "extrude" ? true : "Select an extruded shape"), run: () => { const g = geo()!; if (g.kind === "extrude") S().update(S().selectedId!, { geometry: { ...g, depth: Math.max(0.02, Math.round((g.depth - 0.1) * 100) / 100) } }); } },
  );

  // Transform
  const r = (v: number) => Math.round(v * 1000) / 1000;
  fns.push(
    transform("reset-position", "Reset position", () => ({ position: [0, 0, 0] })),
    transform("reset-rotation", "Reset rotation", () => ({ rotation: [0, 0, 0] })),
    transform("reset-scale", "Reset scale", () => ({ scale: [1, 1, 1] })),
    transform("reset-all", "Reset all transforms", () => ({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] })),
    transform("center", "Center on origin (keep height)", (o) => ({ position: [0, o.position[1], 0] })),
    transform("drop", "Drop to floor", (o) => ({ position: [o.position[0], 0.6 * o.scale[1], o.position[2]] })),
    transform("mirror-x", "Mirror X", (o) => ({ scale: [-o.scale[0], o.scale[1], o.scale[2]] })),
    transform("mirror-y", "Mirror Y", (o) => ({ scale: [o.scale[0], -o.scale[1], o.scale[2]] })),
    transform("mirror-z", "Mirror Z", (o) => ({ scale: [o.scale[0], o.scale[1], -o.scale[2]] })),
    transform("rotate-x90", "Rotate 90° on X", (o) => ({ rotation: [(o.rotation[0] + 90) % 360, o.rotation[1], o.rotation[2]] })),
    transform("rotate-y90", "Rotate 90° on Y", (o) => ({ rotation: [o.rotation[0], (o.rotation[1] + 90) % 360, o.rotation[2]] })),
    transform("rotate-z90", "Rotate 90° on Z", (o) => ({ rotation: [o.rotation[0], o.rotation[1], (o.rotation[2] + 90) % 360] })),
    transform("scale-up", "Scale up ×2", (o) => ({ scale: o.scale.map((v) => r(v * 2)) as Vec3 })),
    transform("scale-down", "Scale down ×0.5", (o) => ({ scale: o.scale.map((v) => r(v / 2)) as Vec3 })),
    { id: "studio.gizmo.move", title: "Gizmo: move", category: "3D · Transform", shortcut: "w", ai: false, when: studioKey(hasScene), run: () => S().setGizmo("translate") },
    { id: "studio.gizmo.rotate", title: "Gizmo: rotate", category: "3D · Transform", shortcut: "e", ai: false, when: studioKey(hasScene), run: () => S().setGizmo("rotate") },
    { id: "studio.gizmo.scale", title: "Gizmo: scale", category: "3D · Transform", shortcut: "r", ai: false, when: studioKey(hasScene), run: () => S().setGizmo("scale") },
    { id: "studio.gizmo.space", title: "Toggle gizmo space (world/local)", category: "3D · Transform", ai: false, when: hasScene, run: () => S().toggleSpace() },
    { id: "studio.gizmo.snap", title: "Toggle snapping", category: "3D · Transform", shortcut: "shift+s", ai: false, when: studioKey(hasScene), run: () => S().toggleSnap() },
  );

  // Edit
  fns.push(
    { id: "studio.undo", title: "Undo (3D)", category: "3D · Edit", shortcut: "mod+z", when: studioKey(() => (S().past.length ? true : "Nothing to undo")), run: () => S().undo() },
    { id: "studio.redo", title: "Redo (3D)", category: "3D · Edit", shortcut: "mod+shift+z", when: studioKey(() => (S().future.length ? true : "Nothing to redo")), run: () => S().redo() },
    { id: "studio.delete", title: "Delete selected object", category: "3D · Edit", shortcut: "delete", when: studioKey(hasSel), run: () => S().remove(S().selectedId!) },
    { id: "studio.duplicate", title: "Duplicate selected object", category: "3D · Edit", shortcut: "mod+d", when: studioKey(hasSel), run: () => S().duplicate(S().selectedId!)?.id },
    { id: "studio.deselect", title: "Deselect", category: "3D · Edit", shortcut: "esc", when: studioKey(hasSel), run: () => S().select(null) },
    { id: "studio.toggle-visibility", title: "Hide / show selected", category: "3D · Edit", shortcut: "h", when: studioKey(hasSel), run: () => S().update(S().selectedId!, { visible: !S().selected()!.visible }) },
    { id: "studio.toggle-shadow", title: "Toggle cast shadow", category: "3D · Edit", when: hasSel, run: () => S().update(S().selectedId!, { castShadow: !S().selected()!.castShadow }) },
    { id: "studio.save", title: "Save scene now", category: "3D · File", shortcut: "mod+s", when: studioKey(hasScene), run: () => S().saveNow().then(() => toast("Saved", "success")) },
  );

  // View
  const cam = (id: string, title: string, position: Vec3) => ({ id: `studio.view.${id}`, title: `View: ${title}`, category: "3D · View", when: hasScene, run: () => S().requestCamera({ position, target: [0, 0.5, 0] }) }) as AppFunction;
  fns.push(
    cam("front", "front", [0, 1.5, 9]), cam("top", "top", [0, 12, 0.001]), cam("right", "right", [9, 1.5, 0]), cam("perspective", "perspective", [5, 4, 7]),
    { id: "studio.view.frame", title: "Frame selection", category: "3D · View", shortcut: "f", when: studioKey(hasScene), run: () => S().requestCamera({ frameSelected: true }) },
    { id: "studio.view.grid", title: "Toggle grid", category: "3D · View", when: hasScene, run: () => S().setSettings({ showGrid: !S().doc.settings.showGrid }) },
    { id: "studio.view.axes", title: "Toggle axes", category: "3D · View", when: hasScene, run: () => S().setSettings({ showAxes: !S().doc.settings.showAxes }) },
    { id: "studio.view.shadows", title: "Toggle shadows", category: "3D · View", when: hasScene, run: () => S().setSettings({ shadows: !S().doc.settings.shadows }) },
    { id: "studio.view.fog", title: "Toggle fog", category: "3D · View", when: hasScene, run: () => S().setSettings({ fog: !S().doc.settings.fog }) },
    { id: "studio.view.stats", title: "Toggle performance stats", category: "3D · View", ai: false, when: hasScene, run: () => S().toggleStats() },
  );
  for (const e of ENVIRONMENTS) fns.push({ id: `studio.env.${e}`, title: `Environment: ${e}`, category: "3D · Scene", keywords: ["hdri", "reflections", "lighting"], when: hasScene, run: () => S().setSettings({ environment: e }) });
  for (const [k, c] of [["charcoal", "#15171f"], ["black", "#000000"], ["white", "#f4f4f6"], ["sand", "#f3eee7"], ["midnight", "#0b1430"], ["studio-grey", "#5b5f6b"]]) fns.push({ id: `studio.bg.${k}`, title: `Background: ${k}`, category: "3D · Scene", when: hasScene, run: () => S().setSettings({ background: c }) });

  // Animation
  fns.push(
    { id: "studio.anim.play", title: "Play / pause animation", category: "3D · Animation", shortcut: "space", when: studioKey(hasScene), run: () => S().setPlaying(!S().playing) },
    { id: "studio.anim.stop", title: "Stop and rewind", category: "3D · Animation", when: hasScene, run: () => (S().setPlaying(false), S().setTime(0)) },
    { id: "studio.anim.key", title: "Insert keyframe (transform)", category: "3D · Animation", shortcut: "k", when: studioKey(hasSel), run: () => S().keyObject(S().selectedId!) },
    { id: "studio.anim.key-opacity", title: "Insert opacity keyframe", category: "3D · Animation", when: hasMeshSel, run: () => S().keyObject(S().selectedId!, ["opacity"]) },
    { id: "studio.anim.delete-key", title: "Delete keyframe at playhead", category: "3D · Animation", when: hasSel, run: () => S().deleteKeyAt(S().selectedId!, S().time) },
    { id: "studio.anim.clear", title: "Clear animation of selected", category: "3D · Animation", when: hasSel, run: () => S().clearAnimation(S().selectedId!) },
    { id: "studio.anim.loop", title: "Toggle loop", category: "3D · Animation", when: hasScene, run: () => S().setSettings({ loop: !S().doc.settings.loop }) },
    { id: "studio.anim.autokey", title: "Toggle auto-key", category: "3D · Animation", when: hasScene, run: () => S().setAutoKey(!S().autoKey) },
    {
      id: "studio.anim.next-key",
      title: "Jump to next keyframe",
      category: "3D · Animation",
      when: hasScene,
      run: () => {
        const ts = S().doc.tracks.filter((t) => !S().selectedId || t.objectId === S().selectedId).flatMap((t) => t.keyframes.map((k) => k.t)).sort((a, b) => a - b);
        const n = ts.find((x) => x > S().time + 1e-3);
        if (n !== undefined) S().setTime(n);
      },
    },
    {
      id: "studio.anim.prev-key",
      title: "Jump to previous keyframe",
      category: "3D · Animation",
      when: hasScene,
      run: () => {
        const ts = S().doc.tracks.filter((t) => !S().selectedId || t.objectId === S().selectedId).flatMap((t) => t.keyframes.map((k) => k.t)).sort((a, b) => b - a);
        const p = ts.find((x) => x < S().time - 1e-3);
        if (p !== undefined) S().setTime(p);
      },
    },
    {
      id: "studio.anim.spin",
      title: "Animate: turntable spin (selected)",
      category: "3D · Animation",
      when: hasSel,
      run: () => {
        const o = S().selected()!;
        const d = S().doc.settings.duration;
        S().setKeyframes(o.id, "rotation", [{ t: 0, value: [...o.rotation], easing: "linear" }, { t: d, value: [o.rotation[0], o.rotation[1] + 360, o.rotation[2]], easing: "linear" }]);
      },
    },
    {
      id: "studio.anim.bounce",
      title: "Animate: bounce (selected)",
      category: "3D · Animation",
      when: hasSel,
      run: () => {
        const o = S().selected()!;
        const d = S().doc.settings.duration;
        const [x, y, z] = o.position;
        S().setKeyframes(o.id, "position", [{ t: 0, value: [x, y + 1.2, z], easing: "linear" }, { t: d / 2, value: [x, y, z], easing: "bounce" }, { t: d, value: [x, y + 1.2, z], easing: "easeOut" }]);
      },
    },
    {
      id: "studio.anim.fade-in",
      title: "Animate: fade in (selected)",
      category: "3D · Animation",
      when: hasMeshSel,
      run: () => S().setKeyframes(S().selectedId!, "opacity", [{ t: 0, value: [0], easing: "linear" }, { t: Math.min(1.5, S().doc.settings.duration), value: [1], easing: "easeOut" }]),
    },
    {
      id: "studio.anim.pop",
      title: "Animate: pop in (selected)",
      category: "3D · Animation",
      when: hasSel,
      run: () => {
        const o = S().selected()!;
        S().setKeyframes(o.id, "scale", [{ t: 0, value: [0.001, 0.001, 0.001], easing: "linear" }, { t: Math.min(0.8, S().doc.settings.duration), value: [...o.scale], easing: "back" }]);
      },
    },
  );
  for (const d of [2, 5, 10, 20]) fns.push({ id: `studio.anim.duration-${d}`, title: `Animation length: ${d}s`, category: "3D · Animation", when: hasScene, run: () => S().setSettings({ duration: d }) });
  for (const e of EASINGS) fns.push({ id: `studio.anim.ease-${e}`, title: `Easing: ${e} (key at playhead)`, category: "3D · Animation", when: hasSel, run: () => (S().setDefaultEasing(e), S().setEasingAt(S().selectedId!, S().time, e)) });

  // File / export
  for (const f of ["glb", "gltf", "obj", "stl"] as const) fns.push({ id: `studio.export.${f}`, title: `Export scene as ${f.toUpperCase()}`, category: "3D · File", ai: false, when: studioKey(hasScene), run: async () => {
    // The selection outline is a real mesh: deselect and let the viewport re-render so it isn't exported.
    S().select(null);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await exportScene(f, S().projectName);
  } });
  fns.push(
    { id: "studio.export.png", title: "Export PNG snapshot", category: "3D · File", ai: false, when: studioKey(hasScene), run: () => snapshotPng(S().projectName) },
    { id: "studio.export.json", title: "Export scene JSON", category: "3D · File", ai: false, when: hasScene, run: () => downloadText(`${slugify(S().projectName)}.scene.json`, JSON.stringify({ ...S().doc, assets: S().assets }, null, 2), "application/json") },
    { id: "studio.import.json", title: "Import scene JSON", category: "3D · File", ai: false, when: hasScene, run: async () => { const f = await pickFile(".json"); if (f) S().replaceScene(JSON.parse(await f.text())); } },
    { id: "studio.new", title: "New 3D scene", category: "3D · File", params: { type: "object", properties: { name: { type: "string" } } }, run: async (a, ctx) => { const p = await projectsApi.create(String(a.name ?? "Untitled scene"), "scene3d"); ctx.navigate(`/studio?project=${p.id}`); await S().open(p.id); return p.id; } },
  );
  for (const p of SCENE_PRESETS) {
    fns.push({ id: `studio.preset.${p.id}`, title: `Scene preset: ${p.name}`, category: "3D · Scene", keywords: ["template", "example", "3d"], run: async (_a, ctx) => { await ensureScene(ctx, p.name); S().replaceScene(p.build()); S().setPlaying(true); } });
  }

  registry.register(fns);
}

/** Camera, light and selection helpers. */
export function registerStudioExtraFunctions() {
  const isCam = () => (S().selected()?.camera ? true : "Select a camera");
  const isLight = () => (S().selected()?.light ? true : "Select a light");
  const fns: AppFunction[] = [];
  for (const [k, fov] of [["wide", 70], ["normal", 45], ["tele", 25]] as const) fns.push({ id: `studio.camera.fov-${k}`, title: `Camera lens: ${k} (${fov}°)`, category: "3D · Camera", when: isCam, run: () => S().update(S().selectedId!, { camera: { fov } }) });
  fns.push(
    { id: "studio.light.brighter", title: "Light: brighter (×1.5)", category: "3D · Lighting", when: isLight, run: () => { const l = S().selected()!.light!; S().update(S().selectedId!, { light: { ...l, intensity: Math.round(l.intensity * 150) / 100 } }); } },
    { id: "studio.light.dimmer", title: "Light: dimmer (×0.66)", category: "3D · Lighting", when: isLight, run: () => { const l = S().selected()!.light!; S().update(S().selectedId!, { light: { ...l, intensity: Math.round(l.intensity * 66) / 100 } }); } },
  );
  for (const [k, c] of [["warm", "#ffd2a1"], ["neutral", "#ffffff"], ["cool", "#cfe0ff"]] as const) fns.push({ id: `studio.light.${k}`, title: `Light color: ${k}`, category: "3D · Lighting", when: isLight, run: () => S().update(S().selectedId!, { light: { ...S().selected()!.light!, color: c } }) });
  for (const d of [1, -1] as const)
    fns.push({
      id: `studio.select.${d > 0 ? "next" : "previous"}`,
      title: `Select ${d > 0 ? "next" : "previous"} object`,
      category: "3D · Edit",
      shortcut: d > 0 ? "tab" : "shift+tab",
      when: () => (inStudio() && S().doc.objects.length ? true : "No objects"),
      run: () => {
        const objs = S().doc.objects;
        const i = objs.findIndex((o) => o.id === S().selectedId);
        S().select(objs[(i + d + objs.length) % objs.length].id);
      },
    });
  registry.register(fns);
}
