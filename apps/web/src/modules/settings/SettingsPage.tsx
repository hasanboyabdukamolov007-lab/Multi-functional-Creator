import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ROLES, can, type Role } from "@mfc/core";
import { useT, useI18n, LOCALES } from "../../lib/i18n";
import { useTheme, BUILT_IN_THEMES, type ThemeTokens } from "../../lib/theme";
import { useSession, ws } from "../../lib/session";
import { api } from "../../lib/api";
import { toast } from "../../lib/ui";
import { runFunction } from "../../lib/registry";
import { vaultApi, type SecretMeta } from "../vault/vaultApi";
import type { AiStatus } from "../copilot/agent";
import * as I from "../../ui/icons";
import { confirmDialog } from "../../ui/dialog";
import Billing from "./Billing";
import Devices from "./Devices";

type Tab = "appearance" | "language" | "workspace" | "billing" | "ai" | "devices" | "account";

const COLOR_KEYS: Array<[keyof ThemeTokens, string]> = [
  ["bg", "Background"],
  ["surface", "Surface"],
  ["surface2", "Surface 2"],
  ["elevated", "Elevated"],
  ["border", "Border"],
  ["text", "Text"],
  ["muted", "Muted"],
  ["accent", "Accent"],
  ["accentText", "On accent"],
  ["success", "Success"],
  ["warning", "Warning"],
  ["danger", "Danger"],
];

function ThemeSwatch({ tokens }: { tokens: ThemeTokens }) {
  return (
    <div style={{ display: "flex", height: 44, borderRadius: 8, overflow: "hidden", border: "1px solid var(--mfc-border)" }}>
      {[tokens.bg, tokens.surface, tokens.elevated, tokens.accent, tokens.text].map((c, i) => (
        <span key={i} style={{ flex: 1, background: c }} />
      ))}
    </div>
  );
}

function Appearance() {
  const t = useT();
  const { activeId, all, setActive, draft, setDraft, saveCustom, removeCustom } = useTheme();
  const active = useTheme((s) => s.active());
  const followSystem = useTheme((s) => s.followSystem);
  const setFollowSystem = useTheme((s) => s.setFollowSystem);
  const tokens = draft ?? active.tokens;
  const edit = (patch: Partial<ThemeTokens>) => setDraft({ ...tokens, ...patch });
  const [name, setName] = useState("My theme");
  useEffect(() => () => setDraft(null), [setDraft]);

  return (
    <div className="col" style={{ gap: 24 }}>
      <div>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="section-label">{t("settings.themes")}</div>
          <label className="row small" style={{ gap: 6 }}>
            <input type="checkbox" checked={followSystem} onChange={(e) => setFollowSystem(e.target.checked)} /> {t("theme.followLabel")}
          </label>
        </div>
        <div className="grid-auto" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12 }}>
          {all().map((th) => (
            <button key={th.id} className="card" style={{ padding: 10, cursor: "pointer", textAlign: "left", color: "inherit", outline: th.id === activeId ? "2px solid var(--mfc-accent)" : undefined }} onClick={() => setActive(th.id)}>
              <ThemeSwatch tokens={th.tokens} />
              <div className="row" style={{ marginTop: 8 }}>
                <span className="grow ellipsis small" style={{ fontWeight: 600 }}>{th.name}</span>
                {!th.builtIn && (
                  <span className="icon-btn" style={{ width: 22, height: 22 }} role="button" aria-label="Delete theme" onClick={(e) => (e.stopPropagation(), removeCustom(th.id))}>
                    <I.IconTrash size={12} />
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn btn-sm" onClick={() => runFunction("theme.import")}><I.IconUpload size={14} /> {t("common.import")}</button>
          <button className="btn btn-sm" onClick={() => runFunction("theme.export")}><I.IconDownload size={14} /> {t("common.export")}</button>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ marginBottom: 12 }}>
          <I.IconPalette size={18} />
          <div className="card-title grow" style={{ margin: 0 }}>{t("settings.themeEditor")}</div>
          {draft && <button className="btn btn-sm btn-ghost" onClick={() => setDraft(null)}>{t("common.reset")}</button>}
        </div>
        <div className="grid-auto" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
          {COLOR_KEYS.map(([k, label]) => (
            <div key={k} className="row" style={{ gap: 8 }}>
              <input className="color-input" type="color" value={/^#[0-9a-f]{6}$/i.test(String(tokens[k])) ? String(tokens[k]) : "#000000"} onChange={(e) => edit({ [k]: e.target.value })} aria-label={label} />
              <div className="grow">
                <div className="small muted">{label}</div>
                <input className="input input-sm mono" value={String(tokens[k])} onChange={(e) => edit({ [k]: e.target.value })} />
              </div>
            </div>
          ))}
        </div>
        <div className="prop-grid" style={{ marginTop: 16, gridTemplateColumns: "120px 1fr", maxWidth: 520 }}>
          <label>Corner radius</label>
          <input type="range" min={0} max={20} value={tokens.radius} onChange={(e) => edit({ radius: Number(e.target.value) })} />
          <label>Density</label>
          <input type="range" min={0.8} max={1.3} step={0.05} value={tokens.density} onChange={(e) => edit({ density: Number(e.target.value) })} />
          <label>Glass blur</label>
          <input type="range" min={0} max={30} value={tokens.blur} onChange={(e) => edit({ blur: Number(e.target.value) })} />
          <label>Scheme</label>
          <select className="select input-sm" value={tokens.scheme} onChange={(e) => edit({ scheme: e.target.value as "dark" | "light" })}>
            <option value="dark">dark</option>
            <option value="light">light</option>
          </select>
          <label>Font</label>
          <input className="input input-sm" value={tokens.font} onChange={(e) => edit({ font: e.target.value })} />
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <input className="input" style={{ maxWidth: 240 }} value={name} onChange={(e) => setName(e.target.value)} aria-label={t("common.name")} />
          <button className="btn btn-primary" disabled={!draft} onClick={() => (saveCustom(name || "My theme", tokens), toast(`Theme "${name}" saved`, "success"))}>
            <I.IconSave size={14} /> {t("settings.saveTheme")}
          </button>
        </div>
        <p className="hint" style={{ marginTop: 8 }}>Changes preview live across the whole panel. Built-in themes: {BUILT_IN_THEMES.length}.</p>
      </div>
    </div>
  );
}

function Language() {
  const { locale, setLocale } = useI18n();
  return (
    <div className="grid-auto" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
      {LOCALES.map((l) => (
        <button key={l.id} className="card" style={{ cursor: "pointer", textAlign: "left", color: "inherit", outline: l.id === locale ? "2px solid var(--mfc-accent)" : undefined }} onClick={() => setLocale(l.id)}>
          <div className="card-title">{l.native}</div>
          <div className="small muted">{l.label}</div>
        </button>
      ))}
    </div>
  );
}

interface Member {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  last_login_at: string | null;
}

function Workspace() {
  const t = useT();
  const session = useSession();
  const wsRef = session.workspace();
  const myRole = wsRef?.role ?? "viewer";
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [wsName, setWsName] = useState(wsRef?.name ?? "");
  const load = () => api.get<{ members: Member[] }>(ws("/members")).then((r) => setMembers(r.members)).catch(() => setMembers([]));
  useEffect(() => {
    void load();
    setWsName(wsRef?.name ?? "");
  }, [session.workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps
  const manage = can(myRole, "members.manage");
  return (
    <div className="col" style={{ gap: 20 }}>
      {can(myRole, "workspace.manage") && (
        <form className="row" onSubmit={async (e) => { e.preventDefault(); await api.patch(ws(""), { name: wsName }); await session.refresh(); toast("Workspace renamed", "success"); }}>
          <input className="input" style={{ maxWidth: 320 }} value={wsName} onChange={(e) => setWsName(e.target.value)} aria-label="Workspace name" />
          <button className="btn">{t("common.save")}</button>
        </form>
      )}
      {manage && (
        <form className="card row wrap" onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api.post(ws("/members"), { email, role });
            setEmail("");
            toast(`Invited ${email}`, "success");
            void load();
          } catch (err) {
            toast((err as Error).message, "error");
          }
        }}>
          <input className="input grow" type="email" required placeholder="teammate@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <select className="select" style={{ width: 140 }} value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => <option key={r}>{r}</option>)}
          </select>
          <button className="btn btn-primary"><I.IconPlus size={14} /> {t("settings.invite")}</button>
        </form>
      )}
      <div className="card" style={{ padding: 0 }}>
        <table className="table">
          <thead><tr><th>{t("settings.members")}</th><th>{t("settings.role")}</th><th>Last sign-in</th><th /></tr></thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td>{m.name ?? m.email}<div className="small muted">{m.email}</div></td>
                <td>
                  {manage && m.id !== session.user?.id ? (
                    <select className="select input-sm" style={{ width: 120 }} value={m.role} onChange={async (e) => { try { await api.patch(ws(`/members/${m.id}`), { role: e.target.value }); void load(); } catch (err) { toast((err as Error).message, "error"); } }}>
                      {ROLES.map((r) => <option key={r}>{r}</option>)}
                    </select>
                  ) : <span className="badge">{m.role}</span>}
                </td>
                <td className="small muted">{m.last_login_at ? new Date(m.last_login_at).toLocaleString() : "—"}</td>
                <td>
                  {manage && m.id !== session.user?.id && (
                    <button className="icon-btn" title="Remove" onClick={async () => { if (await confirmDialog(`Remove ${m.email}?`, { danger: true })) { try { await api.del(ws(`/members/${m.id}`)); void load(); } catch (err) { toast((err as Error).message, "error"); } } }}><I.IconTrash size={14} /></button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AiSettings() {
  const t = useT();
  const role = useSession((s) => s.workspace()?.role ?? "viewer");
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [secrets, setSecrets] = useState<SecretMeta[]>([]);
  const [prov, setProv] = useState({ name: "", baseUrl: "", model: "", keySecretId: "" });
  const load = () => {
    api.get<AiStatus>(ws("/ai/status")).then(setStatus).catch(() => setStatus(null));
    vaultApi.list().then(setSecrets).catch(() => setSecrets([]));
  };
  useEffect(load, []);
  const editable = can(role, "ai.configure");
  if (!status) return <div className="muted">{t("common.loading")}</div>;
  const save = async (patch: Record<string, unknown>) => {
    try {
      await api.put(ws("/ai/settings"), patch);
      load();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  return (
    <div className="col" style={{ gap: 20 }}>
      <div className="card col" style={{ gap: 8, borderColor: "color-mix(in srgb, var(--mfc-success) 45%, var(--mfc-border))" }}>
        <div className="row">
          <I.IconSparkles size={18} style={{ color: "var(--mfc-accent)" }} />
          <div className="card-title grow" style={{ margin: 0 }}>{t("settings.forgeTitle")}</div>
          <span className="badge badge-success">On · no AI</span>
        </div>
        <p className="hint">{t("settings.forgeText")}</p>
      </div>

      <div className="section-label">{t("settings.addons")}</div>
      <div className="card col" style={{ gap: 12 }}>
        <div className="row">
          <label className="row grow" style={{ gap: 8, cursor: editable ? "pointer" : "default" }}>
            <input type="checkbox" disabled={!editable} checked={status.claudeEnabled} onChange={(e) => save({ claudeEnabled: e.target.checked })} />
            <strong>{t("copilot.claudeAddon")}</strong>
          </label>
          {status.claudeEnabled && <span className={`badge ${status.builtIn.configured ? "badge-success" : "badge-warning"}`}>{status.builtIn.configured ? `${t("settings.keySource")}: ${status.builtIn.keySource === "vault" ? `vault (${status.builtIn.keySecretName})` : "server environment"}` : t("copilot.notConfigured")}</span>}
        </div>
        <p className="hint">{t("settings.claudeToggle")}</p>
        {status.claudeEnabled && !status.builtIn.configured && <button className="btn btn-primary" style={{ alignSelf: "flex-start" }} onClick={() => runFunction("vault.copilot-key")}><I.IconVault size={14} /> {t("copilot.configure")}</button>}
        {status.claudeEnabled && (
          <div className="prop-grid" style={{ gridTemplateColumns: "180px 1fr", maxWidth: 640 }}>
            <label>Default model</label>
            <select className="select input-sm" disabled={!editable} value={status.settings.defaultModel} onChange={(e) => save({ defaultModel: e.target.value })}>
              {status.models.map((m) => <option key={m.id} value={m.id}>{m.label} — {m.description}</option>)}
            </select>
            <label>Default effort</label>
            <select className="select input-sm" disabled={!editable} value={status.settings.defaultEffort} onChange={(e) => save({ defaultEffort: e.target.value })}>
              {["low", "medium", "high", "xhigh", "max"].map((e) => <option key={e}>{e}</option>)}
            </select>
            <label>{t("settings.webTools")}</label>
            <input type="checkbox" disabled={!editable} checked={status.settings.webTools} onChange={(e) => save({ webTools: e.target.checked })} />
            <label>Key secret</label>
            <select className="select input-sm" disabled={!editable} value={status.settings.keySecretId ?? ""} onChange={(e) => save({ keySecretId: e.target.value || null })}>
              <option value="">Auto (ANTHROPIC_API_KEY in the vault)</option>
              {secrets.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.environment}</option>)}
            </select>
          </div>
        )}
      </div>

      <div className="card col" style={{ gap: 12 }}>
        <div className="card-title">{t("settings.addProvider")}</div>
        <p className="hint">{t("settings.providersHint")}</p>
        {status.providers.length > 0 && (
          <table className="table">
            <tbody>
              {status.providers.map((p) => (
                <tr key={p.id}>
                  <td><strong>{p.name}</strong><div className="small muted">{p.base_url}</div></td>
                  <td className="mono small">{p.model}</td>
                  <td>{editable && <button className="icon-btn" onClick={async () => { await api.del(ws(`/ai/providers/${p.id}`)); load(); }}><I.IconTrash size={14} /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {editable && (
          <form className="row wrap" onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api.post(ws("/ai/providers"), { ...prov, keySecretId: prov.keySecretId || null });
              setProv({ name: "", baseUrl: "", model: "", keySecretId: "" });
              toast("Provider added", "success");
              load();
            } catch (err) {
              toast((err as Error).message, "error");
            }
          }}>
            <input className="input" style={{ width: 150 }} required placeholder="Name (e.g. OpenAI)" value={prov.name} onChange={(e) => setProv({ ...prov, name: e.target.value })} />
            <input className="input grow" required placeholder="Base URL, e.g. https://api.openai.com/v1" value={prov.baseUrl} onChange={(e) => setProv({ ...prov, baseUrl: e.target.value })} />
            <input className="input" style={{ width: 170 }} required placeholder="Model" value={prov.model} onChange={(e) => setProv({ ...prov, model: e.target.value })} />
            <select className="select" style={{ width: 200 }} value={prov.keySecretId} onChange={(e) => setProv({ ...prov, keySecretId: e.target.value })}>
              <option value="">No API key</option>
              {secrets.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.environment}</option>)}
            </select>
            <button className="btn"><I.IconPlus size={14} /> Add</button>
          </form>
        )}
      </div>
    </div>
  );
}

interface SessionRow {
  id: string;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
  current: boolean;
}

function describeAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

function Sessions() {
  const t = useT();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const load = () => api.get<{ sessions: SessionRow[] }>("/api/auth/sessions").then((r) => setSessions(r.sessions)).catch(() => setSessions([]));
  useEffect(() => {
    void load();
  }, []);
  return (
    <div className="card col" style={{ gap: 10, maxWidth: 640 }}>
      <div className="row">
        <div className="card-title grow" style={{ margin: 0 }}>{t("settings.sessions")}</div>
        {sessions.length > 1 && (
          <button className="btn btn-sm btn-danger" onClick={async () => { const r = await api.post<{ revoked: number }>("/api/auth/sessions/revoke-others"); toast(t("settings.revoked", { n: r.revoked }), "success"); void load(); }}>
            {t("settings.signOutOthers")}
          </button>
        )}
      </div>
      {sessions.map((s) => (
        <div key={s.id} className="row small">
          <I.IconDesktop size={15} className="muted" />
          <span className="grow">{describeAgent(s.user_agent)} {s.current && <span className="badge badge-success">{t("settings.thisDevice")}</span>}</span>
          <span className="muted">{new Date(s.last_seen_at).toLocaleString()}</span>
          {!s.current && <button className="icon-btn" title={t("shell.signOut")} onClick={async () => { await api.del(`/api/auth/sessions/${s.id}`); void load(); }}><I.IconLogout size={14} /></button>}
        </div>
      ))}
    </div>
  );
}

function Account() {
  const t = useT();
  const { user, refresh } = useSession();
  const [name, setName] = useState(user?.name ?? "");
  return (
    <div className="col" style={{ gap: 20 }}>
    <form className="card col" style={{ gap: 12, maxWidth: 480 }} onSubmit={async (e) => { e.preventDefault(); await api.patch("/api/auth/me", { name }); await refresh(); toast(t("common.saved"), "success"); }}>
      <div className="field"><label>Email</label><input className="input" value={user?.email ?? ""} disabled /></div>
      <div className="field"><label>{t("common.name")}</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="row">
        <button className="btn btn-primary">{t("common.save")}</button>
        <button type="button" className="btn btn-ghost" onClick={() => runFunction("ui.onboarding")}>Replay welcome tour</button>
      </div>
    </form>
    <Sessions />
    </div>
  );
}

export default function SettingsPage() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "appearance";
  const tabs: Array<[Tab, string, typeof I.IconHome]> = [
    ["appearance", t("settings.appearance"), I.IconPalette],
    ["language", t("settings.language"), I.IconLanguages],
    ["workspace", t("settings.workspace"), I.IconCollab],
    ["billing", t("settings.billing"), I.IconCard],
    ["ai", t("settings.ai"), I.IconSparkles],
    ["devices", t("settings.devices"), I.IconPhone],
    ["account", t("settings.account"), I.IconSettings],
  ];
  return (
    <div className="page">
      <div className="page-narrow">
        <div className="page-header"><h1 className="page-title">{t("nav.settings")}</h1></div>
        <div className="tabs" style={{ marginBottom: 20, padding: 0 }}>
          {tabs.map(([id, label, Icon]) => (
            <button key={id} className={`tab row ${tab === id ? "active" : ""}`} style={{ gap: 6 }} onClick={() => setParams({ tab: id })}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
        {tab === "appearance" && <Appearance />}
        {tab === "language" && <Language />}
        {tab === "workspace" && <Workspace />}
        {tab === "billing" && <Billing />}
        {tab === "ai" && <AiSettings />}
        {tab === "devices" && <Devices />}
        {tab === "account" && <Account />}
      </div>
    </div>
  );
}
