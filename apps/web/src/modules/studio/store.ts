import { trackUnsaved } from "../../lib/guards";
import { create } from "zustand";
import { createAutosave, projectsApi } from "../../lib/projects";
import { toast } from "../../lib/ui";
import { ApiError } from "../../lib/api";
import { uid } from "../../lib/download";
import { upsertKeyframe } from "./animation";
import { isSceneDoc, newScene, type Asset, type Easing, type SceneDoc, type SceneObject, type SceneSettings, type Track, type TrackProp, type Vec3 } from "./model";

export type GizmoMode = "translate" | "rotate" | "scale";
export interface CameraRequest {
  position?: Vec3;
  target?: Vec3;
  frameSelected?: boolean;
  seq: number;
}

type SceneCore = Omit<SceneDoc, "assets">;

interface StudioState {
  projectId: string | null;
  projectName: string;
  loading: boolean;
  saveState: "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";
  /** Server version of the project last loaded/saved (optimistic concurrency). */
  version: number;
  doc: SceneCore;
  /** Imported model files, kept out of undo history (they can be large). */
  assets: Record<string, Asset>;
  selectedId: string | null;
  gizmo: GizmoMode;
  space: "world" | "local";
  snap: boolean;
  time: number;
  playing: boolean;
  autoKey: boolean;
  defaultEasing: Easing;
  past: SceneCore[];
  future: SceneCore[];
  lastCoalesce: { key: string; at: number } | null;
  cameraRequest: CameraRequest | null;
  showStats: boolean;

  selected: () => SceneObject | null;
  open: (projectId: string) => Promise<void>;
  mutate: (fn: (doc: SceneCore) => void, coalesceKey?: string) => void;
  select: (id: string | null) => void;
  add: (obj: SceneObject, select?: boolean) => SceneObject;
  addMany: (objs: SceneObject[]) => void;
  update: (id: string, patch: Partial<SceneObject> | ((o: SceneObject) => void), coalesceKey?: string) => void;
  remove: (id: string) => void;
  duplicate: (id: string) => SceneObject | null;
  setSettings: (s: Partial<SceneSettings>) => void;
  replaceScene: (doc: SceneDoc) => void;
  addAsset: (asset: Asset) => string;
  setGizmo: (m: GizmoMode) => void;
  toggleSpace: () => void;
  toggleSnap: () => void;
  setTime: (t: number) => void;
  setPlaying: (p: boolean) => void;
  setAutoKey: (v: boolean) => void;
  setDefaultEasing: (e: Easing) => void;
  keyObject: (id: string, props?: TrackProp[], t?: number) => void;
  setKeyframes: (objectId: string, property: TrackProp, keyframes: Track["keyframes"]) => void;
  deleteKeyAt: (id: string, t: number) => void;
  clearAnimation: (id: string) => void;
  setEasingAt: (id: string, t: number, e: Easing) => void;
  requestCamera: (r: Omit<CameraRequest, "seq">) => void;
  undo: () => void;
  redo: () => void;
  saveNow: () => Promise<void>;
  toggleStats: () => void;
}

let opening: { id: string; promise: Promise<void> } | null = null;
const autosave = createAutosave(1000);
const HISTORY = 80;

const propValue = (o: SceneObject, p: TrackProp): number[] => (p === "opacity" ? [o.material?.opacity ?? 1] : [...o[p]]);

export const useStudio = create<StudioState>((set, get) => {
  const persist = () => {
    if (!get().projectId || get().saveState === "conflict") return;
    set({ saveState: "dirty" });
    autosave.schedule(async () => {
      const { projectId, doc, assets } = get();
      if (!projectId) return;
      set({ saveState: "saving" });
      try {
        const r = await projectsApi.save(projectId, { data: { ...doc, assets }, baseVersion: get().version || undefined });
        set({ saveState: "saved", version: r.version });
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          set({ saveState: "conflict" });
          toast(e.message, "error");
        } else {
          set({ saveState: "error" });
          toast(`Save failed: ${(e as Error).message}`, "error");
        }
      }
    });
  };

  const empty = newScene();
  delete empty.assets;

  return {
    projectId: null,
    projectName: "",
    loading: false,
    saveState: "idle",
    version: 0,
    doc: empty,
    assets: {},
    selectedId: null,
    gizmo: "translate",
    space: "world",
    snap: false,
    time: 0,
    playing: false,
    autoKey: true,
    defaultEasing: "easeInOut",
    past: [],
    future: [],
    lastCoalesce: null,
    cameraRequest: null,
    showStats: false,

    selected: () => get().doc.objects.find((o) => o.id === get().selectedId) ?? null,

    open: (projectId) => {
      // Concurrent opens of the same project (e.g. a template action and the page mounting)
      // share one load, so a second load can't overwrite edits made after the first.
      if (opening?.id === projectId) return opening.promise;
      const load = async () => {
        await autosave.flush();
        set({ loading: true });
        try {
          const p = await projectsApi.get<SceneDoc>(projectId);
          let doc = p.data as SceneDoc;
          if (!isSceneDoc(doc)) {
            doc = newScene();
            p.version = (await projectsApi.save(projectId, { data: doc, baseVersion: p.version })).version;
          }
          const { assets = {}, ...core } = doc;
          set({ projectId, projectName: p.name, doc: core, assets, selectedId: null, past: [], future: [], time: 0, playing: false, saveState: "saved", version: p.version, loading: false });
        } catch (e) {
          set({ loading: false });
          throw e;
        }
      };
      const promise = load().finally(() => {
        if (opening?.promise === promise) opening = null;
      });
      opening = { id: projectId, promise };
      return promise;
    },

    mutate: (fn, coalesceKey) => {
      const prev = get().doc;
      const next = structuredClone(prev);
      fn(next);
      const now = Date.now();
      const last = get().lastCoalesce;
      const coalesce = !!coalesceKey && last?.key === coalesceKey && now - last.at < 1000;
      set({ doc: next, past: coalesce ? get().past : [...get().past, prev].slice(-HISTORY), future: [], lastCoalesce: coalesceKey ? { key: coalesceKey, at: now } : null });
      persist();
    },

    select: (selectedId) => set({ selectedId }),

    add: (obj, select = true) => {
      get().mutate((d) => d.objects.push(obj));
      if (select) set({ selectedId: obj.id });
      return obj;
    },
    addMany: (objs) => get().mutate((d) => d.objects.push(...objs)),

    update: (id, patch, coalesceKey) => {
      const exists = get().doc.objects.some((o) => o.id === id);
      if (!exists) throw new Error(`Object ${id} not found`);
      get().mutate((d) => {
        const o = d.objects.find((x) => x.id === id)!;
        if (typeof patch === "function") patch(o);
        else {
          const { material, light, geometry, camera, ...rest } = patch;
          Object.assign(o, rest);
          if (material) o.material = { ...(o.material ?? ({} as never)), ...material };
          if (light) o.light = { ...(o.light ?? ({} as never)), ...light };
          if (camera) o.camera = { ...(o.camera ?? { fov: 45 }), ...camera };
          if (geometry) o.geometry = { ...(o.geometry ?? {}), ...geometry } as never;
        }
      }, coalesceKey);
      // Auto-key transform edits on objects that are already animated.
      const st = get();
      if (st.autoKey && typeof patch === "object" && st.doc.tracks.some((t) => t.objectId === id)) {
        const changed = (["position", "rotation", "scale"] as TrackProp[]).filter((p) => p in patch);
        if ((patch as Partial<SceneObject>).material && "opacity" in ((patch as Partial<SceneObject>).material ?? {})) changed.push("opacity");
        if (changed.length) st.keyObject(id, changed);
      }
    },

    remove: (id) => {
      get().mutate((d) => {
        const doomed = new Set([id]);
        let grew = true;
        while (grew) {
          grew = false;
          for (const o of d.objects) if (o.parentId && doomed.has(o.parentId) && !doomed.has(o.id)) (doomed.add(o.id), (grew = true));
        }
        d.objects = d.objects.filter((o) => !doomed.has(o.id));
        d.tracks = d.tracks.filter((t) => !doomed.has(t.objectId));
      });
      if (get().selectedId === id) set({ selectedId: null });
    },

    duplicate: (id) => {
      const src = get().doc.objects.find((o) => o.id === id);
      if (!src) return null;
      const copy: SceneObject = { ...structuredClone(src), id: uid("obj"), name: `${src.name} copy`, position: [src.position[0] + 0.5, src.position[1], src.position[2] + 0.5] };
      get().mutate((d) => {
        d.objects.push(copy);
        for (const t of d.tracks.filter((x) => x.objectId === id)) d.tracks.push({ ...structuredClone(t), objectId: copy.id });
      });
      set({ selectedId: copy.id });
      return copy;
    },

    setSettings: (s) => get().mutate((d) => Object.assign(d.settings, s), `settings:${Object.keys(s).join(",")}`),

    replaceScene: (doc) => {
      if (!isSceneDoc(doc)) throw new Error("Not a valid scene");
      const { assets, ...core } = structuredClone(doc);
      get().mutate((d) => {
        d.objects = core.objects;
        d.tracks = core.tracks;
        d.settings = { ...d.settings, ...core.settings };
      });
      if (assets) set({ assets: { ...get().assets, ...assets } });
      set({ selectedId: null, time: 0 });
    },

    addAsset: (asset) => {
      const id = uid("asset");
      set({ assets: { ...get().assets, [id]: asset } });
      return id;
    },

    setGizmo: (gizmo) => set({ gizmo }),
    toggleSpace: () => set({ space: get().space === "world" ? "local" : "world" }),
    toggleSnap: () => set({ snap: !get().snap }),
    setTime: (t) => set({ time: Math.max(0, Math.min(get().doc.settings.duration, t)) }),
    setPlaying: (playing) => set({ playing }),
    setAutoKey: (autoKey) => set({ autoKey }),
    setDefaultEasing: (defaultEasing) => set({ defaultEasing }),

    keyObject: (id, props = ["position", "rotation", "scale"], t = get().time) => {
      const o = get().doc.objects.find((x) => x.id === id);
      if (!o) throw new Error(`Object ${id} not found`);
      get().mutate((d) => {
        for (const p of props) {
          if (p === "opacity" && !o.material) continue;
          let tr = d.tracks.find((x) => x.objectId === id && x.property === p);
          if (!tr) d.tracks.push((tr = { objectId: id, property: p, keyframes: [] }));
          upsertKeyframe(tr, { t: Math.round(t * 1000) / 1000, value: propValue(o, p), easing: get().defaultEasing });
        }
      }, `key:${id}:${t.toFixed(3)}`);
    },

    setKeyframes: (objectId, property, keyframes) => {
      if (!get().doc.objects.some((o) => o.id === objectId)) throw new Error(`Object ${objectId} not found`);
      get().mutate((d) => {
        d.tracks = d.tracks.filter((t) => !(t.objectId === objectId && t.property === property));
        if (keyframes.length) d.tracks.push({ objectId, property, keyframes: [...keyframes].sort((a, b) => a.t - b.t) });
        const maxT = Math.max(0, ...keyframes.map((k) => k.t));
        if (maxT > d.settings.duration) d.settings.duration = Math.ceil(maxT);
      });
    },

    deleteKeyAt: (id, t) =>
      get().mutate((d) => {
        for (const tr of d.tracks) if (tr.objectId === id) tr.keyframes = tr.keyframes.filter((k) => Math.abs(k.t - t) > 1 / 120);
        d.tracks = d.tracks.filter((tr) => tr.keyframes.length);
      }),

    clearAnimation: (id) => get().mutate((d) => (d.tracks = d.tracks.filter((t) => t.objectId !== id))),

    setEasingAt: (id, t, e) =>
      get().mutate((d) => {
        for (const tr of d.tracks) if (tr.objectId === id) for (const k of tr.keyframes) if (Math.abs(k.t - t) < 1 / 120) k.easing = e;
      }),

    requestCamera: (r) => set({ cameraRequest: { ...r, seq: (get().cameraRequest?.seq ?? 0) + 1 } }),

    undo: () => {
      const { past, doc, future } = get();
      if (!past.length) return;
      set({ doc: past[past.length - 1], past: past.slice(0, -1), future: [doc, ...future], lastCoalesce: null });
      persist();
    },
    redo: () => {
      const { past, doc, future } = get();
      if (!future.length) return;
      set({ doc: future[0], future: future.slice(1), past: [...past, doc], lastCoalesce: null });
      persist();
    },
    saveNow: async () => {
      persist();
      await autosave.flush();
    },
    toggleStats: () => set({ showStats: !get().showStats }),
  };
});

// Warn before closing the tab while edits are still on their way to the server.
trackUnsaved("studio", () => ["dirty", "saving", "error"].includes(useStudio.getState().saveState));
