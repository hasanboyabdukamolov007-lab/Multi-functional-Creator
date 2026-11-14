import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collabApi, useLive, type Comment, type Version } from "./collabApi";
import { useSession } from "../../lib/session";
import { useT } from "../../lib/i18n";
import { toast } from "../../lib/ui";
import { ask, confirmDialog } from "../../ui/dialog";
import { editorPath, type ProjectKind } from "../../lib/projects";
import * as I from "../../ui/icons";

const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  return s < 60 ? "now" : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`;
};

/**
 * Collaboration controls for any editor: live avatars, teammates' selections, comments and history.
 * `selection` is the id the local user has selected; `onRemoteSave` runs when a teammate saved a newer version.
 */
export function CollabBar({ projectId, kind, selection, isDirty, onRemoteSave, onRestored, onFocusNode }: { projectId: string; kind: ProjectKind; selection: string | null; isDirty: () => boolean; onRemoteSave: () => void; onRestored: () => void; onFocusNode?: (id: string) => void }) {
  const t = useT();
  const [panel, setPanel] = useState<"comments" | "history" | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [stale, setStale] = useState(false);
  const loadComments = () => void collabApi.comments(projectId).then(setComments).catch(() => setComments([]));
  const peers = useLive(projectId, selection, {
    onVersion: () => (isDirty() ? setStale(true) : onRemoteSave()),
    onComments: loadComments,
  });
  useEffect(loadComments, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = comments.filter((c) => !c.resolved && !c.parent_id).length;
  // Outline what teammates have selected, in their colour.
  const css = peers.filter((p) => p.selection).map((p) => `[data-node-id="${CSS.escape(p.selection!)}"] { outline: 2px solid ${p.color} !important; outline-offset: 2px; }`).join("\n");
  return (
    <>
      {css && <style>{css}</style>}
      <div className="row" style={{ gap: 4 }}>
        <div className="avatar-stack" aria-label={t("collab.here", { n: peers.length })}>
          {peers.slice(0, 5).map((p) => (
            <span key={p.user_id} className="avatar-dot" style={{ background: p.color }} title={`${p.name}${p.selection ? ` · ${t("collab.editing")}` : ""}`}>{p.name[0]?.toUpperCase()}</span>
          ))}
        </div>
        <button className={`btn btn-sm ${panel === "comments" ? "btn-primary" : ""}`} onClick={() => setPanel(panel === "comments" ? null : "comments")} title={t("collab.comments")}><I.IconComment size={14} /> {open || ""}</button>
        <button className={`btn btn-sm ${panel === "history" ? "btn-primary" : ""}`} onClick={() => setPanel(panel === "history" ? null : "history")} title={t("collab.history")}><I.IconHistory size={14} /></button>
      </div>
      {stale && (
        <div className="collab-toast">
          <I.IconWarning size={14} /> {t("collab.stale")}
          <button className="btn btn-sm btn-primary" onClick={() => (setStale(false), onRemoteSave())}>{t("pwa.reload")}</button>
          <button className="icon-btn" aria-label={t("common.close")} onClick={() => setStale(false)}><I.IconClose size={12} /></button>
        </div>
      )}
      {panel === "comments" && <CommentsDrawer projectId={projectId} comments={comments} selection={selection} reload={loadComments} onClose={() => setPanel(null)} onFocusNode={onFocusNode} />}
      {panel === "history" && <HistoryDrawer projectId={projectId} kind={kind} onClose={() => setPanel(null)} onRestored={onRestored} />}
    </>
  );
}

function CommentsDrawer({ projectId, comments, selection, reload, onClose, onFocusNode }: { projectId: string; comments: Comment[]; selection: string | null; reload: () => void; onClose: () => void; onFocusNode?: (id: string) => void }) {
  const t = useT();
  const me = useSession((s) => s.user?.id);
  const [text, setText] = useState("");
  const [anchor, setAnchor] = useState(true);
  const [reply, setReply] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [members, setMembers] = useState<Array<{ id: string; email: string; name: string | null }>>([]);
  useEffect(() => void collabApi.members().then(setMembers).catch(() => setMembers([])), []);
  const mention = /@([\w.-]*)$/.exec(text);
  const suggestions = mention ? members.filter((m) => m.id !== me && `${m.name ?? ""} ${m.email}`.toLowerCase().includes(mention[1].toLowerCase())).slice(0, 5) : [];
  const threads = useMemo(() => comments.filter((c) => !c.parent_id && (showResolved || !c.resolved)), [comments, showResolved]);
  const send = async () => {
    if (!text.trim()) return;
    try {
      const r = await collabApi.comment(projectId, { body: text.trim(), nodeId: reply ? null : anchor ? selection : null, parentId: reply });
      setText("");
      setReply(null);
      if (r.mentioned.length) toast(t("collab.notified", { who: r.mentioned.join(", ") }), "success");
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  return (
    <aside className="collab-drawer card" aria-label={t("collab.comments")}>
      <div className="row"><strong className="grow">{t("collab.comments")}</strong>
        <label className="row small" style={{ gap: 4 }}><input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> {t("collab.resolved")}</label>
        <button className="icon-btn" aria-label={t("common.close")} onClick={onClose}><I.IconClose size={14} /></button>
      </div>
      <div className="col grow" style={{ gap: 8, overflow: "auto", minHeight: 0 }}>
        {threads.length === 0 && <div className="hint">{t("collab.noComments")}</div>}
        {threads.map((c) => (
          <div key={c.id} className={`card col ${c.resolved ? "muted" : ""}`} style={{ gap: 6, padding: 10 }}>
            <div className="row small" style={{ gap: 6 }}>
              <strong>{c.author}</strong><span className="muted">{ago(c.created_at)}</span>
              {c.node_id && <button className="chip" onClick={() => onFocusNode?.(c.node_id!)}>◎ {t("collab.onElement")}</button>}
              <div className="grow" />
              <button className="icon-btn" title={c.resolved ? t("collab.reopen") : t("collab.resolve")} aria-label={c.resolved ? t("collab.reopen") : t("collab.resolve")} onClick={() => void collabApi.updateComment(c.id, { resolved: !c.resolved }).then(reload)}><I.IconCheck size={13} /></button>
              {c.author_id === me && <button className="icon-btn" aria-label={t("common.delete")} onClick={() => void confirmDialog(t("common.confirm"), { danger: true }).then((ok): unknown => ok && collabApi.deleteComment(c.id).then(reload))}><I.IconTrash size={12} /></button>}
            </div>
            <div className="small" style={{ whiteSpace: "pre-wrap" }}>{c.body.split(/(@[\w.@-]+)/g).map((part, i) => (part.startsWith("@") ? <strong key={i} style={{ color: "var(--mfc-accent)" }}>{part}</strong> : part))}</div>
            {comments.filter((r) => r.parent_id === c.id).map((r) => (
              <div key={r.id} className="small" style={{ borderLeft: "2px solid var(--mfc-border)", paddingLeft: 8 }}><strong>{r.author}</strong> <span className="muted">{ago(r.created_at)}</span><div style={{ whiteSpace: "pre-wrap" }}>{r.body}</div></div>
            ))}
            <button className="btn btn-sm btn-ghost" style={{ alignSelf: "flex-start" }} onClick={() => setReply(c.id)}>{t("collab.reply")}</button>
          </div>
        ))}
      </div>
      <div className="col" style={{ gap: 6, position: "relative" }}>
        {reply && <div className="small muted row">{t("collab.replying")} <button className="icon-btn" onClick={() => setReply(null)} aria-label={t("common.cancel")}><I.IconClose size={12} /></button></div>}
        {suggestions.length > 0 && (
          <div className="card col mention-pop">
            {suggestions.map((m) => <button key={m.id} className="list-item" onClick={() => setText(text.replace(/@[\w.-]*$/, `@${m.email.split("@")[0]} `))}>{m.name ?? m.email} <span className="muted small">{m.email}</span></button>)}
          </div>
        )}
        <textarea className="textarea" rows={3} placeholder={t("collab.placeholder")} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => (e.ctrlKey || e.metaKey) && e.key === "Enter" && void send()} />
        <div className="row">
          {!reply && <label className="row small" style={{ gap: 4 }}><input type="checkbox" checked={anchor && !!selection} disabled={!selection} onChange={(e) => setAnchor(e.target.checked)} /> {t("collab.anchor")}</label>}
          <div className="grow" />
          <button className="btn btn-sm btn-primary" disabled={!text.trim()} onClick={() => void send()}><I.IconSend size={13} /> {t("collab.post")}</button>
        </div>
      </div>
    </aside>
  );
}

function HistoryDrawer({ projectId, kind, onClose, onRestored }: { projectId: string; kind: ProjectKind; onClose: () => void; onRestored: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const [versions, setVersions] = useState<Version[]>([]);
  const [br, setBr] = useState<{ main: string; branches: Array<{ id: string; branch_name: string; updated_at: string }> } | null>(null);
  const reload = () => {
    void collabApi.versions(projectId).then(setVersions).catch(() => setVersions([]));
    void collabApi.branches(projectId).then(setBr).catch(() => setBr(null));
  };
  useEffect(reload, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  const isBranch = br && br.main !== projectId;
  return (
    <aside className="collab-drawer card" aria-label={t("collab.history")}>
      <div className="row"><strong className="grow">{t("collab.history")}</strong><button className="icon-btn" aria-label={t("common.close")} onClick={onClose}><I.IconClose size={14} /></button></div>
      <div className="row wrap" style={{ gap: 6 }}>
        <button className="btn btn-sm" onClick={() => void ask(t("collab.versionName"), "v1").then((l): unknown => l?.trim() && collabApi.saveVersion(projectId, l.trim()).then(() => (toast(t("common.saved"), "success"), reload())))}><I.IconSave size={13} /> {t("collab.saveVersion")}</button>
        {!isBranch && <button className="btn btn-sm" onClick={() => void ask(t("collab.branchName"), "experiment").then(async (n) => { if (!n?.trim()) return; const p = await collabApi.branch(projectId, n.trim()); toast(t("collab.branched"), "success"); navigate(editorPath(p.kind as ProjectKind, p.id)); })}><I.IconBranch size={13} /> {t("collab.newBranch")}</button>}
        {isBranch && <button className="btn btn-sm btn-primary" onClick={() => void confirmDialog(t("collab.mergeConfirm"), { danger: true }).then(async (ok) => { if (!ok) return; await collabApi.merge(projectId); toast(t("collab.merged"), "success"); navigate(editorPath(kind, br!.main)); })}><I.IconBranch size={13} /> {t("collab.merge")}</button>}
      </div>
      {br && (br.branches.length > 0 || isBranch) && (
        <div className="col" style={{ gap: 4 }}>
          <div className="section-label">{t("collab.branches")}</div>
          {isBranch && <button className="list-item small" onClick={() => navigate(editorPath(kind, br.main))}>⎇ main</button>}
          {br.branches.map((b) => <button key={b.id} className={`list-item small ${b.id === projectId ? "selected" : ""}`} onClick={() => navigate(editorPath(kind, b.id))}>⎇ {b.branch_name} <span className="muted">· {ago(b.updated_at)}</span></button>)}
        </div>
      )}
      <div className="section-label">{t("collab.versions")}</div>
      <div className="col grow" style={{ gap: 4, overflow: "auto", minHeight: 0 }}>
        {versions.length === 0 && <div className="hint">{t("collab.noVersions")}</div>}
        {versions.map((v) => (
          <div key={v.id} className="row small" style={{ gap: 6 }}>
            <span className={`badge ${v.auto ? "" : "badge-accent"}`}>{v.label ?? `v${v.version}`}</span>
            <span className="grow muted">{new Date(v.created_at).toLocaleString()} · {v.author ?? "—"}</span>
            <button className="btn btn-sm btn-ghost" onClick={() => void confirmDialog(t("collab.restoreConfirm"), { danger: true }).then(async (ok) => { if (!ok) return; await collabApi.restore(projectId, v.id); toast(t("collab.restored"), "success"); onRestored(); reload(); })}>{t("collab.restore")}</button>
          </div>
        ))}
      </div>
    </aside>
  );
}
