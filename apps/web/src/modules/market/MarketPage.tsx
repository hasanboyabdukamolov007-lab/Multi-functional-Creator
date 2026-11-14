import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { can } from "@mfc/core";
import { api } from "../../lib/api";
import { ws, useSession } from "../../lib/session";
import { useT } from "../../lib/i18n";
import { toast } from "../../lib/ui";
import { confirmDialog } from "../../ui/dialog";
import { editorPath, projectsApi, type ProjectKind, type ProjectSummary } from "../../lib/projects";
import { mediaApi } from "../media/mediaApi";
import { loadPlugins } from "../plugins/runtime";
import * as I from "../../ui/icons";

const KINDS = ["template", "scene", "schema", "api", "workflow", "brand", "plugin"] as const;
type Kind = (typeof KINDS)[number];
interface Item { id: string; kind: Kind; name: string; description: string; tags: string[]; visibility: "workspace" | "public"; installs: number; created_at: string; mine: boolean; author: string | null; workspace: string }
const KIND_OF_PROJECT: Partial<Record<ProjectKind, Kind>> = { site: "template", panel: "template", app: "template", scene3d: "scene", db: "schema", api: "api" };

function Publish({ t, onDone }: { t: (k: string, v?: Record<string, string | number>) => string; onDone: () => void }) {
  const role = useSession((s) => s.workspace()?.role ?? "viewer");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [workflows, setWorkflows] = useState<Array<{ id: string; name: string }>>([]);
  const [plugins, setPlugins] = useState<Array<{ id: string; manifest: { name: string }; code: string }>>([]);
  const [source, setSource] = useState("");
  const [form, setForm] = useState({ name: "", description: "", tags: "", visibility: "workspace" as "workspace" | "public" });
  useEffect(() => {
    void projectsApi.list().then(setProjects).catch(() => setProjects([]));
    void api.get<{ workflows: Array<{ id: string; name: string }> }>(ws("/workflows")).then((r) => setWorkflows(r.workflows)).catch(() => setWorkflows([]));
    void api.get<{ plugins: typeof plugins }>(ws("/plugins")).then((r) => setPlugins(r.plugins)).catch(() => setPlugins([]));
  }, []);
  const publish = async () => {
    const [type, id] = source.split(":");
    let kind: Kind;
    let data: Record<string, unknown>;
    if (type === "project") {
      const p = await projectsApi.get(id);
      kind = KIND_OF_PROJECT[p.kind] ?? "template";
      data = kind === "template" ? { projectKind: p.kind, doc: p.data } : (p.data as Record<string, unknown>);
    } else if (type === "workflow") {
      const w = await api.get<{ workflow: { graph: unknown } }>(ws(`/workflows/${id}`));
      kind = "workflow";
      data = { graph: w.workflow.graph };
    } else if (type === "brand") {
      kind = "brand";
      data = ((await mediaApi.brand()) ?? {}) as unknown as Record<string, unknown>;
    } else {
      const p = plugins.find((x) => x.id === id)!;
      kind = "plugin";
      data = { manifest: p.manifest, code: p.code };
    }
    await api.post(ws("/market"), { kind, name: form.name, description: form.description, tags: form.tags.split(",").map((s) => s.trim()).filter(Boolean), visibility: form.visibility, data });
    toast(t("market.published"), "success");
    onDone();
  };
  return (
    <form className="card col" style={{ gap: 10 }} onSubmit={(e) => (e.preventDefault(), void publish().catch((err: Error) => toast(err.message, "error")))}>
      <select className="select" required value={source} onChange={(e) => (setSource(e.target.value), !form.name && setForm({ ...form, name: e.target.selectedOptions[0]?.dataset.name ?? "" }))} aria-label={t("market.what")}>
        <option value="">{t("market.what")}</option>
        <optgroup label={t("market.projects")}>{projects.map((p) => <option key={p.id} value={`project:${p.id}`} data-name={p.name}>{p.name} · {t(`home.kind.${p.kind}`)}</option>)}</optgroup>
        {workflows.length > 0 && <optgroup label={t("data.tab.workflows")}>{workflows.map((w) => <option key={w.id} value={`workflow:${w.id}`} data-name={w.name}>{w.name}</option>)}</optgroup>}
        <option value="brand:kit" data-name="Brand kit">{t("media.tab.brand")}</option>
        {plugins.length > 0 && can(role, "plugins.manage") && <optgroup label={t("nav.plugins")}>{plugins.map((p) => <option key={p.id} value={`plugin:${p.id}`} data-name={p.manifest.name}>{p.manifest.name}</option>)}</optgroup>}
      </select>
      <input className="input" required placeholder={t("common.name")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <textarea className="textarea" rows={2} placeholder={t("common.description")} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      <input className="input" placeholder={t("market.tags")} value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
      <div className="row wrap" style={{ gap: 12 }}>
        <label className="row small" style={{ gap: 4 }}><input type="radio" checked={form.visibility === "workspace"} onChange={() => setForm({ ...form, visibility: "workspace" })} /> {t("market.team")}</label>
        <label className="row small" style={{ gap: 4 }}><input type="radio" checked={form.visibility === "public"} disabled={!["owner", "admin"].includes(role)} onChange={() => setForm({ ...form, visibility: "public" })} /> {t("market.public")}</label>
        <div className="grow" />
        <button className="btn btn-primary"><I.IconUpload size={14} /> {t("market.publish")}</button>
      </div>
    </form>
  );
}

export default function MarketPage() {
  const t = useT();
  const navigate = useNavigate();
  const [items, setItems] = useState<Item[]>([]);
  const [kind, setKind] = useState<"" | Kind>("");
  const [scope, setScope] = useState<"" | "mine" | "public">("");
  const [q, setQ] = useState("");
  const [publishing, setPublishing] = useState(false);
  const reload = () => void api.get<{ items: Item[] }>(ws(`/market?${new URLSearchParams({ ...(kind ? { kind } : {}), ...(scope ? { scope } : {}), ...(q ? { q } : {}) })}`)).then((r) => setItems(r.items)).catch(() => setItems([]));
  useEffect(reload, [kind, scope, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const install = async (it: Item) => {
    const r = await api.post<{ kind: Kind; project?: { id: string; kind: ProjectKind }; workflowId?: string; pluginId?: string; data?: Record<string, unknown> }>(ws(`/market/${it.id}/install`));
    toast(t("market.installed", { name: it.name }), "success");
    if (r.project) navigate(editorPath(r.project.kind, r.project.id));
    else if (r.workflowId) navigate(`/data?tab=workflows&workflow=${r.workflowId}`);
    else if (r.pluginId) {
      await loadPlugins();
      navigate("/plugins");
    } else if (r.kind === "brand" && r.data) {
      if (await confirmDialog(t("market.replaceBrand"))) await mediaApi.saveBrand(r.data as never);
      navigate("/media?tab=brand");
    }
    reload();
  };
  return (
    <div className="page">
      <div className="page-narrow col" style={{ gap: 16 }}>
        <div className="page-header" style={{ marginBottom: 0 }}>
          <div>
            <h1 className="page-title">{t("nav.marketplace")}</h1>
            <p className="page-subtitle">{t("market.subtitle")}</p>
          </div>
          <button className="btn btn-primary" onClick={() => setPublishing(!publishing)}><I.IconUpload size={14} /> {t("market.publish")}</button>
        </div>
        {publishing && <Publish t={t} onDone={() => (setPublishing(false), reload())} />}
        <div className="row wrap" style={{ gap: 8 }}>
          <input className="input" style={{ maxWidth: 260 }} placeholder={t("common.search")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("common.search")} />
          <select className="select" style={{ width: 160 }} value={kind} onChange={(e) => setKind(e.target.value as Kind | "")} aria-label={t("media.kind")}>
            <option value="">{t("home.allKinds")}</option>
            {KINDS.map((k) => <option key={k} value={k}>{t(`market.kind.${k}`)}</option>)}
          </select>
          <select className="select" style={{ width: 160 }} value={scope} onChange={(e) => setScope(e.target.value as typeof scope)} aria-label={t("market.scope")}>
            <option value="">{t("market.everything")}</option><option value="mine">{t("market.team")}</option><option value="public">{t("market.public")}</option>
          </select>
        </div>
        {items.length === 0 && <div className="empty">{t("market.empty")}</div>}
        <div className="grid-auto" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 280px), 1fr))", gap: 12 }}>
          {items.map((it) => (
            <div key={it.id} className="card col" style={{ gap: 8 }}>
              <div className="row" style={{ gap: 6 }}><span className="badge badge-accent">{t(`market.kind.${it.kind}`)}</span>{it.visibility === "public" && <span className="badge">🌐</span>}<div className="grow" /><span className="small muted">⬇ {it.installs}</span></div>
              <strong>{it.name}</strong>
              {it.description && <span className="small muted">{it.description}</span>}
              <div className="row wrap small muted" style={{ gap: 4 }}>{it.tags.map((tg) => <span key={tg} className="chip">#{tg}</span>)}</div>
              <span className="small muted">{it.author ?? "—"} · {it.workspace}</span>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn btn-sm btn-primary" onClick={() => void install(it).catch((e: Error) => toast(e.message, "error"))}>{t("market.install")}</button>
                {it.mine && <button className="icon-btn" aria-label={t("common.delete")} onClick={() => void confirmDialog(t("common.confirm"), { danger: true }).then((ok): unknown => ok && api.del(ws(`/market/${it.id}`)).then(reload))}><I.IconTrash size={14} /></button>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
