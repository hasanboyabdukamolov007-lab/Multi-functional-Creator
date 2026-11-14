import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useT } from "../lib/i18n";
import * as I from "../ui/icons";

interface Item { id: string; kind: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string }

/** Mentions and replies, polled every minute and on focus. */
export function NotificationBell() {
  const t = useT();
  const navigate = useNavigate();
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const load = () => void api.get<{ items: Item[]; unread: number }>("/api/notifications").then((r) => (setItems(r.items), setUnread(r.unread))).catch(() => undefined);
  useEffect(() => {
    load();
    const timer = setInterval(load, 60_000);
    window.addEventListener("focus", load);
    return () => (clearInterval(timer), window.removeEventListener("focus", load));
  }, []);
  const markAll = () => void api.post("/api/notifications/read", {}).then(load);
  return (
    <div style={{ position: "relative" }}>
      <button className="icon-btn" aria-label={t("notif.title", { n: unread })} title={t("notif.title", { n: unread })} onClick={() => setOpen(!open)} style={{ position: "relative" }}>
        <I.IconBell size={17} />
        {unread > 0 && <span className="bell-badge">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="modal" style={{ position: "absolute", right: 0, top: 38, width: "min(360px, calc(100vw - 24px))", padding: 8, zIndex: 50, maxHeight: "70vh" }} onMouseLeave={() => setOpen(false)}>
          <div className="row" style={{ padding: "4px 6px" }}><strong className="grow">{t("notif.heading")}</strong>{unread > 0 && <button className="btn btn-sm btn-ghost" onClick={markAll}>{t("notif.markAll")}</button>}</div>
          {items.length === 0 && <div className="hint" style={{ padding: 8 }}>{t("notif.empty")}</div>}
          {items.map((n) => (
            <button key={n.id} className="list-item" style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", width: "100%", border: 0, background: n.read_at ? "none" : "var(--mfc-accent-soft)", textAlign: "left", color: "inherit", gap: 2 }}
              onClick={() => { void api.post("/api/notifications/read", { ids: [n.id] }).then(load); setOpen(false); if (n.link) navigate(n.link); }}>
              <span className="small"><strong>{n.title}</strong></span>
              {n.body && <span className="small muted ellipsis" style={{ maxWidth: "100%" }}>{n.body}</span>}
              <span className="small muted">{new Date(n.created_at).toLocaleString()}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
