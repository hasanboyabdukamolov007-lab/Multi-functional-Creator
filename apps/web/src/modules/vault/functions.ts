import { ENVIRONMENTS, scanForLeaks, type Environment } from "@mfc/core";
import { registry, type AppFunction } from "../../lib/registry";
import { vaultApi, useVaultUi, type VaultModal } from "./vaultApi";

const openModal = (m: VaultModal, preset?: { name?: string; environment?: Environment }) => (_a: Record<string, unknown>, ctx: { navigate: (p: string) => void }) => {
  ctx.navigate("/vault");
  useVaultUi.getState().open(m, preset);
};

export function registerVaultFunctions() {
  const fns: AppFunction[] = [
    { id: "vault.new", title: "New secret", category: "Vault", keywords: ["secret", "key", "token", "password", "add"], ai: false, run: openModal("new") },
    { id: "vault.import", title: "Import .env file into the vault", category: "Vault", keywords: ["dotenv", "env"], ai: false, run: openModal("import") },
    { id: "vault.export", title: "Export .env file from the vault", category: "Vault", keywords: ["dotenv", "env", "download"], ai: false, run: openModal("export") },
    { id: "vault.scan", title: "Open the leak scanner", category: "Vault", keywords: ["security", "leak", "scan"], ai: false, run: openModal("scan") },
    { id: "vault.copilot-key", title: "Add the copilot's Anthropic API key", category: "Vault", keywords: ["anthropic", "claude", "ai", "key"], ai: false, run: openModal("new", { name: "ANTHROPIC_API_KEY", environment: "production" }) },
    {
      id: "vault.list",
      title: "List secret names and health (values are never returned)",
      category: "Vault",
      params: { type: "object", properties: { environment: { type: "string", enum: [...ENVIRONMENTS] } } },
      run: async (a) => (await vaultApi.list({ environment: a.environment as string | undefined })).map((s) => ({ name: s.name, environment: s.environment, projectId: s.project_id, version: s.current_version, status: s.status, expiresAt: s.expires_at })),
    },
    {
      id: "vault.resolve",
      title: "Show which variables would be injected at deploy",
      category: "Vault",
      params: { type: "object", properties: { environment: { type: "string", enum: [...ENVIRONMENTS] }, projectId: { type: "string" } }, required: ["environment"] },
      run: (a) => vaultApi.resolve(a.environment as Environment, (a.projectId as string) || null).then((v) => v.map(({ name, source }) => ({ name, source }))),
    },
    {
      id: "vault.alerts",
      title: "Show expiring, expired and rotation-due secrets",
      category: "Vault",
      run: async (_a, ctx) => {
        const list = await vaultApi.list({ alerts: true });
        if (ctx.module !== "copilot") ctx.navigate("/vault");
        return list.map((s) => ({ name: s.name, environment: s.environment, status: s.status, expiresAt: s.expires_at }));
      },
    },
    {
      id: "vault.scan-text",
      title: "Scan text or code for hard-coded secrets",
      category: "Vault",
      params: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      run: (a) => scanForLeaks(String(a.text)),
    },
  ];
  registry.register(fns);
}
