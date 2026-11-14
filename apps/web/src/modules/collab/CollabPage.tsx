import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { collabApi } from "./collabApi";
import { editorPath, type ProjectKind } from "../../lib/projects";
import { useT } from "../../lib/i18n";
import * as I from "../../ui/icons";

/** Team activity: who's online where, and the latest comments across projects. */
export default function CollabPage() {
  const t = useT();
  const [data, setData] = useState<Awaited<ReturnType<typeof collabApi.recent>> | null>(null);
  useEffect(() => {
    const load = () => void collabApi.recent().then(setData).catch(() => setData({ comments: [], online: [] }));
    load();
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="page">
      <div className="page-narrow col" style={{ gap: 16 }}>
        <div className="page-header" style={{ marginBottom: 0 }}>
          <div>
            <h1 className="page-title">{t("nav.collab")}</h1>
            <p className="page-subtitle">{t("collab.subtitle")}</p>
          </div>
        </div>
        <div className="card col" style={{ gap: 8 }}>
          <strong>{t("collab.online")}</strong>
          {!data ? <div className="muted">{t("common.loading")}</div> : data.online.length === 0 ? <div className="hint">{t("collab.nobody")}</div> : data.online.map((o) => (
            <Link key={`${o.user_id}-${o.project_id}`} className="row" style={{ gap: 8, color: "inherit" }} to={editorPath(o.kind as ProjectKind, o.project_id)}>
              <span className="avatar-dot" style={{ background: o.color, marginLeft: 0 }}>{o.name[0]?.toUpperCase()}</span>
              <span><strong>{o.name}</strong> <span className="muted">{t("collab.isIn")}</span> {o.project}</span>
            </Link>
          ))}
        </div>
        <div className="card col" style={{ gap: 8 }}>
          <strong>{t("collab.recentComments")}</strong>
          {data && data.comments.length === 0 && <div className="hint">{t("collab.noComments")}</div>}
          {data?.comments.map((c) => (
            <Link key={c.id} to={`${editorPath(c.kind as ProjectKind, c.project_id)}&comment=${c.id}`} className="col" style={{ gap: 2, color: "inherit", padding: "6px 0", borderBottom: "1px solid var(--mfc-border)" }}>
              <span className="small"><I.IconComment size={12} /> <strong>{c.author}</strong> <span className="muted">· {c.project} · {new Date(c.created_at).toLocaleString()}</span>{c.resolved ? " ✓" : ""}</span>
              <span className="small ellipsis">{c.body}</span>
            </Link>
          ))}
        </div>
        <p className="hint">{t("collab.howTo")}</p>
      </div>
    </div>
  );
}
