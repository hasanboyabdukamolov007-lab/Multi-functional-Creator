import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../../lib/monaco";
import Editor from "@monaco-editor/react";
import { monacoTheme } from "../../lib/monaco";
import { api } from "../../lib/api";
import { ws } from "../../lib/session";
import { useT } from "../../lib/i18n";
import { toast } from "../../lib/ui";
import { useTheme } from "../../lib/theme";
import { ask, confirmDialog } from "../../ui/dialog";
import { projectsApi } from "../../lib/projects";
import { vaultApi, type SecretMeta } from "../vault/vaultApi";
import { htmlToDoc, linkedCss } from "./htmlImport";
import * as I from "../../ui/icons";

interface Tree { repo: string; ref: string; private: boolean; canPush: boolean; truncated: boolean; files: Array<{ path: string; size: number; editable: boolean }> }
interface Open { path: string; sha: string; original: string; content: string }

const LANG: Record<string, string> = { html: "html", htm: "html", css: "css", scss: "scss", js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript", json: "json", md: "markdown", vue: "html", svelte: "html", xml: "xml", svg: "xml", yml: "yaml", yaml: "yaml" };
const SAVED = "mfc.github.last";

/** Open one of your own GitHub repositories: edit files and commit them back, or import an HTML page into the Builder. */
export default function GitHubPage() {
  const t = useT();
  const navigate = useNavigate();
  const scheme = useTheme((s) => s.active().tokens.scheme);
  const last = (() => {
    try {
      return JSON.parse(localStorage.getItem(SAVED) ?? "{}") as { repo?: string; ref?: string; secretId?: string };
    } catch {
      return {};
    }
  })();
  const [repo, setRepo] = useState(last.repo ?? "");
  const [ref, setRef] = useState(last.ref ?? "");
  const [secretId, setSecretId] = useState(last.secretId ?? "");
  const [secrets, setSecrets] = useState<SecretMeta[]>([]);
  const [tree, setTree] = useState<Tree | null>(null);
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<Open | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => void vaultApi.list().then(setSecrets).catch(() => setSecrets([])), []);
  const body = () => ({ repo, ref: tree?.ref ?? (ref || undefined), secretId: secretId || null });

  const load = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    try {
      const r = await api.post<Tree>(ws("/github/tree"), { repo, ref: ref || undefined, secretId: secretId || null });
      setTree(r);
      setOpen(null);
      try {
        localStorage.setItem(SAVED, JSON.stringify({ repo, ref, secretId }));
      } catch {
        /* storage blocked */
      }
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  const openFile = async (path: string) => {
    if (open && open.content !== open.original && !(await confirmDialog(t("gh.discard")))) return;
    try {
      const f = await api.post<{ path: string; sha: string; content: string }>(ws("/github/file"), { ...body(), path });
      setOpen({ path, sha: f.sha, original: f.content, content: f.content });
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };
  const commit = async () => {
    if (!open) return;
    const message = await ask(t("gh.message"), `Update ${open.path.split("/").pop()}`);
    if (!message?.trim()) return;
    setBusy(true);
    try {
      const r = await api.post<{ sha: string; url?: string }>(ws("/github/commit"), { ...body(), path: open.path, content: open.content, sha: open.sha, message: message.trim() });
      setOpen({ ...open, sha: r.sha, original: open.content });
      toast(t("gh.committed"), "success");
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  const importPage = async () => {
    if (!open || !tree) return;
    setBusy(true);
    try {
      // Same-repo stylesheets are inlined (GitHub serves raw CSS as text/plain, which browsers won't apply).
      const css: string[] = [];
      for (const p of linkedCss(open.content, open.path)) {
        const f = await api.post<{ content: string }>(ws("/github/file"), { ...body(), path: p }).catch(() => null);
        if (f) css.push(f.content);
      }
      const dir = open.path.includes("/") ? open.path.slice(0, open.path.lastIndexOf("/") + 1) : "";
      const name = open.path.split("/").pop()!.replace(/\.html?$/i, "") || "index";
      const doc = htmlToDoc(open.content, { baseUrl: `https://raw.githubusercontent.com/${tree.repo}/${tree.ref}/${dir}`, name: name === "index" ? "Home" : name, css });
      const p = await projectsApi.create(`${tree.repo.split("/")[1]} · ${name}`, "site", doc);
      toast(t("gh.imported", { n: doc.pages[0].root.children.length }), "success");
      navigate(`/builder?project=${p.id}`);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const files = useMemo(() => (tree?.files ?? []).filter((f) => !filter || f.path.toLowerCase().includes(filter.toLowerCase())).slice(0, 400), [tree, filter]);
  const dirty = !!open && open.content !== open.original;
  const ext = open?.path.split(".").pop()?.toLowerCase() ?? "";

  return (
    <div className="page">
      <div className="col" style={{ gap: 14 }}>
        <div className="page-header" style={{ marginBottom: 0 }}>
          <div>
            <h1 className="page-title">{t("nav.github")}</h1>
            <p className="page-subtitle">{t("gh.subtitle")}</p>
          </div>
        </div>
        <form className="card row wrap" style={{ gap: 8 }} onSubmit={load}>
          <input className="input grow" style={{ minWidth: 220 }} required placeholder="owner/repo" value={repo} onChange={(e) => setRepo(e.target.value)} aria-label={t("gh.repo")} />
          <input className="input" style={{ width: 140 }} placeholder={t("gh.branch")} value={ref} onChange={(e) => setRef(e.target.value)} aria-label={t("gh.branch")} />
          <select className="select" style={{ width: 220 }} value={secretId} onChange={(e) => setSecretId(e.target.value)} aria-label={t("gh.token")}>
            <option value="">{t("gh.noToken")}</option>
            {secrets.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.environment}</option>)}
          </select>
          <button className="btn btn-primary" disabled={busy}>{busy ? <I.IconSpinner size={14} className="spin" /> : <I.IconBranch size={14} />} {t("gh.open")}</button>
        </form>
        {!tree && <p className="hint">{t("gh.help")}</p>}
        {tree && (
          <div className="gh-layout">
            <div className="card col" style={{ gap: 6, padding: 10, minWidth: 0 }}>
              <div className="small muted">{tree.repo} · {tree.ref}{tree.private ? " · 🔒" : ""}{tree.truncated ? ` · ${t("gh.truncated")}` : ""}</div>
              <input className="input" placeholder={t("common.search")} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={t("common.search")} />
              <div className="col gh-files">
                {files.map((f) => (
                  <button key={f.path} className={`list-item small ${open?.path === f.path ? "selected" : ""}`} disabled={!f.editable} title={f.editable ? f.path : t("gh.notEditable")} onClick={() => void openFile(f.path)}>
                    <span className="ellipsis">{f.path}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="card col" style={{ gap: 8, padding: 10, minWidth: 0 }}>
              {!open ? (
                <div className="empty">{t("gh.pick")}</div>
              ) : (
                <>
                  <div className="row wrap" style={{ gap: 6 }}>
                    <strong className="grow ellipsis mono small">{open.path}{dirty ? " •" : ""}</strong>
                    {/^html?$/.test(ext) && <button className="btn btn-sm" disabled={busy} onClick={() => void importPage()}><I.IconDownload size={13} /> {t("gh.import")}</button>}
                    <button className="btn btn-sm btn-ghost" disabled={!dirty} onClick={() => setOpen({ ...open, content: open.original })}>{t("common.cancel")}</button>
                    <button className="btn btn-sm btn-primary" disabled={!dirty || busy || !secretId || !tree.canPush} title={!secretId ? t("gh.needToken") : !tree.canPush ? t("gh.noPush") : undefined} onClick={() => void commit()}><I.IconUpload size={13} /> {t("gh.commit")}</button>
                  </div>
                  {(!secretId || !tree.canPush) && <span className="hint">{!secretId ? t("gh.needToken") : t("gh.noPush")}</span>}
                  <div style={{ height: "62vh", border: "1px solid var(--mfc-border)", borderRadius: 8, overflow: "hidden" }}>
                    <Editor value={open.content} language={LANG[ext] ?? "plaintext"} theme={monacoTheme(scheme)} onChange={(v) => setOpen({ ...open, content: v ?? "" })} options={{ minimap: { enabled: false }, fontSize: 13, wordWrap: "on", automaticLayout: true }} />
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
