import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useT, useI18n, relativeTime } from "../../lib/i18n";
import { useSession, ws } from "../../lib/session";
import { api } from "../../lib/api";
import { registry, runFunction } from "../../lib/registry";
import { editorPath, PROJECT_KINDS, projectsApi, type ProjectKind, type ProjectSummary } from "../../lib/projects";
import { toast } from "../../lib/ui";
import * as I from "../../ui/icons";

const KIND_ICON: Record<ProjectKind, typeof I.IconHome> = { site: I.IconGlobe, panel: I.IconHome, app: I.IconPhone, api: I.IconCode, scene3d: I.IconStudio };

export function NewProjectModal({ onClose, defaultKind = "site" }: { onClose: () => void; defaultKind?: ProjectKind }) {
  const t = useT();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ProjectKind>(defaultKind);
  const [busy, setBusy] = useState(false);
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const p = await projectsApi.create(name || t(`home.kind.${kind}`), kind);
      onClose();
      navigate(editorPath(kind, p.id));
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="overlay overlay-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={create}>
        <div className="modal-title">{t("home.newProject")}</div>
        <div className="col" style={{ marginTop: 14, gap: 14 }}>
          <div className="field">
            <label>{t("common.name")}</label>
            <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t(`home.kind.${kind}`)} />
          </div>
          <div className="grid-auto" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
            {PROJECT_KINDS.map((k) => {
              const Icon = KIND_ICON[k];
              return (
                <button type="button" key={k} className={`btn ${k === kind ? "btn-primary" : ""}`} style={{ height: 64, flexDirection: "column", gap: 4 }} onClick={() => setKind(k)}>
                  <Icon size={18} />
                  <span className="small">{t(`home.kind.${k}`)}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className="btn btn-primary" disabled={busy}>
            {t("common.create")}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function HomePage() {
  const t = useT();
  const locale = useI18n((s) => s.locale);
  const navigate = useNavigate();
  const user = useSession((s) => s.user);
  const workspaceId = useSession((s) => s.workspaceId);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [secrets, setSecrets] = useState<{ total: number; alerts: number } | null>(null);
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    projectsApi.list().then(setProjects).catch(() => setProjects([]));
    api
      .get<{ secrets: Array<{ status: string }> }>(ws("/secrets"))
      .then((r) => setSecrets({ total: r.secrets.length, alerts: r.secrets.filter((s) => s.status !== "ok").length }))
      .catch(() => setSecrets(null));
  }, [workspaceId]);

  const reload = () => projectsApi.list().then(setProjects).catch(() => setProjects([]));
  const renameProject = async (p: ProjectSummary) => {
    const name = window.prompt(t("home.rename"), p.name)?.trim();
    if (!name || name === p.name) return;
    try {
      await projectsApi.rename(p.id, name);
      void reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  const duplicateProject = async (p: ProjectSummary) => {
    try {
      await projectsApi.duplicate(p.id);
      toast(t("home.duplicated", { name: p.name }), "success");
      void reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  const deleteProject = async (p: ProjectSummary) => {
    if (!window.confirm(t("home.deleteConfirm", { name: p.name }))) return;
    try {
      await projectsApi.remove(p.id);
      toast(t("home.deleted", { name: p.name }), "success");
      void reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const stats = [
    { label: t("home.stats.functions"), value: registry.size, Icon: I.IconCommand },
    { label: t("home.stats.projects"), value: projects?.length ?? "—", Icon: I.IconFolder },
    { label: t("home.stats.secrets"), value: secrets?.total ?? "—", Icon: I.IconVault },
    { label: t("home.stats.alerts"), value: secrets?.alerts ?? "—", Icon: I.IconWarning, warn: (secrets?.alerts ?? 0) > 0 },
  ];
  const quick: Array<[string, string, typeof I.IconHome]> = [
    ["builder.template.saas-landing", "SaaS landing page", I.IconGlobe],
    ["builder.template.admin-dashboard", "Admin dashboard", I.IconHome],
    ["studio.preset.product-showcase", "3D product showcase", I.IconStudio],
    ["vault.new", t("vault.newSecret"), I.IconVault],
    ["copilot.open", "Ask Forge", I.IconSparkles],
    ["ui.palette", t("shell.palette"), I.IconSearch],
  ];

  return (
    <div className="page">
      <div className="page-narrow">
        <div className="page-header">
          <div>
            <h1 className="page-title">
              {t("home.welcome")}
              {user?.name ? `, ${user.name}` : ""}
            </h1>
            <p className="page-subtitle">{t("home.subtitle")}</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowNew(true)}>
            <I.IconPlus size={16} /> {t("home.newProject")}
          </button>
        </div>

        <div className="grid-auto" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", marginBottom: 24 }}>
          {stats.map((s) => (
            <div key={s.label} className="card">
              <div className="row muted small">
                <s.Icon size={15} /> {s.label}
              </div>
              <div style={{ fontSize: 28, fontWeight: 700, marginTop: 6, color: s.warn ? "var(--mfc-warning)" : undefined }}>{s.value}</div>
            </div>
          ))}
        </div>

        <div className="section-label">{t("home.quick")}</div>
        <div className="row wrap" style={{ marginBottom: 28 }}>
          {quick.map(([id, label, Icon]) => (
            <button key={id} className="btn" onClick={() => runFunction(id).catch((e: Error) => toast(e.message, "error"))}>
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>

        <div className="section-label">{t("home.projects")}</div>
        {projects === null ? (
          <div className="muted">{t("common.loading")}</div>
        ) : projects.length === 0 ? (
          <div className="empty">{t("home.empty")}</div>
        ) : (
          <div className="grid-auto">
            {projects.map((p) => {
              const Icon = KIND_ICON[p.kind] ?? I.IconFolder;
              const open = () => navigate(editorPath(p.kind, p.id));
              return (
                <div
                  key={p.id}
                  className="card project-card"
                  role="button"
                  tabIndex={0}
                  aria-label={`${t("common.open")} ${p.name}`}
                  onClick={open}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), open())}
                >
                  <div className="row">
                    <span className="icon-btn active" style={{ pointerEvents: "none" }}>
                      <Icon size={17} />
                    </span>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="card-title ellipsis">{p.name}</div>
                      <div className="small muted">
                        {t(`home.kind.${p.kind}`)} · {t("home.updated", { when: relativeTime(p.updated_at, locale) })}
                      </div>
                    </div>
                  </div>
                  <div className="row project-actions" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                    <button className="icon-btn" title={t("home.rename")} aria-label={t("home.rename")} onClick={() => void renameProject(p)}><I.IconType size={14} /></button>
                    <button className="icon-btn" title={t("home.duplicate")} aria-label={t("home.duplicate")} onClick={() => void duplicateProject(p)}><I.IconCopy size={14} /></button>
                    <button className="icon-btn" title={t("common.delete")} aria-label={t("common.delete")} onClick={() => void deleteProject(p)}><I.IconTrash size={14} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {showNew && <NewProjectModal onClose={() => setShowNew(false)} />}
    </div>
  );
}
