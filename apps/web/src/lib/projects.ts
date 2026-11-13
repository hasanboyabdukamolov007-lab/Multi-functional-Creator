import { api } from "./api";
import { ws } from "./session";

export type ProjectKind = "site" | "panel" | "app" | "api" | "scene3d";
export const PROJECT_KINDS: ProjectKind[] = ["site", "panel", "app", "api", "scene3d"];

export interface ProjectSummary {
  id: string;
  name: string;
  kind: ProjectKind;
  version: number;
  created_at: string;
  updated_at: string;
}
export interface Project<D = Record<string, unknown>> extends ProjectSummary {
  data: D;
}

export const projectsApi = {
  list: (kind?: ProjectKind) => api.get<{ projects: ProjectSummary[] }>(ws(`/projects${kind ? `?kind=${kind}` : ""}`)).then((r) => r.projects),
  get: <D>(id: string) => api.get<{ project: Project<D> }>(ws(`/projects/${id}`)).then((r) => r.project),
  create: <D>(name: string, kind: ProjectKind, data?: D) => api.post<{ project: Project<D> }>(ws("/projects"), { name, kind, data }).then((r) => r.project),
  save: (id: string, patch: { name?: string; data?: unknown; baseVersion?: number }) => api.put<{ project: { version: number } }>(ws(`/projects/${id}`), patch).then((r) => r.project),
  rename: (id: string, name: string) => api.put<{ project: { version: number } }>(ws(`/projects/${id}`), { name }).then((r) => r.project),
  duplicate: (id: string, name?: string) => api.post<{ project: ProjectSummary }>(ws(`/projects/${id}/duplicate`), name ? { name } : {}).then((r) => r.project),
  remove: (id: string) => api.del(ws(`/projects/${id}`)),
};

/** Which editor opens a project kind. */
export function editorPath(kind: ProjectKind, id: string) {
  return kind === "scene3d" ? `/studio?project=${id}` : `/builder?project=${id}`;
}

/** Debounced saver that coalesces rapid edits into one request. */
export function createAutosave(delay = 800) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: (() => Promise<unknown>) | null = null;
  const flush = async () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const p = pending;
    pending = null;
    if (p) await p();
  };
  return {
    schedule(fn: () => Promise<unknown>) {
      pending = fn;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void flush(), delay);
    },
    flush,
  };
}
