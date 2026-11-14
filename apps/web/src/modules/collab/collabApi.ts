import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { ws } from "../../lib/session";

export interface Peer {
  user_id: string;
  name: string;
  color: string;
  selection: string | null;
}
export interface Comment {
  id: string;
  node_id: string | null;
  parent_id: string | null;
  body: string;
  resolved: boolean;
  created_at: string;
  author: string;
  author_id: string | null;
}
export interface Version {
  id: string;
  version: number;
  label: string | null;
  auto: boolean;
  created_at: string;
  author: string | null;
  size: number;
}

export const collabApi = {
  comments: (pid: string) => api.get<{ comments: Comment[] }>(ws(`/projects/${pid}/comments`)).then((r) => r.comments),
  comment: (pid: string, b: { body: string; nodeId?: string | null; parentId?: string | null }) => api.post<{ id: string; mentioned: string[] }>(ws(`/projects/${pid}/comments`), b),
  updateComment: (cid: string, b: { resolved?: boolean; body?: string }) => api.patch(ws(`/comments/${cid}`), b),
  deleteComment: (cid: string) => api.del(ws(`/comments/${cid}`)),
  versions: (pid: string) => api.get<{ versions: Version[] }>(ws(`/projects/${pid}/versions`)).then((r) => r.versions),
  saveVersion: (pid: string, label: string) => api.post(ws(`/projects/${pid}/versions`), { label }),
  restore: (pid: string, vid: string) => api.post(ws(`/projects/${pid}/versions/${vid}/restore`)),
  branches: (pid: string) => api.get<{ main: string; branches: Array<{ id: string; branch_name: string; version: number; updated_at: string }> }>(ws(`/projects/${pid}/branches`)),
  branch: (pid: string, name: string) => api.post<{ project: { id: string; name: string; kind: string } }>(ws(`/projects/${pid}/branch`), { name }).then((r) => r.project),
  merge: (pid: string) => api.post(ws(`/projects/${pid}/merge`)),
  members: () => api.get<{ members: Array<{ id: string; email: string; name: string | null }> }>(ws("/members")).then((r) => r.members),
  presence: (pid: string, selection: string | null) => api.post(ws(`/projects/${pid}/presence`), { selection }),
  leave: (pid: string) => api.del(ws(`/projects/${pid}/presence`)),
  recent: () => api.get<{ comments: Array<{ id: string; project_id: string; project: string; kind: string; body: string; resolved: boolean; created_at: string; author: string }>; online: Array<{ user_id: string; name: string; color: string; project_id: string; project: string; kind: string }> }>(ws("/comments/recent")),
};

/**
 * Live presence for a project: heartbeats our selection every 10 s (and on change) and listens to the
 * project's SSE stream for teammates, their selections, saves and comment activity.
 */
export function useLive(projectId: string | null, selection: string | null, handlers: { onVersion?: (v: number) => void; onComments?: () => void }) {
  const [peers, setPeers] = useState<Peer[]>([]);
  const h = useRef(handlers);
  h.current = handlers;
  const sel = useRef(selection);
  useEffect(() => {
    sel.current = selection;
    if (projectId) void collabApi.presence(projectId, selection).catch(() => undefined);
  }, [projectId, selection]);
  useEffect(() => {
    if (!projectId) return;
    const beat = setInterval(() => void collabApi.presence(projectId, sel.current).catch(() => undefined), 10_000);
    let es: EventSource | null = null;
    try {
      es = new EventSource(ws(`/projects/${projectId}/live`), { withCredentials: true });
      es.addEventListener("presence", (e) => setPeers(JSON.parse((e as MessageEvent).data)));
      es.addEventListener("version", (e) => h.current.onVersion?.(JSON.parse((e as MessageEvent).data).version));
      es.addEventListener("comments", () => h.current.onComments?.());
    } catch {
      /* EventSource unavailable: presence still heartbeats */
    }
    const leave = () => void collabApi.leave(projectId).catch(() => undefined);
    window.addEventListener("pagehide", leave);
    return () => {
      clearInterval(beat);
      es?.close();
      window.removeEventListener("pagehide", leave);
      leave();
      setPeers([]);
    };
  }, [projectId]);
  return peers;
}
