import { create } from "zustand";
import type { Environment } from "@mfc/core";
import type { LeakFinding } from "@mfc/core";
import { api } from "../../lib/api";
import { ws } from "../../lib/session";

export interface SecretMeta {
  id: string;
  project_id: string | null;
  environment: Environment;
  name: string;
  description: string;
  current_version: number;
  expires_at: string | null;
  rotation_days: number | null;
  last_rotated_at: string;
  created_at: string;
  updated_at: string;
  status: "ok" | "expiring" | "expired" | "rotation_due";
}

export const vaultApi = {
  list: (q: { environment?: string; projectId?: string; alerts?: boolean } = {}) => {
    const p = new URLSearchParams();
    if (q.environment) p.set("environment", q.environment);
    if (q.projectId) p.set("projectId", q.projectId);
    if (q.alerts) p.set("alerts", "1");
    return api.get<{ secrets: SecretMeta[] }>(ws(`/secrets${p.size ? `?${p}` : ""}`)).then((r) => r.secrets);
  },
  create: (b: { name: string; value: string; environment: Environment; projectId?: string | null; description?: string; expiresAt?: string | null; rotationDays?: number | null }) => api.post<{ secret: SecretMeta }>(ws("/secrets"), b),
  patch: (id: string, b: { description?: string; expiresAt?: string | null; rotationDays?: number | null }) => api.patch(ws(`/secrets/${id}`), b),
  rotate: (id: string, value: string) => api.put(ws(`/secrets/${id}/value`), { value }),
  reveal: (id: string, version?: number) => api.post<{ value: string; version: number }>(ws(`/secrets/${id}/reveal`), version ? { version } : {}),
  versions: (id: string) => api.get<{ versions: Array<{ version: number; key_id: string; created_at: string; created_by: string | null }> }>(ws(`/secrets/${id}/versions`)).then((r) => r.versions),
  rollback: (id: string, version: number) => api.post(ws(`/secrets/${id}/rollback`), { version }),
  remove: (id: string) => api.del(ws(`/secrets/${id}`)),
  importEnv: (b: { environment: Environment; projectId?: string | null; content: string; overwrite: boolean }) => api.post<{ created: string[]; rotated: string[]; skipped: string[]; errors: string[] }>(ws("/secrets/import"), b),
  exportEnv: (b: { environment: Environment; projectId?: string | null }) => api.post<{ filename: string; content: string }>(ws("/secrets/export"), b),
  resolve: (environment: Environment, projectId?: string | null) => api.get<{ variables: Array<{ name: string; source: "workspace" | "project"; id: string }> }>(ws(`/secrets/resolve?environment=${environment}${projectId ? `&projectId=${projectId}` : ""}`)).then((r) => r.variables),
  scan: (text: string) => api.post<{ findings: LeakFinding[] }>(ws("/secrets/scan"), { text }).then((r) => r.findings),
};

export type VaultModal = "new" | "import" | "export" | "scan" | null;

interface VaultUi {
  modal: VaultModal;
  preset: { name?: string; environment?: Environment } | null;
  version: number;
  open: (m: VaultModal, preset?: VaultUi["preset"]) => void;
  bump: () => void;
}

export const useVaultUi = create<VaultUi>((set, get) => ({
  modal: null,
  preset: null,
  version: 0,
  open: (modal, preset = null) => set({ modal, preset }),
  bump: () => set({ version: get().version + 1 }),
}));
