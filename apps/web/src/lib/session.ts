import { create } from "zustand";
import type { Role } from "@mfc/core";
import { api } from "./api";
import { load, save } from "./storage";

export interface User {
  id: string;
  email: string;
  name: string | null;
  locale: string | null;
  prefs: Record<string, unknown>;
}
export interface WorkspaceRef {
  id: string;
  name: string;
  plan: string;
  role: Role;
}

interface SessionState {
  status: "loading" | "anon" | "ready";
  user: User | null;
  workspaces: WorkspaceRef[];
  workspaceId: string | null;
  workspace: () => WorkspaceRef | null;
  refresh: () => Promise<void>;
  setWorkspace: (id: string) => void;
  logout: () => Promise<void>;
}

export const useSession = create<SessionState>((set, get) => ({
  status: "loading",
  user: null,
  workspaces: [],
  workspaceId: null,
  workspace: () => get().workspaces.find((w) => w.id === get().workspaceId) ?? null,
  refresh: async () => {
    try {
      const me = await api.get<{ user: User | null; workspaces: WorkspaceRef[] }>("/api/auth/me");
      if (!me.user) {
        set({ status: "anon", user: null, workspaces: [], workspaceId: null });
        return;
      }
      const stored = load<string | null>("mfc.workspace", null);
      const workspaceId = me.workspaces.find((w) => w.id === stored)?.id ?? me.workspaces[0]?.id ?? null;
      set({ status: "ready", user: me.user, workspaces: me.workspaces, workspaceId });
    } catch {
      set({ status: "anon", user: null, workspaces: [], workspaceId: null });
    }
  },
  setWorkspace: (id) => {
    save("mfc.workspace", id);
    set({ workspaceId: id });
  },
  logout: async () => {
    await api.post("/api/auth/logout").catch(() => undefined);
    set({ status: "anon", user: null, workspaces: [], workspaceId: null });
  },
}));

/** Base URL for workspace-scoped API calls. */
export function ws(path = ""): string {
  const id = useSession.getState().workspaceId;
  if (!id) throw new Error("No workspace selected");
  return `/api/w/${id}${path}`;
}
