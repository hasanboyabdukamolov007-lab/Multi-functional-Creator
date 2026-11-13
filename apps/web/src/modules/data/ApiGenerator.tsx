import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { FIELD_TYPES, generateApi, isApiSpec, newField, newResource, plural, starterSpec, validateSpec, type ApiField, type ApiResource, type ApiSpec } from "./apigen";
import { zip } from "../builder/projectExport";
import { createAutosave, projectsApi, type ProjectSummary } from "../../lib/projects";
import { ApiError } from "../../lib/api";
import { downloadBlob, slugify } from "../../lib/download";
import { toast } from "../../lib/ui";
import { useT } from "../../lib/i18n";
import * as I from "../../ui/icons";

function Picker() {
  const t = useT();
  const [, setParams] = useSearchParams();
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  useEffect(() => {
    projectsApi.list("api").then(setList).catch(() => setList([]));
  }, []);
  const create = async () => {
    const name = window.prompt(t("data.apiName"), "Store API")?.trim();
    if (!name) return;
    const spec = { ...starterSpec(), name };
    const p = await projectsApi.create(name, "api", spec);
    setParams({ tab: "api", project: p.id });
  };
  return (
    <div className="page">
      <div className="page-narrow">
        <div className="page-header">
          <div>
            <h2 className="page-title">{t("data.tab.api")}</h2>
            <p className="page-subtitle">{t("data.apiIntro")}</p>
          </div>
          <button className="btn btn-primary" onClick={() => void create()}><I.IconPlus size={15} /> {t("data.newApi")}</button>
        </div>
        {list === null ? <div className="muted">{t("common.loading")}</div> : list.length === 0 ? <div className="empty">{t("data.noApis")}</div> : (
          <div className="grid-auto">
            {list.map((p) => (
              <button key={p.id} className="card" style={{ textAlign: "left", cursor: "pointer", color: "inherit" }} onClick={() => setParams({ tab: "api", project: p.id })}>
                <div className="card-title">{p.name}</div>
                <div className="small muted">{new Date(p.updated_at).toLocaleString()}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const ident = (s: string) => s.toLowerCase().replace(/[^a-z0-9_]/g, "_");

function FieldRow({ f, onChange, onRemove }: { f: ApiField; onChange: (f: ApiField) => void; onRemove: () => void }) {
  return (
    <div className="row" style={{ gap: 6 }}>
      <input className="input input-sm mono grow" value={f.name} onChange={(e) => onChange({ ...f, name: ident(e.target.value) })} aria-label="Field name" />
      <select className="select input-sm" style={{ width: 104 }} value={f.type} onChange={(e) => onChange({ ...f, type: e.target.value as ApiField["type"] })} aria-label="Field type">
        {FIELD_TYPES.map((x) => <option key={x}>{x}</option>)}
      </select>
      <label className="row small" style={{ gap: 3 }} title="Required"><input type="checkbox" checked={f.required} onChange={(e) => onChange({ ...f, required: e.target.checked })} /> req</label>
      <label className="row small" style={{ gap: 3 }} title="Unique"><input type="checkbox" checked={f.unique} onChange={(e) => onChange({ ...f, unique: e.target.checked })} /> uniq</label>
      <button className="icon-btn" aria-label="Remove field" onClick={onRemove}><I.IconTrash size={13} /></button>
    </div>
  );
}

function Editor({ projectId }: { projectId: string }) {
  const t = useT();
  const [spec, setSpec] = useState<ApiSpec | null>(null);
  const [state, setState] = useState<"saved" | "saving" | "dirty" | "conflict">("saved");
  const [file, setFile] = useState("README.md");
  const [legacy, setLegacy] = useState(false);
  const version = useRef(0);
  const saver = useRef(createAutosave(700));
  useEffect(() => {
    projectsApi.get<ApiSpec>(projectId).then((p) => {
      version.current = p.version;
      // Projects made before the generator existed hold a builder page; don't silently replace it.
      setLegacy(!isApiSpec(p.data) && Array.isArray((p.data as { pages?: unknown } | null)?.pages));
      setSpec(isApiSpec(p.data) ? p.data : { ...starterSpec(), name: p.name });
    });
  }, [projectId]);

  const update = (fn: (s: ApiSpec) => ApiSpec) =>
    setSpec((prev) => {
      if (!prev) return prev;
      const next = fn(structuredClone(prev));
      setState("dirty");
      saver.current.schedule(async () => {
        setState("saving");
        try {
          version.current = (await projectsApi.save(projectId, { data: next, baseVersion: version.current })).version;
          setState("saved");
        } catch (e) {
          setState(e instanceof ApiError && e.status === 409 ? "conflict" : "dirty");
          toast((e as Error).message, "error");
        }
      });
      return next;
    });
  const setRes = (id: string, fn: (r: ApiResource) => ApiResource) => update((s) => ({ ...s, resources: s.resources.map((r) => (r.id === id ? fn(r) : r)) }));

  const problems = useMemo(() => (spec ? validateSpec(spec) : []), [spec]);
  const files = useMemo(() => (spec && !problems.length ? generateApi(spec) : {}), [spec, problems]);
  if (!spec) return <div className="page muted">{t("common.loading")}</div>;
  if (legacy)
    return (
      <div className="page"><div className="page-narrow col" style={{ gap: 12 }}>
        <div className="empty">{t("data.legacyApi")}</div>
        <div className="row">
          <Link className="btn btn-primary" to={`/builder?project=${projectId}`}>{t("data.openInBuilder")}</Link>
          <button className="btn" onClick={() => window.confirm(t("data.replaceConfirm")) && (setLegacy(false), update((s) => s))}>{t("data.replaceWithSpec")}</button>
        </div>
      </div></div>
    );
  const paths = Object.keys(files).sort();
  const current = files[file] !== undefined ? file : paths[0];

  const download = () => {
    const root = slugify(spec.name) || "api";
    downloadBlob(`${root}.zip`, new Blob([zip(files, root) as BlobPart], { type: "application/zip" }));
    toast(t("data.apiDownloaded", { n: paths.length }), "success");
  };

  return (
    <div className="col" style={{ height: "100%", gap: 0 }}>
      <div className="toolbar">
        <strong style={{ padding: "0 6px" }}>{spec.name}</strong>
        <span className="small muted" style={{ minWidth: 70 }}>{state === "saving" ? t("common.saving") : state === "saved" ? t("common.saved") : state === "conflict" ? "⚠ Conflict — reload" : "•"}</span>
        <div className="grow" />
        {problems.length > 0 ? <span className="badge badge-warning" title={problems.join("\n")}><I.IconWarning size={12} /> {problems.length}</span> : <span className="badge badge-success"><I.IconCheck size={12} /> {paths.length} files</span>}
        <button className="btn btn-sm btn-primary" disabled={!paths.length} onClick={download}><I.IconDownload size={14} /> ZIP</button>
      </div>
      <div className="row" style={{ flex: 1, minHeight: 0, alignItems: "stretch", gap: 0 }}>
        <section className="col" style={{ width: 460, flexShrink: 0, overflow: "auto", padding: 14, gap: 12, borderRight: "1px solid var(--mfc-border)" }}>
          <label className="col" style={{ gap: 4 }}><span className="label">{t("common.name")}</span>
            <input className="input" value={spec.name} onChange={(e) => update((s) => ({ ...s, name: e.target.value }))} /></label>
          <label className="col" style={{ gap: 4 }}><span className="label">{t("common.description")}</span>
            <input className="input" value={spec.description} onChange={(e) => update((s) => ({ ...s, description: e.target.value }))} /></label>
          <label className="col" style={{ gap: 4 }}><span className="label">{t("data.auth")}</span>
            <select className="select" value={spec.auth} onChange={(e) => update((s) => ({ ...s, auth: e.target.value as ApiSpec["auth"] }))}>
              <option value="none">{t("data.auth.none")}</option>
              <option value="apiKey">{t("data.auth.apiKey")}</option>
              <option value="jwt">{t("data.auth.jwt")}</option>
            </select></label>
          {spec.resources.map((r) => (
            <div key={r.id} className="card col" style={{ gap: 8, padding: 12 }}>
              <div className="row" style={{ gap: 6 }}>
                <input className="input input-sm mono grow" value={r.name} onChange={(e) => setRes(r.id, (x) => ({ ...x, name: ident(e.target.value) }))} aria-label="Resource name" />
                <span className="small muted mono">/{plural(r.name)}</span>
                {spec.auth !== "none" && <label className="row small" style={{ gap: 3 }}><input type="checkbox" checked={r.protected} onChange={(e) => setRes(r.id, (x) => ({ ...x, protected: e.target.checked }))} /> <I.IconLock size={12} /></label>}
                <button className="icon-btn" aria-label={t("common.delete")} onClick={() => window.confirm(t("common.confirm")) && update((s) => ({ ...s, resources: s.resources.filter((x) => x.id !== r.id) }))}><I.IconTrash size={14} /></button>
              </div>
              {r.fields.map((f) => (
                <FieldRow key={f.id} f={f} onChange={(nf) => setRes(r.id, (x) => ({ ...x, fields: x.fields.map((y) => (y.id === nf.id ? nf : y)) }))} onRemove={() => setRes(r.id, (x) => ({ ...x, fields: x.fields.filter((y) => y.id !== f.id) }))} />
              ))}
              <button className="btn btn-sm btn-ghost" style={{ alignSelf: "flex-start" }} onClick={() => setRes(r.id, (x) => ({ ...x, fields: [...x.fields, newField({ name: `field_${x.fields.length + 1}` })] }))}><I.IconPlus size={13} /> {t("data.addField")}</button>
            </div>
          ))}
          <button className="btn" onClick={() => update((s) => ({ ...s, resources: [...s.resources, newResource(`resource_${s.resources.length + 1}`)] }))}><I.IconPlus size={14} /> {t("data.addResource")}</button>
          {problems.length > 0 && <div className="col" style={{ gap: 6 }}>{problems.map((p) => <div key={p} className="badge badge-warning" style={{ whiteSpace: "normal" }}>{p}</div>)}</div>}
        </section>
        <aside className="panel" style={{ width: 220, flexShrink: 0, borderRight: "1px solid var(--mfc-border)" }}>
          <div className="panel-header">{t("data.files")}</div>
          <div className="panel-body" style={{ padding: 6 }}>
            {paths.map((p) => (
              <div key={p} className={`list-item small ${p === current ? "selected" : ""}`} onClick={() => setFile(p)} style={{ paddingLeft: 8 + (p.split("/").length - 1) * 12 }}>
                <I.IconFileCode size={13} className="muted" /> <span className="mono ellipsis">{p.split("/").pop()}</span>
              </div>
            ))}
          </div>
        </aside>
        <section className="col grow" style={{ minWidth: 0, overflow: "auto" }}>
          {current ? (
            <>
              <div className="row small muted mono" style={{ padding: "8px 12px", borderBottom: "1px solid var(--mfc-border)" }}>
                <span className="grow">{current}</span>
                <button className="btn btn-sm btn-ghost" onClick={() => void navigator.clipboard.writeText(files[current]).then(() => toast(t("common.copied"), "success"))}><I.IconCopy size={13} /></button>
              </div>
              <pre className="code-view" style={{ margin: 0, border: 0, borderRadius: 0, flex: 1 }}>{files[current]}</pre>
            </>
          ) : <div className="empty" style={{ margin: 16 }}>{t("data.fixProblems")}</div>}
        </section>
      </div>
    </div>
  );
}

export default function ApiGenerator() {
  const [params] = useSearchParams();
  const project = params.get("project");
  return project ? <Editor key={project} projectId={project} /> : <Picker />;
}
