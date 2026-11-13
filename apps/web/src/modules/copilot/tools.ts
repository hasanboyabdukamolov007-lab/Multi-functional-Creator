import { validateArgs, type JsonSchema } from "@mfc/core";
import { getCtx, registry, runFunction } from "../../lib/registry";
import { useUi } from "../../lib/ui";
import { useTheme } from "../../lib/theme";
import { useI18n } from "../../lib/i18n";
import { useSession } from "../../lib/session";
import { MODULES } from "../index";
import { editorPath, PROJECT_KINDS, projectsApi, type ProjectKind } from "../../lib/projects";
import { useBuilder } from "../builder/store";
import { CATALOG, isKnownType } from "../builder/catalog";
import { dedupeIds, findNode, normalizeNode, walk } from "../builder/model";
import { useStudio } from "../studio/store";
import { EASINGS, LIGHT_TYPES, PRIMITIVES, SHAPES, TRACK_PROPS, makeCamera, makeExtrude, makeGroup, makeLight, makePrimitive, type SceneObject, type TrackProp } from "../studio/model";
import { functionTitle } from "../../shell/CommandPalette";

export interface ClientTool {
  name: string;
  description: string;
  input_schema: JsonSchema & { type: "object" };
  run: (input: Record<string, unknown>) => Promise<unknown> | unknown;
}

const vec3: JsonSchema = { type: "array", items: { type: "number" }, description: "[x, y, z]" };
const obj = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema & { type: "object" } => ({ type: "object", properties, required });

const B = () => useBuilder.getState();
const S = () => useStudio.getState();
const navigate = (p: string) => getCtx().navigate(p);

function requireBuilder() {
  if (!B().projectId) throw new Error("No builder project is open. Call open_project or create_project (kind site, panel, app or api) first.");
}
function requireStudio() {
  if (!S().projectId) throw new Error("No 3D scene is open. Call open_project or create_project with kind scene3d first.");
}

async function openProject(id: string) {
  const p = await projectsApi.get(id);
  navigate(editorPath(p.kind, p.id));
  if (p.kind === "scene3d") await S().open(p.id);
  else await B().open(p.id);
  return { id: p.id, name: p.name, kind: p.kind };
}

function buildStudioObject(spec: Record<string, unknown>): SceneObject {
  const kind = String(spec.kind ?? "primitive");
  const type = String(spec.type ?? "");
  const common: Partial<SceneObject> = {};
  if (typeof spec.name === "string") common.name = spec.name;
  if (Array.isArray(spec.position)) common.position = spec.position as SceneObject["position"];
  if (Array.isArray(spec.rotation)) common.rotation = spec.rotation as SceneObject["rotation"];
  if (Array.isArray(spec.scale)) common.scale = spec.scale as SceneObject["scale"];
  if (typeof spec.parentId === "string") common.parentId = spec.parentId;
  if (typeof spec.visible === "boolean") common.visible = spec.visible;
  let o: SceneObject;
  if (kind === "primitive") {
    if (!(PRIMITIVES as readonly string[]).includes(type)) throw new Error(`Unknown primitive "${type}". Use one of: ${PRIMITIVES.join(", ")}`);
    o = makePrimitive(type as (typeof PRIMITIVES)[number], common);
    if (spec.params && typeof spec.params === "object" && o.geometry?.kind === "primitive") o.geometry.params = { ...o.geometry.params, ...(spec.params as Record<string, number>) };
  } else if (kind === "shape") {
    if (!(SHAPES as readonly string[]).includes(type)) throw new Error(`Unknown shape "${type}". Use one of: ${SHAPES.join(", ")}`);
    o = makeExtrude(type as (typeof SHAPES)[number], common);
    if (spec.params && typeof spec.params === "object" && o.geometry?.kind === "extrude") Object.assign(o.geometry, spec.params);
  } else if (kind === "light") {
    if (!(LIGHT_TYPES as readonly string[]).includes(type)) throw new Error(`Unknown light "${type}". Use one of: ${LIGHT_TYPES.join(", ")}`);
    o = makeLight(type as (typeof LIGHT_TYPES)[number], common);
  } else if (kind === "camera") o = makeCamera(common);
  else if (kind === "group") o = makeGroup(common);
  else throw new Error(`Unknown object kind "${kind}"`);
  if (spec.material && typeof spec.material === "object" && o.material) o.material = { ...o.material, ...(spec.material as object) };
  if (spec.light && typeof spec.light === "object" && o.light) o.light = { ...o.light, ...(spec.light as object) };
  if (typeof spec.subdivision === "number" && o.geometry && o.geometry.kind !== "model") o.geometry.subdivision = Math.max(0, Math.min(3, Math.round(spec.subdivision)));
  return o;
}

export const CLIENT_TOOLS: ClientTool[] = [
  {
    name: "get_panel_state",
    description: "Read the current workspace state: active module, open builder project/page/selection, open 3D scene/selection/time, theme, language and the user's role.",
    input_schema: obj({}),
    run: () => {
      const b = B();
      const s = S();
      const sel = b.selected();
      return {
        module: useUi.getState().module,
        path: window.location.pathname + window.location.search,
        role: useSession.getState().workspace()?.role,
        theme: useTheme.getState().active().name,
        language: useI18n.getState().locale,
        builder: b.projectId ? { projectId: b.projectId, projectName: b.projectName, kind: b.projectKind, pages: b.doc.pages.map((p) => ({ id: p.id, name: p.name, path: p.path })), currentPageId: b.page().id, selected: sel ? { id: sel.id, type: sel.type } : null, device: b.device } : null,
        studio: s.projectId ? { projectId: s.projectId, name: s.projectName, objects: s.doc.objects.length, selectedId: s.selectedId, time: s.time, duration: s.doc.settings.duration } : null,
      };
    },
  },
  {
    name: "list_functions",
    description: "Search the panel's registered functions (there are hundreds: builder inserts/styles/templates, 3D add/material/transform/animation, themes, vault, navigation…). Returns ids you can pass to run_function. Use a query to filter.",
    input_schema: obj({ query: { type: "string", description: "Words to search for, e.g. 'material gold' or 'style padding'" }, category: { type: "string" }, limit: { type: "integer", description: "Default 40, max 150" } }),
    run: (i) => {
      const ctx = getCtx();
      const all = (i.query ? registry.search(String(i.query), 500) : registry.list()).filter((f) => f.ai !== false && (!i.category || f.category.toLowerCase().includes(String(i.category).toLowerCase())));
      const limit = Math.min(150, Number(i.limit) || 40);
      return {
        total: all.length,
        categories: [...registry.categories().keys()],
        functions: all.slice(0, limit).map((f) => {
          const enabled = registry.isEnabled(f.id, ctx);
          return { id: f.id, title: functionTitle(f), category: f.category, ...(f.params ? { params: f.params } : {}), ...(enabled !== true ? { unavailable: enabled } : {}) };
        }),
      };
    },
  },
  {
    name: "run_function",
    description: "Run a registered panel function by id (find ids with list_functions). Many functions act on the current selection — select first with builder_select or studio_select.",
    input_schema: obj({ id: { type: "string" }, args: { type: "object", description: "Arguments matching the function's params schema, if any" } }, ["id"]),
    run: async (i) => {
      const f = registry.get(String(i.id));
      if (!f) throw new Error(`Unknown function "${i.id}". Use list_functions to find valid ids.`);
      if (f.ai === false) throw new Error(`"${i.id}" needs the user (file dialogs, downloads or sign-out) and cannot be run by the copilot. Ask the user to run it from the command palette.`);
      const result = await runFunction(f.id, (i.args as Record<string, unknown>) ?? {});
      return { ok: true, function: f.id, result: result ?? null };
    },
  },
  {
    name: "navigate",
    description: "Open a module of the panel.",
    input_schema: obj({ module: { type: "string", enum: MODULES.map((m) => m.id) } }, ["module"]),
    run: (i) => {
      const m = MODULES.find((x) => x.id === i.module)!;
      navigate(m.path);
      return { ok: true, module: m.id, phase: m.phase, available: m.phase === 1 };
    },
  },
  {
    name: "list_projects",
    description: "List projects in the workspace.",
    input_schema: obj({ kind: { type: "string", enum: [...PROJECT_KINDS] } }),
    run: async (i) => (await projectsApi.list(i.kind as ProjectKind | undefined)).map(({ id, name, kind, updated_at }) => ({ id, name, kind, updated_at })),
  },
  {
    name: "open_project",
    description: "Open a project in its editor (builder for site/panel/app/api, 3D studio for scene3d).",
    input_schema: obj({ id: { type: "string" } }, ["id"]),
    run: (i) => openProject(String(i.id)),
  },
  {
    name: "create_project",
    description: "Create a new project and open it. Kinds: site, panel (admin dashboard), app (web/mobile app), api (API service docs/landing), scene3d.",
    input_schema: obj({ name: { type: "string" }, kind: { type: "string", enum: [...PROJECT_KINDS] } }, ["name", "kind"]),
    run: async (i) => {
      const p = await projectsApi.create(String(i.name), i.kind as ProjectKind);
      return openProject(p.id);
    },
  },
  {
    name: "builder_list_components",
    description: "List the builder's component types with their editable props. Use these types when building page trees. Containers accept children.",
    input_schema: obj({}),
    run: () =>
      CATALOG.map((c) => ({
        type: c.type,
        label: c.label,
        category: c.category,
        description: c.description,
        container: !!c.container,
        props: Object.fromEntries(c.fields.map((f) => [f.key, f.options ? `${f.kind}: ${f.options.join("|")}` : f.hint ? `${f.kind} (${f.hint})` : f.kind])),
      })),
  },
  {
    name: "builder_get_page",
    description: "Get the open builder page as a node tree ({id, type, props, style, children}) plus the site design tokens.",
    input_schema: obj({ pageId: { type: "string" } }),
    run: (i) => {
      requireBuilder();
      if (i.pageId) B().setPage(String(i.pageId));
      const p = B().page();
      return { page: { id: p.id, name: p.name, path: p.path, title: p.title }, tokens: B().doc.tokens, root: p.root };
    },
  },
  {
    name: "builder_set_page",
    description: "Replace the whole current page with a new node tree. root must be {type:'page', children:[...]}. Nodes are {type, props?, style?, children?}; ids are optional. style uses React-style camelCase CSS and may reference tokens like var(--color-primary). Best for generating complete pages.",
    input_schema: obj({ root: { type: "object" } }, ["root"]),
    run: (i) => {
      requireBuilder();
      B().replacePageRoot(i.root);
      let count = 0;
      walk(B().page().root, () => count++);
      return { ok: true, nodes: count - 1 };
    },
  },
  {
    name: "builder_insert",
    description: "Insert a node (with optional children subtree) into the current page. Without parentId it goes after the selection (or into it if it is a container), else at the end of the page.",
    input_schema: obj({ node: { type: "object" }, parentId: { type: "string" }, index: { type: "integer" } }, ["node"]),
    run: (i) => {
      requireBuilder();
      const node = normalizeNode(i.node, isKnownType);
      dedupeIds(node);
      const inserted = B().insert(node, { parentId: i.parentId as string | undefined, index: i.index as number | undefined });
      return { ok: true, id: inserted.id };
    },
  },
  {
    name: "builder_update",
    description: "Merge props and/or style into an existing node. Set a style key to null to remove it.",
    input_schema: obj({ id: { type: "string" }, props: { type: "object" }, style: { type: "object" } }, ["id"]),
    run: (i) => {
      requireBuilder();
      B().update(String(i.id), { props: i.props as Record<string, unknown> | undefined, style: i.style as Record<string, string | null> | undefined });
      return { ok: true };
    },
  },
  {
    name: "builder_remove",
    description: "Remove a node (and its children) from the current page.",
    input_schema: obj({ id: { type: "string" } }, ["id"]),
    run: (i) => {
      requireBuilder();
      B().remove(String(i.id));
      return { ok: true };
    },
  },
  {
    name: "builder_select",
    description: "Select a node on the canvas (so selection-based functions like builder.style.* apply to it).",
    input_schema: obj({ id: { type: "string" } }, ["id"]),
    run: (i) => {
      requireBuilder();
      if (!findNode(B().page().root, String(i.id))) throw new Error(`Node ${i.id} not found on this page`);
      B().select(String(i.id));
      return { ok: true };
    },
  },
  {
    name: "builder_set_tokens",
    description: "Update site design tokens: primary, primaryText, bg, surface, text, muted, border (CSS colors), radius, maxWidth (CSS lengths), font, headingFont (CSS font-family).",
    input_schema: obj({ tokens: { type: "object" } }, ["tokens"]),
    run: (i) => {
      requireBuilder();
      B().setTokens(i.tokens as never);
      return { ok: true, tokens: B().doc.tokens };
    },
  },
  {
    name: "builder_add_page",
    description: "Add a page to the open builder project and switch to it.",
    input_schema: obj({ name: { type: "string" } }, ["name"]),
    run: (i) => {
      requireBuilder();
      const p = B().addPage(String(i.name));
      return { id: p.id, path: p.path };
    },
  },
  {
    name: "studio_get_scene",
    description: "Get the open 3D scene: objects (id, name, kind, geometry, material, light, transform in degrees), animation tracks and settings.",
    input_schema: obj({}),
    run: () => {
      requireStudio();
      const d = S().doc;
      return { objects: d.objects, tracks: d.tracks.map((t) => ({ objectId: t.objectId, property: t.property, keyframes: t.keyframes })), settings: d.settings, selectedId: S().selectedId, time: S().time };
    },
  },
  {
    name: "studio_add_objects",
    description: `Add objects to the 3D scene. Each item: {kind: 'primitive'|'shape'|'light'|'camera'|'group', type, name?, position?, rotation? (degrees), scale?, parentId?, material? {color, metalness, roughness, emissive, emissiveIntensity, opacity, transmission, clearcoat, wireframe, flatShading}, light? {color, intensity, angle, penumbra, groundColor}, params? (geometry params, e.g. {radius:1}), subdivision? 0-3}. Primitive types: ${PRIMITIVES.join(", ")}. Shape types (extruded with bevel): ${SHAPES.join(", ")}. Light types: ${LIGHT_TYPES.join(", ")}. Y is up; the floor is y=0.`,
    input_schema: obj({ objects: { type: "array", items: { type: "object" } } }, ["objects"]),
    run: (i) => {
      requireStudio();
      const objs = (i.objects as Array<Record<string, unknown>>).map(buildStudioObject);
      S().addMany(objs);
      return { ok: true, ids: objs.map((o) => ({ id: o.id, name: o.name })) };
    },
  },
  {
    name: "studio_update_object",
    description: "Update an object: {name?, position?, rotation? (degrees), scale?, visible?, castShadow?, material? (partial), light? (partial), geometry? (partial, e.g. {params:{...}} or {subdivision:2})}.",
    input_schema: obj({ id: { type: "string" }, patch: { type: "object" } }, ["id", "patch"]),
    run: (i) => {
      requireStudio();
      const id = String(i.id);
      const patch = i.patch as Partial<SceneObject> & { geometry?: Record<string, unknown> };
      const cur = S().doc.objects.find((o) => o.id === id);
      if (!cur) throw new Error(`Object ${id} not found`);
      const next: Partial<SceneObject> = { ...patch } as Partial<SceneObject>;
      if (patch.material) next.material = { ...cur.material!, ...patch.material };
      if (patch.light) next.light = { ...cur.light!, ...patch.light };
      if (patch.geometry && cur.geometry) {
        const g = { ...cur.geometry, ...patch.geometry } as SceneObject["geometry"] & { params?: Record<string, number> };
        if (cur.geometry.kind === "primitive" && patch.geometry.params) (g as { params: Record<string, number> }).params = { ...cur.geometry.params, ...(patch.geometry.params as Record<string, number>) };
        next.geometry = g;
      }
      S().update(id, next);
      return { ok: true };
    },
  },
  {
    name: "studio_remove_object",
    description: "Delete an object (and its children) from the scene.",
    input_schema: obj({ id: { type: "string" } }, ["id"]),
    run: (i) => {
      requireStudio();
      S().remove(String(i.id));
      return { ok: true };
    },
  },
  {
    name: "studio_select",
    description: "Select a 3D object (so selection-based functions like studio.material.* apply to it).",
    input_schema: obj({ id: { type: "string" } }, ["id"]),
    run: (i) => {
      requireStudio();
      if (!S().doc.objects.some((o) => o.id === i.id)) throw new Error(`Object ${i.id} not found`);
      S().select(String(i.id));
      return { ok: true };
    },
  },
  {
    name: "studio_set_keyframes",
    description: `Replace the keyframes of one animated property. property: ${TRACK_PROPS.join("|")}. value is [x,y,z] (rotation in degrees) or [opacity]. easing (of the segment arriving at that key): ${EASINGS.join("|")}. Duration grows automatically to fit.`,
    input_schema: obj(
      {
        objectId: { type: "string" },
        property: { type: "string", enum: [...TRACK_PROPS] },
        keyframes: { type: "array", items: { type: "object", properties: { t: { type: "number" }, value: { type: "array", items: { type: "number" } }, easing: { type: "string", enum: [...EASINGS] } }, required: ["t", "value"] } },
      },
      ["objectId", "property", "keyframes"],
    ),
    run: (i) => {
      requireStudio();
      const kfs = (i.keyframes as Array<{ t: number; value: number[]; easing?: string }>).map((k) => ({ t: Number(k.t), value: k.value.map(Number), easing: (k.easing ?? "easeInOut") as (typeof EASINGS)[number] }));
      S().setKeyframes(String(i.objectId), i.property as TrackProp, kfs);
      S().setTime(0);
      S().setPlaying(true);
      return { ok: true, keyframes: kfs.length };
    },
  },
  {
    name: "studio_set_settings",
    description: "Update scene settings: background (color), environment (studio|sunset|night|warehouse|none), envIntensity, showGrid, showAxes, shadows, fog, duration (s), loop.",
    input_schema: obj({ settings: { type: "object" } }, ["settings"]),
    run: (i) => {
      requireStudio();
      S().setSettings(i.settings as never);
      return { ok: true, settings: S().doc.settings };
    },
  },
];

export const TOOL_MAP = new Map(CLIENT_TOOLS.map((t) => [t.name, t]));

/** Wire format sent to the server (no run functions). */
export const toolDefinitions = () => CLIENT_TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema }));

const MAX_RESULT = 40_000;

export async function executeTool(name: string, input: unknown): Promise<{ content: string; isError: boolean }> {
  const tool = TOOL_MAP.get(name);
  if (!tool) return { content: `Unknown tool ${name}`, isError: true };
  if (!input || typeof input !== "object" || Array.isArray(input)) return { content: JSON.stringify({ INVALID_JSON: JSON.stringify(input) }), isError: true };
  const problems = validateArgs(tool.input_schema, input);
  if (problems.length) return { content: `Invalid input: ${problems.join("; ")}`, isError: true };
  try {
    const result = await tool.run(input as Record<string, unknown>);
    let text = JSON.stringify(result ?? { ok: true });
    if (text.length > MAX_RESULT) text = `${text.slice(0, MAX_RESULT)}… [truncated ${text.length - MAX_RESULT} chars]`;
    return { content: text, isError: false };
  } catch (e) {
    return { content: (e as Error).message || "Tool failed", isError: true };
  }
}

/** Short description of the live workspace, attached to each user message. */
export function panelContext(): string {
  const b = B();
  const s = S();
  const lines = [`module: ${useUi.getState().module}`, `language: ${useI18n.getState().locale}`, `panel theme: ${useTheme.getState().active().name}`];
  if (b.projectId) {
    let count = 0;
    walk(b.page().root, () => count++);
    const sel = b.selected();
    lines.push(`builder: project "${b.projectName}" (${b.projectKind}, id ${b.projectId}), page "${b.page().name}" with ${count - 1} elements${sel ? `, selected ${sel.type}#${sel.id}` : ""}`);
  }
  if (s.projectId) {
    const sel = s.selected();
    lines.push(`3d studio: scene "${s.projectName}" (id ${s.projectId}), ${s.doc.objects.length} objects${sel ? `, selected ${sel.name}#${sel.id}` : ""}, t=${s.time.toFixed(2)}s/${s.doc.settings.duration}s`);
  }
  return `<panel_context>\n${lines.join("\n")}\n</panel_context>`;
}
