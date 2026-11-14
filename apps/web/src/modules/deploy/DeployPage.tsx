import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { can, ENVIRONMENTS, type Environment } from "@mfc/core";
import { deployApi, KIND_FIELDS, TARGET_KINDS, toBase64, type Deployment, type Target, type TargetKind } from "./deployApi";
import { projectsApi, type ProjectSummary } from "../../lib/projects";
import { vaultApi, type SecretMeta } from "../vault/vaultApi";
import { api } from "../../lib/api";
import { ws, useSession } from "../../lib/session";
import { useT } from "../../lib/i18n";
import { toast } from "../../lib/ui";
import { confirmDialog } from "../../ui/dialog";
import { runFunction } from "../../lib/registry";
import type { BuilderDoc } from "../builder/model";
import * as I from "../../ui/icons";

const KIND_LABEL: Record<TargetKind, string> = { vercel: "Vercel", netlify: "Netlify", github: "GitHub", s3: "S3 / R2 / Spaces", ssh: "SSH server", webhook: "Webhook" };
const fmtBytes = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function StatusBadge({ s, t }: { s: Deployment["status"]; t: (k: string) => string }) {
  const map = { ready: ["badge-success", "✓"], failed: ["badge-danger", "✕"], building: ["badge-accent", "…"] } as const;
  return <span className={`badge ${map[s][0]}`}>{map[s][1]} {t(`deploy.status.${s}`)}</span>;
}

function TargetForm({ initial, secrets, onSaved, onCancel }: { initial?: Target; secrets: SecretMeta[]; onSaved: () => void; onCancel: () => void }) {
  const t = useT();
  const [kind, setKind] = useState<TargetKind>(initial?.kind ?? "vercel");
  const [name, setName] = useState(initial?.name ?? "");
  const [config, setConfig] = useState<Record<string, string>>(initial?.config ?? {});
  const [secretId, setSecretId] = useState(initial?.secret_id ?? "");
  const [env, setEnv] = useState<Environment>(initial?.environment ?? "production");
  const spec = KIND_FIELDS[kind];
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = { name: name || KIND_LABEL[kind], kind, config, secretId: secretId || null, environment: env };
    try {
      if (initial) await deployApi.updateTarget(initial.id, body);
      else await deployApi.createTarget(body);
      toast(t("common.saved"), "success");
      onSaved();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };
  return (
    <form className="card col" style={{ gap: 10 }} onSubmit={save}>
      <div className="row wrap" style={{ gap: 6 }}>
        {TARGET_KINDS.map((k) => (
          <button type="button" key={k} className={`btn btn-sm ${k === kind ? "btn-primary" : ""}`} onClick={() => (setKind(k), setConfig({}))}>{KIND_LABEL[k]}</button>
        ))}
      </div>
      <p className="hint">{spec.docs}</p>
      <div className="grid-auto" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 240px), 1fr))", gap: 10 }}>
        <label className="col" style={{ gap: 4 }}><span className="label">{t("common.name")}</span><input className="input" value={name} placeholder={KIND_LABEL[kind]} onChange={(e) => setName(e.target.value)} /></label>
        <label className="col" style={{ gap: 4 }}><span className="label">{t("deploy.environment")}</span>
          <select className="select" value={env} onChange={(e) => setEnv(e.target.value as Environment)}>{ENVIRONMENTS.map((x) => <option key={x} value={x}>{t(`vault.env.${x}`)}</option>)}</select></label>
        {spec.fields.map((f) =>
          f.type === "check" ? (
            <label key={f.key} className="row small" style={{ gap: 6, alignSelf: "end" }}><input type="checkbox" checked={config[f.key] === "1"} onChange={(e) => setConfig({ ...config, [f.key]: e.target.checked ? "1" : "" })} /> {f.label}</label>
          ) : (
            <label key={f.key} className="col" style={{ gap: 4 }}><span className="label">{f.label}{f.required ? " *" : ""}</span><input className="input mono" required={f.required} placeholder={f.placeholder} value={config[f.key] ?? ""} onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })} /></label>
          ),
        )}
        <label className="col" style={{ gap: 4 }}><span className="label">{t("deploy.credentials")} *</span>
          <select className="select" required={kind !== "webhook"} value={secretId} onChange={(e) => setSecretId(e.target.value)}>
            <option value="">{t("data.pickSecret")}</option>
            {secrets.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.environment}</option>)}
          </select>
          <span className="hint">{spec.secret}</span></label>
      </div>
      <div className="row">
        <button className="btn btn-primary">{t("common.save")}</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>{t("common.cancel")}</button>
        <div className="grow" />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => runFunction("vault.new")}><I.IconPlus size={13} /> {t("vault.newSecret")}</button>
      </div>
    </form>
  );
}

export default function DeployPage() {
  const t = useT();
  const role = useSession((s) => s.workspace()?.role ?? "viewer");
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as "deploy" | "targets" | "history") ?? "deploy";
  const [targets, setTargets] = useState<Target[]>([]);
  const [secrets, setSecrets] = useState<SecretMeta[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [history, setHistory] = useState<Deployment[]>([]);
  const [sites, setSites] = useState<Array<{ id: string; name: string }>>([]);
  const [editing, setEditing] = useState<Target | "new" | null>(null);
  const [source, setSource] = useState<string>(params.get("project") ?? "");
  const [upload, setUpload] = useState<Array<{ path: string; data: string; size: number }> | null>(null);
  const [targetId, setTargetId] = useState("");
  const [inject, setInject] = useState(false);
  const [siteId, setSiteId] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Deployment | null>(null);
  const [openLog, setOpenLog] = useState<Deployment | null>(null);

  const reload = () => {
    deployApi.targets().then(setTargets).catch(() => setTargets([]));
    deployApi.deployments().then(setHistory).catch(() => setHistory([]));
    vaultApi.list().then(setSecrets).catch(() => setSecrets([]));
    projectsApi.list().then((p) => setProjects(p.filter((x) => x.kind === "site" || x.kind === "panel" || x.kind === "app"))).catch(() => setProjects([]));
    api.get<{ sites: Array<{ id: string; name: string }> }>(ws("/monitoring/sites")).then((r) => setSites(r.sites)).catch(() => setSites([]));
  };
  useEffect(reload, []);
  useEffect(() => {
    if (!targetId && targets[0]) setTargetId(targets[0].id);
  }, [targets, targetId]);
  const target = targets.find((x) => x.id === targetId);
  const project = projects.find((p) => p.id === source);
  const canTargets = can(role, "deploy.targets");
  const canRun = can(role, "deploy.run");

  const pickFolder = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;
    input.onchange = async () => {
      const files = [...(input.files ?? [])];
      if (!files.length) return;
      const root = (files[0] as File & { webkitRelativePath: string }).webkitRelativePath.split("/")[0];
      const out = await Promise.all(files.filter((f) => !/(^|\/)\.(git|DS_Store)/.test((f as File & { webkitRelativePath: string }).webkitRelativePath)).map(async (f) => ({ path: (f as File & { webkitRelativePath: string }).webkitRelativePath.slice(root.length + 1), data: toBase64(new Uint8Array(await f.arrayBuffer())), size: f.size })));
      setUpload(out);
      setSource("__upload");
    };
    input.click();
  };

  const run = async () => {
    if (!target) return;
    setBusy(true);
    setResult(null);
    try {
      let files: Array<{ path: string; data: string }>;
      let name: string;
      if (source === "__upload") {
        if (!upload?.length) throw new Error(t("deploy.pickSomething"));
        files = upload.map(({ path, data }) => ({ path, data }));
        name = t("deploy.uploadedFolder");
      } else {
        if (!project) throw new Error(t("deploy.pickSomething"));
        const full = await projectsApi.get<BuilderDoc>(project.id);
        if (!full.data?.pages?.length) throw new Error(t("deploy.emptyProject"));
        const { staticSite } = await import("../builder/projectExport");
        const out = staticSite(full.data, full.name);
        files = Object.entries(out).map(([path, content]) => ({ path, data: toBase64(content) }));
        name = full.name;
      }
      const d = await deployApi.deploy(target.id, { name, projectId: project?.id ?? null, files, injectSecrets: inject, analyticsSiteId: siteId || null });
      setResult(d);
      toast(d.status === "ready" ? t("deploy.done") : t("deploy.failedToast"), d.status === "ready" ? "success" : "error");
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const tabs: Array<[typeof tab, string, typeof I.IconHome]> = [["deploy", t("deploy.tab.deploy"), I.IconDeploy], ["targets", `${t("deploy.tab.targets")} (${targets.length})`, I.IconServer], ["history", t("deploy.tab.history"), I.IconHistory]];
  const log = (d: Deployment) => (
    <pre className="code-view small" style={{ whiteSpace: "pre-wrap", maxHeight: 320 }}>{(d.log ?? []).map((l) => `${new Date(l.at).toLocaleTimeString()}  ${l.msg}`).join("\n") || d.error || ""}</pre>
  );

  return (
    <div className="col" style={{ height: "100%", gap: 0 }}>
      <div className="tabs" role="tablist">
        {tabs.map(([id, label, Icon]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`tab ${tab === id ? "active" : ""}`} onClick={() => setParams({ tab: id })}><Icon size={13} style={{ verticalAlign: -2, marginRight: 6 }} />{label}</button>
        ))}
      </div>
      <div className="page">
        <div className="page-narrow col" style={{ gap: 16 }}>
          {tab === "deploy" && (
            <>
              <div className="page-header" style={{ marginBottom: 0 }}>
                <div>
                  <h1 className="page-title">{t("nav.deploy")}</h1>
                  <p className="page-subtitle">{t("deploy.subtitle")}</p>
                </div>
              </div>
              {targets.length === 0 ? (
                <div className="empty">{t("deploy.noTargets")} {canTargets && <button className="btn btn-primary btn-sm" style={{ marginLeft: 8 }} onClick={() => (setParams({ tab: "targets" }), setEditing("new"))}>{t("deploy.addTarget")}</button>}</div>
              ) : (
                <div className="card col" style={{ gap: 12 }}>
                  <div className="grid-auto" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 260px), 1fr))", gap: 12 }}>
                    <label className="col" style={{ gap: 4 }}><span className="label">{t("deploy.what")}</span>
                      <select className="select" value={source} onChange={(e) => (e.target.value === "__pick" ? pickFolder() : setSource(e.target.value))}>
                        <option value="">{t("deploy.pickProject")}</option>
                        {projects.map((p) => <option key={p.id} value={p.id}>{p.name} · {t(`home.kind.${p.kind}`)}</option>)}
                        {upload && <option value="__upload">📁 {t("deploy.uploadedFolder")} ({upload.length})</option>}
                        <option value="__pick">📁 {t("deploy.uploadFolder")}…</option>
                      </select></label>
                    <label className="col" style={{ gap: 4 }}><span className="label">{t("deploy.where")}</span>
                      <select className="select" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                        {targets.map((x) => <option key={x.id} value={x.id}>{x.name} · {KIND_LABEL[x.kind]} · {t(`vault.env.${x.environment}`)}</option>)}
                      </select></label>
                    <label className="col" style={{ gap: 4 }}><span className="label">{t("deploy.analytics")}</span>
                      <select className="select" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
                        <option value="">{t("deploy.noAnalytics")}</option>
                        {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select></label>
                  </div>
                  <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={inject} disabled={target?.kind !== "vercel"} onChange={(e) => setInject(e.target.checked)} /> {t("deploy.inject")}</label>
                  <p className="hint">{t("deploy.injectHint")}</p>
                  <div className="row">
                    <button className="btn btn-primary" disabled={busy || !canRun || !target || (!project && source !== "__upload")} onClick={() => void run()}>{busy ? <I.IconSpinner size={14} className="spin" /> : <I.IconDeploy size={14} />} {busy ? t("deploy.deploying") : t("deploy.deployNow")}</button>
                    {source === "__upload" && upload && <span className="small muted">{upload.length} files · {fmtBytes(upload.reduce((a, b) => a + b.size, 0))}</span>}
                  </div>
                </div>
              )}
              {result && (
                <div className="card col" style={{ gap: 8 }}>
                  <div className="row wrap"><StatusBadge s={result.status} t={t} /><strong className="grow">{result.name}</strong>{result.url && <a className="btn btn-sm btn-primary" href={result.url} target="_blank" rel="noopener noreferrer"><I.IconExternal size={13} /> {t("deploy.open")}</a>}</div>
                  {log(result)}
                </div>
              )}
            </>
          )}

          {tab === "targets" && (
            <>
              <div className="row"><strong className="grow">{t("deploy.tab.targets")}</strong>{canTargets && !editing && <button className="btn btn-primary btn-sm" onClick={() => setEditing("new")}><I.IconPlus size={14} /> {t("deploy.addTarget")}</button>}</div>
              {editing && <TargetForm key={editing === "new" ? "new" : editing.id} initial={editing === "new" ? undefined : editing} secrets={secrets} onSaved={() => (setEditing(null), reload())} onCancel={() => setEditing(null)} />}
              {targets.length === 0 && !editing && <div className="empty">{t("deploy.noTargets")}</div>}
              {targets.map((x) => (
                <div key={x.id} className="card row wrap" style={{ gap: 10 }}>
                  <span className="badge">{KIND_LABEL[x.kind]}</span>
                  <div className="grow col" style={{ gap: 2, minWidth: 0 }}>
                    <strong>{x.name}</strong>
                    <span className="small muted ellipsis">{t(`vault.env.${x.environment}`)} · {Object.entries(x.config).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(" · ").slice(0, 140)}{x.secret_name ? ` · 🔑 ${x.secret_name}` : ""}</span>
                  </div>
                  {canTargets && (
                    <>
                      <button className="btn btn-sm" onClick={() => void deployApi.test(x.id).then((r) => toast(r.message, r.ok ? "success" : "error"))}><I.IconCheck size={13} /> {t("deploy.test")}</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => setEditing(x)}>{t("common.edit")}</button>
                      <button className="icon-btn" aria-label={t("common.delete")} onClick={() => void confirmDialog(t("common.confirm"), { danger: true }).then((ok): unknown => ok && deployApi.removeTarget(x.id).then(reload))}><I.IconTrash size={14} /></button>
                    </>
                  )}
                </div>
              ))}
            </>
          )}

          {tab === "history" && (
            <>
              <strong>{t("deploy.tab.history")}</strong>
              {history.length === 0 && <div className="empty">{t("deploy.noHistory")}</div>}
              {history.map((d) => (
                <div key={d.id} className="card col" style={{ gap: 6 }}>
                  <div className="row wrap" style={{ gap: 8 }}>
                    <StatusBadge s={d.status} t={t} />
                    <strong className="grow ellipsis">{d.name}</strong>
                    <span className="small muted">{d.target_name ?? "—"} · {d.files_count} files · {fmtBytes(Number(d.bytes))} · {new Date(d.started_at).toLocaleString()}{d.redeploy_of ? ` · ${t("deploy.redeployed")}` : ""}</span>
                  </div>
                  <div className="row wrap" style={{ gap: 6 }}>
                    {d.url && <a className="btn btn-sm" href={d.url} target="_blank" rel="noopener noreferrer"><I.IconExternal size={13} /> {d.url.replace(/^https?:\/\//, "").slice(0, 48)}</a>}
                    <button className="btn btn-sm btn-ghost" onClick={() => void (openLog?.id === d.id ? setOpenLog(null) : deployApi.deployment(d.id).then(setOpenLog))}>{t("deploy.log")}</button>
                    {canRun && d.can_redeploy && (
                      <button className="btn btn-sm" onClick={() => void confirmDialog(d.status === "ready" ? t("deploy.rollbackConfirm") : t("deploy.redeployConfirm")).then(async (ok) => { if (!ok) return; const r = await deployApi.redeploy(d.id); toast(r.status === "ready" ? t("deploy.done") : t("deploy.failedToast"), r.status === "ready" ? "success" : "error"); reload(); })}>
                        <I.IconRotate size={13} /> {d === history.find((x) => x.status === "ready") ? t("deploy.redeploy") : t("deploy.rollback")}
                      </button>
                    )}
                  </div>
                  {openLog?.id === d.id && log(openLog)}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
