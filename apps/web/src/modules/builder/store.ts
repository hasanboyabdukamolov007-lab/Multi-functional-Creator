import { trackUnsaved } from "../../lib/guards";
import { create } from "zustand";
import { createAutosave, projectsApi } from "../../lib/projects";
import { toast } from "../../lib/ui";
import { ApiError } from "../../lib/api";
import { uid } from "../../lib/download";
import { CATALOG_MAP, defFor, isKnownType } from "./catalog";
import { cloneWithNewIds, dedupeIds, findNode, n, newDoc, newPage, normalizeNode, type BNode, type BPage, type BuilderDoc, type SiteTokens } from "./model";

export type Device = "desktop" | "tablet" | "mobile";
export const DEVICE_WIDTH: Record<Device, number | null> = { desktop: null, tablet: 820, mobile: 390 };

interface BuilderState {
  projectId: string | null;
  projectName: string;
  projectKind: string;
  loading: boolean;
  saveState: "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";
  /** Server version of the project last loaded/saved (optimistic concurrency). */
  version: number;
  doc: BuilderDoc;
  pageId: string;
  selectedId: string | null;
  device: Device;
  zoom: number;
  outlines: boolean;
  codeOpen: boolean;
  past: BuilderDoc[];
  future: BuilderDoc[];
  clipboard: BNode | null;
  lastCoalesce: { key: string; at: number } | null;

  page: () => BPage;
  selected: () => BNode | null;
  open: (projectId: string) => Promise<void>;
  close: () => void;
  mutate: (fn: (doc: BuilderDoc, page: BPage) => void, coalesceKey?: string) => void;
  select: (id: string | null) => void;
  insert: (input: string | BNode, opts?: { parentId?: string; index?: number }) => BNode;
  update: (id: string, patch: { props?: Record<string, unknown>; style?: Record<string, string | null> }, coalesceKey?: string) => void;
  remove: (id: string) => void;
  duplicate: (id: string) => void;
  move: (id: string, dir: -1 | 1) => void;
  moveTo: (id: string, parentId: string, index: number) => void;
  wrap: (id: string, type: string) => void;
  unwrap: (id: string) => void;
  setTokens: (t: Partial<SiteTokens>) => void;
  setPage: (id: string) => void;
  addPage: (name?: string) => BPage;
  removePage: (id: string) => void;
  updatePage: (id: string, patch: Partial<Pick<BPage, "name" | "path" | "title" | "description" | "ogImage" | "lang">>) => void;
  replacePageRoot: (root: unknown) => void;
  replaceDoc: (doc: BuilderDoc) => void;
  undo: () => void;
  redo: () => void;
  copy: () => void;
  cut: () => void;
  paste: () => void;
  setDevice: (d: Device) => void;
  setZoom: (z: number) => void;
  toggleOutlines: () => void;
  setCodeOpen: (v: boolean) => void;
  saveNow: () => Promise<void>;
}

let opening: { id: string; promise: Promise<void> } | null = null;
const autosave = createAutosave(900);
const HISTORY = 100;

function validDoc(d: unknown): d is BuilderDoc {
  const o = d as BuilderDoc;
  return !!o && Array.isArray(o.pages) && o.pages.length > 0 && !!o.tokens;
}

export const useBuilder = create<BuilderState>((set, get) => {
  const persist = () => {
    const { projectId } = get();
    if (!projectId || get().saveState === "conflict") return;
    set({ saveState: "dirty" });
    autosave.schedule(async () => {
      const { doc, projectId: pid } = get();
      if (!pid) return;
      set({ saveState: "saving" });
      try {
        const r = await projectsApi.save(pid, { data: doc, baseVersion: get().version || undefined });
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

  const requirePage = (doc: BuilderDoc) => doc.pages.find((p) => p.id === get().pageId) ?? doc.pages[0];

  return {
    projectId: null,
    projectName: "",
    projectKind: "site",
    loading: false,
    saveState: "idle",
    version: 0,
    doc: newDoc(),
    pageId: "",
    selectedId: null,
    device: "desktop",
    zoom: 1,
    outlines: false,
    codeOpen: false,
    past: [],
    future: [],
    clipboard: null,
    lastCoalesce: null,

    page: () => requirePage(get().doc),
    selected: () => {
      const id = get().selectedId;
      return id ? findNode(get().page().root, id)?.node ?? null : null;
    },

    open: (projectId) => {
      // Concurrent opens of the same project (e.g. a template action and the page mounting)
      // share one load, so a second load can't overwrite edits made after the first.
      if (opening?.id === projectId) return opening.promise;
      const load = async () => {
        await autosave.flush();
        set({ loading: true });
        try {
          const p = await projectsApi.get<BuilderDoc>(projectId);
          let doc = p.data as BuilderDoc;
          if (!validDoc(doc)) {
            // API specs and database schemas live in Data & APIs; never overwrite them with a page.
            if ((p.kind === "api" || p.kind === "db") && p.data && Object.keys(p.data).length) throw new Error("This project is edited in Data & APIs");
            doc = newDoc();
            p.version = (await projectsApi.save(projectId, { data: doc, baseVersion: p.version })).version;
          }
          set({ projectId, projectName: p.name, projectKind: p.kind, doc, pageId: doc.pages[0].id, selectedId: null, past: [], future: [], saveState: "saved", version: p.version, loading: false });
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
    close: () => {
      void autosave.flush();
      set({ projectId: null, projectName: "", doc: newDoc(), selectedId: null, past: [], future: [] });
    },

    mutate: (fn, coalesceKey) => {
      const prev = get().doc;
      const next = structuredClone(prev);
      fn(next, requirePage(next));
      const now = Date.now();
      const last = get().lastCoalesce;
      const coalesce = !!coalesceKey && last?.key === coalesceKey && now - last.at < 1000;
      set({
        doc: next,
        past: coalesce ? get().past : [...get().past, prev].slice(-HISTORY),
        future: [],
        lastCoalesce: coalesceKey ? { key: coalesceKey, at: now } : null,
      });
      persist();
    },

    select: (selectedId) => set({ selectedId }),

    insert: (input, opts = {}) => {
      const node = typeof input === "string" ? n(input, structuredClone(defFor(input).defaults)) : cloneWithNewIds(input);
      if (typeof input === "string" && !isKnownType(input)) throw new Error(`Unknown component type: ${input}`);
      get().mutate((doc, page) => {
        let parent: BNode = page.root;
        let index: number | undefined = opts.index;
        if (opts.parentId) {
          const hit = findNode(page.root, opts.parentId);
          if (!hit) throw new Error(`Parent ${opts.parentId} not found`);
          if (!defFor(hit.node.type).container) throw new Error(`${hit.node.type} cannot contain children`);
          parent = hit.node;
        } else if (get().selectedId) {
          const hit = findNode(page.root, get().selectedId!);
          if (hit) {
            if (defFor(hit.node.type).container) parent = hit.node;
            else if (hit.parent) {
              parent = hit.parent;
              index = hit.index + 1;
            }
          }
        }
        const i = index === undefined ? parent.children.length : Math.max(0, Math.min(index, parent.children.length));
        parent.children.splice(i, 0, node);
      });
      set({ selectedId: node.id });
      return node;
    },

    update: (id, patch, coalesceKey) => {
      get().mutate((_doc, page) => {
        const hit = findNode(page.root, id);
        if (!hit) throw new Error(`Node ${id} not found`);
        if (patch.props) Object.assign(hit.node.props, patch.props);
        if (patch.style) {
          for (const [k, v] of Object.entries(patch.style)) {
            if (v === null || v === "") delete hit.node.style[k];
            else hit.node.style[k] = v;
          }
        }
      }, coalesceKey ?? `${id}:${Object.keys(patch.props ?? {}).join(",")}:${Object.keys(patch.style ?? {}).join(",")}`);
    },

    remove: (id) => {
      const page = get().page();
      if (id === page.root.id) throw new Error("The page root cannot be deleted");
      get().mutate((_doc, pg) => {
        const hit = findNode(pg.root, id);
        if (hit?.parent) hit.parent.children.splice(hit.index, 1);
      });
      if (get().selectedId === id) set({ selectedId: null });
    },

    duplicate: (id) => {
      let newId = "";
      get().mutate((_doc, page) => {
        const hit = findNode(page.root, id);
        if (!hit?.parent) return;
        const copy = cloneWithNewIds(hit.node);
        newId = copy.id;
        hit.parent.children.splice(hit.index + 1, 0, copy);
      });
      if (newId) set({ selectedId: newId });
    },

    move: (id, dir) => {
      get().mutate((_doc, page) => {
        const hit = findNode(page.root, id);
        if (!hit?.parent) return;
        const j = hit.index + dir;
        if (j < 0 || j >= hit.parent.children.length) return;
        const [it] = hit.parent.children.splice(hit.index, 1);
        hit.parent.children.splice(j, 0, it);
      });
    },

    moveTo: (id, parentId, index) => {
      const own = findNode(get().page().root, id);
      // A node can't be moved into itself or one of its descendants.
      if (!own || findNode(own.node, parentId)) return;
      get().mutate((_doc, pg) => {
        const hit = findNode(pg.root, id);
        const target = findNode(pg.root, parentId);
        if (!hit?.parent || !target || !defFor(target.node.type).container) return;
        const [it] = hit.parent.children.splice(hit.index, 1);
        let i = index;
        if (hit.parent.id === target.node.id && hit.index < index) i -= 1;
        target.node.children.splice(Math.max(0, Math.min(i, target.node.children.length)), 0, it);
      });
    },

    wrap: (id, type) => {
      if (!defFor(type).container) throw new Error(`${type} is not a container`);
      let wrapperId = "";
      get().mutate((_doc, page) => {
        const hit = findNode(page.root, id);
        if (!hit?.parent) return;
        const wrapper = n(type, structuredClone(defFor(type).defaults), [hit.node]);
        wrapperId = wrapper.id;
        hit.parent.children.splice(hit.index, 1, wrapper);
      });
      if (wrapperId) set({ selectedId: wrapperId });
    },

    unwrap: (id) => {
      get().mutate((_doc, page) => {
        const hit = findNode(page.root, id);
        if (!hit?.parent || !hit.node.children.length) return;
        hit.parent.children.splice(hit.index, 1, ...hit.node.children);
      });
      set({ selectedId: null });
    },

    setTokens: (t) => get().mutate((doc) => Object.assign(doc.tokens, t), `tokens:${Object.keys(t).join(",")}`),

    setPage: (pageId) => set({ pageId, selectedId: null }),
    addPage: (name = "New page") => {
      const page = newPage(name, `/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`);
      get().mutate((doc) => doc.pages.push(page));
      set({ pageId: page.id, selectedId: null });
      return page;
    },
    removePage: (id) => {
      if (get().doc.pages.length <= 1) throw new Error("A project needs at least one page");
      get().mutate((doc) => {
        doc.pages = doc.pages.filter((p) => p.id !== id);
      });
      if (get().pageId === id) set({ pageId: get().doc.pages[0].id, selectedId: null });
    },

    updatePage: (id, patch) =>
      get().mutate((doc) => {
        const pg = doc.pages.find((p) => p.id === id);
        if (!pg) throw new Error("Page not found");
        Object.assign(pg, patch);
        if (patch.path !== undefined) pg.path = `/${patch.path.replace(/^\/+/, "").replace(/[^a-zA-Z0-9/_-]+/g, "-")}`.replace(/\/+$/, "") || "/";
      }, `page:${id}:${Object.keys(patch).join(",")}`),

    replacePageRoot: (rootInput) => {
      const root = normalizeNode(rootInput, isKnownType, "root");
      if (root.type !== "page") throw new Error('The root node must have type "page"');
      dedupeIds(root);
      get().mutate((_doc, page) => {
        page.root = root;
      }, "replace-root");
      if (get().selectedId && !findNode(root, get().selectedId!)) set({ selectedId: null });
    },

    replaceDoc: (doc) => {
      if (!validDoc(doc)) throw new Error("Invalid document");
      get().mutate((d) => {
        d.pages = doc.pages;
        d.tokens = doc.tokens;
      });
      set({ pageId: get().doc.pages[0].id, selectedId: null });
    },

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

    copy: () => {
      const s = get().selected();
      if (s && s.type !== "page") set({ clipboard: structuredClone(s) });
    },
    cut: () => {
      const s = get().selected();
      if (!s || s.type === "page") return;
      set({ clipboard: structuredClone(s) });
      get().remove(s.id);
    },
    paste: () => {
      const c = get().clipboard;
      if (c) get().insert(c);
    },

    setDevice: (device) => set({ device }),
    setZoom: (zoom) => set({ zoom: Math.max(0.25, Math.min(2, Math.round(zoom * 100) / 100)) }),
    toggleOutlines: () => set({ outlines: !get().outlines }),
    setCodeOpen: (codeOpen) => set({ codeOpen }),
    saveNow: async () => {
      if (!get().projectId) return;
      persist();
      await autosave.flush();
    },
  };
});

export const knownTypes = () => [...CATALOG_MAP.keys()];
export { uid };

/** Builder UI flags shared between the toolbar, panels and functions. */
export const useBuilderUi = create<{ a11yOpen: boolean; pageSettingsId: string | null; set: (p: Partial<{ a11yOpen: boolean; pageSettingsId: string | null }>) => void }>((set) => ({
  a11yOpen: false,
  pageSettingsId: null,
  set: (p) => set(p),
}));

/** Open the current page's exported HTML in a new browser tab. */
export async function previewInNewTab() {
  const { pageHtml } = await import("./exporters");
  const st = useBuilder.getState();
  const html = pageHtml(st.doc, st.page());
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  const w = window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  if (!w) throw new Error("The browser blocked the preview window — allow pop-ups for this site.");
}

// Warn before closing the tab while edits are still on their way to the server.
trackUnsaved("builder", () => ["dirty", "saving", "error"].includes(useBuilder.getState().saveState));
