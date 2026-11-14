import { useEffect, useMemo, useState } from "react";
import { ENVIRONMENTS, can, type Environment, type LeakFinding } from "@mfc/core";
import { useT, useI18n, relativeTime } from "../../lib/i18n";
import { useSession } from "../../lib/session";
import { projectsApi, type ProjectSummary } from "../../lib/projects";
import { toast } from "../../lib/ui";
import { downloadText, pickFile } from "../../lib/download";
import { ApiError } from "../../lib/api";
import { vaultApi, useVaultUi, type SecretMeta } from "./vaultApi";
import * as I from "../../ui/icons";
import { confirmDialog } from "../../ui/dialog";

/** Cryptographically random value for passwords, JWT/session secrets and API tokens. */
export function generateSecret(length = 48): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_";
  const limit = 256 - (256 % alphabet.length); // reject biased bytes
  let out = "";
  while (out.length < length) {
    for (const b of crypto.getRandomValues(new Uint8Array(length * 2))) if (b < limit && out.length < length) out += alphabet[b % alphabet.length];
  }
  return out;
}

const STATUS_CLASS: Record<SecretMeta["status"], string> = { ok: "badge-success", expiring: "badge-warning", expired: "badge-danger", rotation_due: "badge-warning" };
const ENV_CLASS: Record<Environment, string> = { development: "", staging: "badge-accent", production: "badge-danger" };

function Modal({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="overlay overlay-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={wide ? { width: "min(760px, calc(100vw - 32px))" } : undefined}>
        <div className="row">
          <div className="modal-title grow">{title}</div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><I.IconClose size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ScopeSelect({ value, onChange, projects }: { value: string; onChange: (v: string) => void; projects: ProjectSummary[] }) {
  const t = useT();
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{t("vault.scope.workspace")}</option>
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

function EnvSelect({ value, onChange }: { value: Environment; onChange: (v: Environment) => void }) {
  const t = useT();
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value as Environment)}>
      {ENVIRONMENTS.map((e) => (
        <option key={e} value={e}>
          {t(`vault.env.${e}`)}
        </option>
      ))}
    </select>
  );
}

function NewSecretModal({ projects, onClose }: { projects: ProjectSummary[]; onClose: () => void }) {
  const t = useT();
  const preset = useVaultUi((s) => s.preset);
  const [name, setName] = useState(preset?.name ?? "");
  const [value, setValue] = useState("");
  const [show, setShow] = useState(false);
  const [env, setEnv] = useState<Environment>(preset?.environment ?? "development");
  const [scope, setScope] = useState("");
  const [description, setDescription] = useState("");
  const [expires, setExpires] = useState("");
  const [rotation, setRotation] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await vaultApi.create({ name: name.trim(), value, environment: env, projectId: scope || null, description, expiresAt: expires ? new Date(expires).toISOString() : null, rotationDays: rotation ? Number(rotation) : null });
      toast(`${name} saved to the vault`, "success");
      useVaultUi.getState().bump();
      onClose();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={t("vault.newSecret")} onClose={onClose}>
      <form className="col" style={{ gap: 12, marginTop: 12 }} onSubmit={submit}>
        <div className="field">
          <label>{t("common.name")}</label>
          <input className="input mono" autoFocus required value={name} onChange={(e) => setName(e.target.value.toUpperCase().replace(/[^A-Z0-9_.-]/g, "_"))} placeholder="STRIPE_SECRET_KEY" />
        </div>
        <div className="field">
          <label>{t("vault.value")}</label>
          <div className="row" style={{ gap: 6 }}>
            {show ? (
              <textarea className="textarea mono" required rows={3} value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" spellCheck={false} />
            ) : (
              <input className="input mono" type="password" required value={value} onChange={(e) => setValue(e.target.value)} autoComplete="new-password" />
            )}
            <button type="button" className="icon-btn" onClick={() => setShow(!show)} aria-label={show ? t("vault.hide") : t("vault.reveal")}>
              {show ? <I.IconEyeOff size={16} /> : <I.IconEye size={16} />}
            </button>
            <button type="button" className="icon-btn" title={t("vault.generate")} aria-label={t("vault.generate")} onClick={() => (setValue(generateSecret()), setShow(true))}>
              <I.IconWand size={16} />
            </button>
          </div>
        </div>
        <div className="row wrap">
          <div className="field grow">
            <label>{t("vault.environment")}</label>
            <EnvSelect value={env} onChange={setEnv} />
          </div>
          <div className="field grow">
            <label>{t("vault.scope")}</label>
            <ScopeSelect value={scope} onChange={setScope} projects={projects} />
          </div>
        </div>
        <div className="field">
          <label>{t("common.description")}</label>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Used by the checkout service" />
        </div>
        <div className="row wrap">
          <div className="field grow">
            <label>{t("vault.expires")}</label>
            <input className="input" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
          </div>
          <div className="field grow">
            <label>{t("vault.rotationDays")}</label>
            <input className="input" type="number" min={1} value={rotation} onChange={(e) => setRotation(e.target.value)} placeholder="90" />
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
          <button className="btn btn-primary" disabled={busy}><I.IconLock size={14} /> {t("common.save")}</button>
        </div>
      </form>
    </Modal>
  );
}

function ImportModal({ projects, onClose }: { projects: ProjectSummary[]; onClose: () => void }) {
  const t = useT();
  const [content, setContent] = useState("");
  const [env, setEnv] = useState<Environment>("development");
  const [scope, setScope] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const r = await vaultApi.importEnv({ environment: env, projectId: scope || null, content, overwrite });
      toast(t("vault.importResult", { created: r.created.length, rotated: r.rotated.length, skipped: r.skipped.length }) + (r.errors.length ? ` · ${r.errors.join("; ")}` : ""), r.errors.length ? "warning" : "success");
      useVaultUi.getState().bump();
      onClose();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={t("vault.import")} onClose={onClose} wide>
      <div className="col" style={{ gap: 12, marginTop: 12 }}>
        <div className="row wrap">
          <div className="field grow"><label>{t("vault.environment")}</label><EnvSelect value={env} onChange={setEnv} /></div>
          <div className="field grow"><label>{t("vault.scope")}</label><ScopeSelect value={scope} onChange={setScope} projects={projects} /></div>
        </div>
        <textarea className="textarea mono" rows={10} value={content} onChange={(e) => setContent(e.target.value)} placeholder={"# Paste a .env file\nDATABASE_URL=postgres://...\nSTRIPE_SECRET_KEY=sk_live_..."} spellCheck={false} />
        <div className="row">
          <button className="btn btn-sm" onClick={async () => { const f = await pickFile(".env,.txt,text/plain,*"); if (f) setContent(await f.text()); }}>
            <I.IconUpload size={14} /> Choose file
          </button>
          <label className="row small" style={{ gap: 6 }}>
            <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} /> {t("vault.overwrite")}
          </label>
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
          <button className="btn btn-primary" disabled={busy || !content.trim()} onClick={submit}>{t("common.import")}</button>
        </div>
      </div>
    </Modal>
  );
}

function ExportModal({ projects, onClose }: { projects: ProjectSummary[]; onClose: () => void }) {
  const t = useT();
  const [env, setEnv] = useState<Environment>("development");
  const [scope, setScope] = useState("");
  const [vars, setVars] = useState<Array<{ name: string; source: string }> | null>(null);
  useEffect(() => {
    vaultApi.resolve(env, scope || null).then(setVars).catch(() => setVars([]));
  }, [env, scope]);
  const doExport = async () => {
    try {
      const r = await vaultApi.exportEnv({ environment: env, projectId: scope || null });
      downloadText(r.filename, r.content);
      toast("Exported — this file contains secrets. Never commit it.", "warning");
      onClose();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };
  return (
    <Modal title={t("vault.export")} onClose={onClose}>
      <div className="col" style={{ gap: 12, marginTop: 12 }}>
        <div className="row wrap">
          <div className="field grow"><label>{t("vault.environment")}</label><EnvSelect value={env} onChange={setEnv} /></div>
          <div className="field grow"><label>{t("vault.scope")}</label><ScopeSelect value={scope} onChange={setScope} projects={projects} /></div>
        </div>
        <div className="section-label">{t("vault.deployPreview")}</div>
        <div className="card" style={{ padding: 10, maxHeight: 220, overflow: "auto" }}>
          {vars === null ? <span className="muted">{t("common.loading")}</span> : vars.length === 0 ? <span className="muted">{t("common.none")}</span> : vars.map((v) => (
            <div key={v.name} className="row small" style={{ justifyContent: "space-between", padding: "3px 0" }}>
              <code>{v.name}</code>
              <span className={`badge ${v.source === "project" ? "badge-accent" : ""}`}>{v.source}</span>
            </div>
          ))}
        </div>
        <p className="hint">Project-scoped secrets override workspace secrets with the same name. Exports are audited.</p>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
          <button className="btn btn-primary" disabled={!vars?.length} onClick={doExport}><I.IconDownload size={14} /> {t("common.export")}</button>
        </div>
      </div>
    </Modal>
  );
}

function ScanModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [text, setText] = useState("");
  const [findings, setFindings] = useState<LeakFinding[] | null>(null);
  return (
    <Modal title={t("vault.scan")} onClose={onClose} wide>
      <div className="col" style={{ gap: 12, marginTop: 12 }}>
        <textarea className="textarea mono" rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("vault.scanPlaceholder")} spellCheck={false} />
        <div className="row">
          <button className="btn btn-primary" disabled={!text.trim()} onClick={() => vaultApi.scan(text).then(setFindings).catch((e: Error) => toast(e.message, "error"))}>
            <I.IconScan size={14} /> {t("vault.scan")}
          </button>
          <button className="btn" onClick={async () => { const f = await pickFile("*"); if (f) setText(await f.text()); }}><I.IconUpload size={14} /> Choose file</button>
        </div>
        {findings && (findings.length === 0 ? (
          <div className="badge badge-success">{t("vault.scanClean")}</div>
        ) : (
          <table className="table">
            <thead><tr><th>Line</th><th>Type</th><th>Severity</th><th>Preview</th></tr></thead>
            <tbody>
              {findings.map((f, i) => (
                <tr key={i}>
                  <td>{f.line}:{f.column}</td>
                  <td>{f.title}</td>
                  <td><span className={`badge ${f.severity === "critical" ? "badge-danger" : "badge-warning"}`}>{f.severity}</span></td>
                  <td><code>{f.preview}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
    </Modal>
  );
}

function SecretRow({ s, projects, canReveal, canWrite }: { s: SecretMeta; projects: ProjectSummary[]; canReveal: boolean; canWrite: boolean }) {
  const t = useT();
  const locale = useI18n((x) => x.locale);
  const [value, setValue] = useState<string | null>(null);
  const [panel, setPanel] = useState<"rotate" | "versions" | "edit" | null>(null);
  const [newValue, setNewValue] = useState("");
  const [versions, setVersions] = useState<Awaited<ReturnType<typeof vaultApi.versions>> | null>(null);
  const [edit, setEdit] = useState({ description: s.description, expires: s.expires_at?.slice(0, 10) ?? "", rotation: s.rotation_days?.toString() ?? "" });

  useEffect(() => {
    if (value === null) return;
    const h = setTimeout(() => setValue(null), 30_000); // auto-hide revealed values
    return () => clearTimeout(h);
  }, [value]);

  const reveal = async () => {
    if (value !== null) return setValue(null);
    try {
      setValue((await vaultApi.reveal(s.id)).value);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  const copy = async () => {
    try {
      const v = value ?? (await vaultApi.reveal(s.id)).value;
      await navigator.clipboard.writeText(v);
      toast(t("vault.copiedClears", { name: s.name }), "success");
      // Clear the clipboard after 30 s if it still holds this secret (best effort; needs focus).
      setTimeout(() => {
        void navigator.clipboard.readText().then((cur): unknown => cur === v && navigator.clipboard.writeText("")).catch(() => undefined);
      }, 30_000);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Clipboard unavailable", "error");
    }
  };
  const project = projects.find((p) => p.id === s.project_id);
  const refresh = () => useVaultUi.getState().bump();

  return (
    <>
      <tr>
        <td>
          <div className="mono" style={{ fontWeight: 600 }}>{s.name}</div>
          {s.description && <div className="small muted ellipsis" style={{ maxWidth: 280 }}>{s.description}</div>}
        </td>
        <td><span className={`badge ${ENV_CLASS[s.environment]}`}>{t(`vault.env.${s.environment}`)}</span></td>
        <td className="small">{project?.name ?? <span className="muted">{t("vault.scope.workspace")}</span>}</td>
        <td className="mono small" style={{ minWidth: 200 }}>
          {value !== null ? <span style={{ wordBreak: "break-all" }}>{value}</span> : <span className="muted">••••••••••••</span>}
        </td>
        <td><span className={`badge ${STATUS_CLASS[s.status]}`}>{t(`vault.status.${s.status}`)}</span></td>
        <td className="small muted">v{s.current_version} · {relativeTime(s.updated_at, locale)}</td>
        <td>
          <div className="row" style={{ gap: 2, justifyContent: "flex-end" }}>
            {canReveal && <button className="icon-btn" title={value !== null ? t("vault.hide") : t("vault.reveal")} onClick={reveal}>{value !== null ? <I.IconEyeOff size={15} /> : <I.IconEye size={15} />}</button>}
            {canReveal && <button className="icon-btn" title={t("common.copy")} onClick={copy}><I.IconCopy size={15} /></button>}
            {canWrite && <button className="icon-btn" title={t("vault.rotate")} onClick={() => setPanel(panel === "rotate" ? null : "rotate")}><I.IconRotate size={15} /></button>}
            <button className="icon-btn" title={t("vault.versions")} onClick={() => { setPanel(panel === "versions" ? null : "versions"); vaultApi.versions(s.id).then(setVersions); }}><I.IconHistory size={15} /></button>
            {canWrite && <button className="icon-btn" title={t("common.edit")} onClick={() => setPanel(panel === "edit" ? null : "edit")}><I.IconSettings size={15} /></button>}
            {canWrite && <button className="icon-btn" title={t("common.delete")} onClick={async () => { if (await confirmDialog(`${t("common.delete")} ${s.name} (${s.environment})?`, { danger: true, ok: t("common.delete") })) { await vaultApi.remove(s.id); refresh(); } }}><I.IconTrash size={15} /></button>}
          </div>
        </td>
      </tr>
      {panel && (
        <tr>
          <td colSpan={7} style={{ background: "var(--mfc-surface-2)" }}>
            {panel === "rotate" && (
              <form className="row" onSubmit={async (e) => { e.preventDefault(); try { await vaultApi.rotate(s.id, newValue); setNewValue(""); setPanel(null); setValue(null); toast(`${s.name} rotated`, "success"); refresh(); } catch (err) { toast((err as Error).message, "error"); } }}>
                <input className="input mono grow" type="password" autoComplete="new-password" required placeholder={`New value for ${s.name}`} value={newValue} onChange={(e) => setNewValue(e.target.value)} />
                <button type="button" className="btn" title={t("vault.generate")} onClick={() => setNewValue(generateSecret())}><I.IconWand size={14} /> {t("vault.generate")}</button>
                <button className="btn btn-primary">{t("vault.rotate")}</button>
              </form>
            )}
            {panel === "versions" && (
              <div className="col" style={{ gap: 4 }}>
                {versions === null ? <span className="muted">{t("common.loading")}</span> : versions.map((v) => (
                  <div key={v.version} className="row small">
                    <span className="mono" style={{ width: 40 }}>v{v.version}</span>
                    <span className="muted grow">{new Date(v.created_at).toLocaleString(locale)} · {v.created_by ?? "—"} · key {v.key_id}</span>
                    {canWrite && v.version !== s.current_version && <button className="btn btn-sm" onClick={async () => { await vaultApi.rollback(s.id, v.version); toast(`Rolled back to v${v.version}`, "success"); setPanel(null); refresh(); }}>{t("vault.rollback")}</button>}
                  </div>
                ))}
              </div>
            )}
            {panel === "edit" && (
              <form className="row wrap" onSubmit={async (e) => { e.preventDefault(); await vaultApi.patch(s.id, { description: edit.description, expiresAt: edit.expires ? new Date(edit.expires).toISOString() : null, rotationDays: edit.rotation ? Number(edit.rotation) : null }); setPanel(null); refresh(); }}>
                <input className="input grow" placeholder={t("common.description")} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
                <input className="input" style={{ width: 160 }} type="date" value={edit.expires} onChange={(e) => setEdit({ ...edit, expires: e.target.value })} title={t("vault.expires")} />
                <input className="input" style={{ width: 130 }} type="number" min={1} placeholder={t("vault.rotationDays")} value={edit.rotation} onChange={(e) => setEdit({ ...edit, rotation: e.target.value })} />
                <button className="btn btn-primary">{t("common.save")}</button>
              </form>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export default function VaultPage() {
  const t = useT();
  const role = useSession((s) => s.workspace()?.role ?? "viewer");
  const workspaceId = useSession((s) => s.workspaceId);
  const { modal, open, version } = useVaultUi();
  const [secrets, setSecrets] = useState<SecretMeta[] | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [env, setEnv] = useState<"" | Environment>("");
  const [query, setQuery] = useState("");
  const [alertsOnly, setAlertsOnly] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    vaultApi.list().then(setSecrets).catch((e: Error) => (toast(e.message, "error"), setSecrets([])));
    projectsApi.list().then(setProjects).catch(() => setProjects([]));
  }, [workspaceId, version]);

  const visible = useMemo(
    () => (secrets ?? []).filter((s) => (!env || s.environment === env) && (!alertsOnly || s.status !== "ok") && (`${s.name} ${s.description}`.toLowerCase().includes(query.toLowerCase()))),
    [secrets, env, query, alertsOnly],
  );
  const alerts = (secrets ?? []).filter((s) => s.status !== "ok").length;
  const canWrite = can(role, "secrets.write");

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="row" style={{ gap: 10 }}>
            <I.IconShield size={24} />
            <h1 className="page-title">{t("vault.title")}</h1>
          </div>
          <p className="page-subtitle">{t("vault.subtitle")}</p>
        </div>
        <div className="row wrap">
          <button className="btn" onClick={() => open("scan")}><I.IconScan size={15} /> {t("vault.scan")}</button>
          {canWrite && <button className="btn" onClick={() => open("import")}><I.IconUpload size={15} /> {t("vault.import")}</button>}
          {can(role, "secrets.export") && <button className="btn" onClick={() => open("export")}><I.IconDownload size={15} /> {t("vault.export")}</button>}
          {canWrite && <button className="btn btn-primary" onClick={() => open("new")}><I.IconPlus size={15} /> {t("vault.newSecret")}</button>}
        </div>
      </div>


      <div className="row wrap" style={{ marginBottom: 12 }}>
        <div className="tabs" style={{ border: 0, padding: 0 }}>
          {(["", ...ENVIRONMENTS] as Array<"" | Environment>).map((e) => (
            <button key={e || "all"} className={`tab ${env === e ? "active" : ""}`} onClick={() => setEnv(e)}>
              {e ? t(`vault.env.${e}`) : "All"} ({(secrets ?? []).filter((s) => !e || s.environment === e).length})
            </button>
          ))}
        </div>
        <div className="grow" />
        {alerts > 0 && (
          <button className={`btn btn-sm ${alertsOnly ? "btn-primary" : ""}`} onClick={() => setAlertsOnly(!alertsOnly)}>
            <I.IconWarning size={14} /> {alerts}
          </button>
        )}
        <input className="input input-sm" style={{ width: 240 }} placeholder={t("common.search")} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {secrets === null ? (
        <div className="muted">{t("common.loading")}</div>
      ) : visible.length === 0 ? (
        <div className="empty">{t("vault.empty")}</div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>{t("common.name")}</th>
                <th>{t("vault.environment")}</th>
                <th>{t("vault.scope")}</th>
                <th>{t("vault.value")}</th>
                <th>Status</th>
                <th>{t("vault.versions")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((s) => (
                <SecretRow key={s.id} s={s} projects={projects} canReveal={can(role, "secrets.reveal")} canWrite={canWrite} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal === "new" && <NewSecretModal projects={projects} onClose={() => open(null)} />}
      {modal === "import" && <ImportModal projects={projects} onClose={() => open(null)} />}
      {modal === "export" && <ExportModal projects={projects} onClose={() => open(null)} />}
      {modal === "scan" && <ScanModal onClose={() => open(null)} />}
    </div>
  );
}
