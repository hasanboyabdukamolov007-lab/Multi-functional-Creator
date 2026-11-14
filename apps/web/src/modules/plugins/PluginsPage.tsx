import { useEffect, useState } from "react";
import { can } from "@mfc/core";
import { api } from "../../lib/api";
import { ws, useSession } from "../../lib/session";
import { useT } from "../../lib/i18n";
import { toast } from "../../lib/ui";
import { confirmDialog } from "../../ui/dialog";
import { runFunction } from "../../lib/registry";
import { EXAMPLES, loadPlugins, type InstalledPlugin } from "./runtime";
import * as I from "../../ui/icons";

const SKELETON_MANIFEST = JSON.stringify({ id: "my-plugin", name: "My plugin", version: "1.0.0", description: "What it does", permissions: ["builder.write", "toast"], functions: [{ id: "hello", title: "Say hello" }] }, null, 2);
const SKELETON_CODE = `mfc.register("hello", async (args) => {
  await mfc.builder.insert({ type: "heading", props: { text: "Hello from my plugin", level: 2 } });
  await mfc.toast("Inserted a heading", "success");
  return "ok";
});`;

export default function PluginsPage() {
  const t = useT();
  const role = useSession((s) => s.workspace()?.role ?? "viewer");
  const manage = can(role, "plugins.manage");
  const [list, setList] = useState<InstalledPlugin[]>([]);
  const [manifest, setManifest] = useState(SKELETON_MANIFEST);
  const [code, setCode] = useState(SKELETON_CODE);
  const [editor, setEditor] = useState(false);
  const reload = async () => {
    const r = await api.get<{ plugins: InstalledPlugin[] }>(ws("/plugins")).catch(() => ({ plugins: [] as InstalledPlugin[] }));
    setList(r.plugins);
    await loadPlugins(r.plugins);
  };
  useEffect(() => void reload(), []);
  const install = async (m: unknown, c: string) => {
    try {
      await api.post(ws("/plugins"), { manifest: m, code: c });
      toast(t("plugins.installed"), "success");
      await reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  return (
    <div className="page">
      <div className="page-narrow col" style={{ gap: 16 }}>
        <div className="page-header" style={{ marginBottom: 0 }}>
          <div>
            <h1 className="page-title">{t("nav.plugins")}</h1>
            <p className="page-subtitle">{t("plugins.subtitle")}</p>
          </div>
          {manage && <button className="btn btn-primary" onClick={() => setEditor(!editor)}><I.IconCode size={14} /> {t("plugins.write")}</button>}
        </div>

        {editor && (
          <div className="card col" style={{ gap: 10 }}>
            <div className="grid-auto" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 380px), 1fr))", gap: 10 }}>
              <label className="col" style={{ gap: 4 }}><span className="label">manifest.json</span><textarea className="textarea mono small" rows={14} value={manifest} onChange={(e) => setManifest(e.target.value)} spellCheck={false} /></label>
              <label className="col" style={{ gap: 4 }}><span className="label">plugin.js</span><textarea className="textarea mono small" rows={14} value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} /></label>
            </div>
            <div className="row"><button className="btn btn-primary" onClick={() => { try { void install(JSON.parse(manifest), code); } catch { toast(t("plugins.badManifest"), "error"); } }}><I.IconPackage size={14} /> {t("plugins.install")}</button></div>
            <details>
              <summary className="small">{t("plugins.sdk")}</summary>
              <pre className="code-view small" style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{`mfc.register(functionId, async (args) => result)   // handle a function from your manifest
mfc.toast(text, "info" | "success" | "warning" | "error")          // permission: toast
mfc.builder.page() / selected() / tokens()                         // permission: builder.read
mfc.builder.insert({ type, props, style, children })                // permission: builder.write
mfc.builder.updateSelected({ props, style })                         // permission: builder.write
mfc.studio.add({ shape, position: [x,y,z], color, scale })           // permission: studio.write
mfc.storage.get(key) / set(key, value)                               // permission: storage (this device)
mfc.http.send({ method, url, headers, body })                        // permission: http (server proxy, SSRF-guarded)

Plugins run in a sandboxed iframe with no network, cookies or DOM access; every call is checked against the manifest's permissions and times out after 10 s.`}</pre>
            </details>
          </div>
        )}

        <strong>{t("plugins.installedList")} ({list.length})</strong>
        {list.length === 0 && <div className="hint">{t("plugins.none")}</div>}
        {list.map((p) => (
          <div key={p.id} className="card col" style={{ gap: 6 }}>
            <div className="row wrap" style={{ gap: 8 }}>
              <I.IconPlugins size={16} />
              <strong className="grow">{p.manifest.name} <span className="small muted">v{p.manifest.version}</span></strong>
              {manage && <label className="row small" style={{ gap: 4 }}><input type="checkbox" checked={p.enabled} onChange={(e) => void api.patch(ws(`/plugins/${p.id}`), { enabled: e.target.checked }).then(reload)} /> {t("plugins.enabled")}</label>}
              {manage && <button className="icon-btn" aria-label={t("common.delete")} onClick={() => void confirmDialog(t("plugins.removeConfirm"), { danger: true }).then((ok): unknown => ok && api.del(ws(`/plugins/${p.id}`)).then(reload))}><I.IconTrash size={14} /></button>}
            </div>
            <span className="small muted">{p.manifest.description}</span>
            <div className="row wrap small" style={{ gap: 4 }}>{p.manifest.permissions.map((perm) => <span key={perm} className="badge">{perm}</span>)}</div>
            {p.enabled && (
              <div className="row wrap" style={{ gap: 6 }}>
                {p.manifest.functions.map((f) => <button key={f.id} className="btn btn-sm" onClick={() => void runFunction(`plugin.${p.slug}.${f.id}`).then((r) => r !== null && r !== undefined && toast(String(typeof r === "string" ? r : JSON.stringify(r)).slice(0, 200), "info")).catch((e: Error) => toast(e.message, "error"))}>▶ {f.title}</button>)}
              </div>
            )}
          </div>
        ))}

        <strong>{t("plugins.examples")}</strong>
        <div className="grid-auto" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 280px), 1fr))", gap: 10 }}>
          {EXAMPLES.map((ex) => (
            <div key={ex.manifest.id} className="card col" style={{ gap: 6 }}>
              <strong>{ex.manifest.name}</strong>
              <span className="small muted">{ex.manifest.description}</span>
              <div className="row wrap small" style={{ gap: 4 }}>{ex.manifest.permissions.map((perm) => <span key={perm} className="badge">{perm}</span>)}</div>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn btn-sm btn-primary" disabled={!manage || list.some((p) => p.slug === ex.manifest.id)} onClick={() => void install(ex.manifest, ex.code)}>{list.some((p) => p.slug === ex.manifest.id) ? t("plugins.alreadyInstalled") : t("plugins.install")}</button>
                {manage && <button className="btn btn-sm btn-ghost" onClick={() => (setManifest(JSON.stringify(ex.manifest, null, 2)), setCode(ex.code), setEditor(true))}>{t("plugins.viewSource")}</button>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
