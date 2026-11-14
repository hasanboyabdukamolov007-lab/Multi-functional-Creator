import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { ws } from "../../lib/session";
import { useT } from "../../lib/i18n";
import { copyText, toast } from "../../lib/ui";
import { confirmDialog } from "../../ui/dialog";
import { useBuilder } from "../builder/store";
import * as I from "../../ui/icons";

interface Form { id: string; name: string; channel_id: string | null; channel: string | null; leads: number; endpoint: string }
interface Lead { id: string; form_id: string; form: string; data: Record<string, string>; page: string | null; status: "new" | "contacted" | "won" | "lost"; created_at: string }
interface Channel { id: string; name: string; kind: string }
const STATUSES = ["new", "contacted", "won", "lost"] as const;

/** Orders and requests from client sites: forms that post to the panel and alert Telegram, plus a simple pipeline. */
export default function LeadsPage() {
  const t = useT();
  const navigate = useNavigate();
  const [forms, setForms] = useState<Form[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [status, setStatus] = useState("");
  const [adding, setAdding] = useState<{ name: string; channelId: string } | null>(null);
  const reload = () => {
    void api.get<{ forms: Form[] }>(ws("/forms")).then((r) => setForms(r.forms)).catch(() => setForms([]));
    void api.get<{ leads: Lead[] }>(ws(`/leads${status ? `?status=${status}` : ""}`)).then((r) => setLeads(r.leads)).catch(() => setLeads([]));
  };
  useEffect(reload, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => void api.get<{ channels: Channel[] }>(ws("/monitoring/channels")).then((r) => setChannels(r.channels)).catch(() => setChannels([])), []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adding) return;
    try {
      await api.post(ws("/forms"), { name: adding.name, channelId: adding.channelId || null });
      setAdding(null);
      reload();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };
  const insert = (f: Form) => {
    const b = useBuilder.getState();
    if (!b.projectId) return toast(t("leads.openPageFirst"), "warning");
    b.insert({ id: "", type: "leadForm", props: { title: "Buyurtma qoldiring", text: "Biz 15 daqiqa ichida qo'ng'iroq qilamiz.", fields: "Ismingiz*\nTelefon raqamingiz*\nIzoh", buttonText: "Yuborish", endpoint: f.endpoint }, style: {}, children: [] });
    toast(t("leads.inserted"), "success");
    navigate(`/builder?project=${b.projectId}`);
  };

  return (
    <div className="page">
      <div className="page-narrow col" style={{ gap: 16 }}>
        <div className="page-header" style={{ marginBottom: 0 }}>
          <div>
            <h1 className="page-title">{t("nav.leads")}</h1>
            <p className="page-subtitle">{t("leads.subtitle")}</p>
          </div>
          <button className="btn btn-primary" onClick={() => setAdding({ name: "", channelId: channels.find((c) => c.kind === "telegram")?.id ?? "" })}><I.IconPlus size={14} /> {t("leads.newForm")}</button>
        </div>

        {adding && (
          <form className="card col" style={{ gap: 10 }} onSubmit={create}>
            <input className="input" required placeholder={t("leads.formName")} value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} />
            <select className="select" value={adding.channelId} onChange={(e) => setAdding({ ...adding, channelId: e.target.value })} aria-label={t("leads.sendTo")}>
              <option value="">{t("leads.noChannel")}</option>
              {channels.map((c) => <option key={c.id} value={c.id}>{c.kind} · {c.name}</option>)}
            </select>
            {!channels.some((c) => c.kind === "telegram") && <span className="hint">{t("leads.telegramHint")} <a href="/monitoring?tab=alerts">{t("nav.monitoring")} →</a></span>}
            <div className="row" style={{ gap: 8 }}><button className="btn btn-primary">{t("common.save")}</button><button type="button" className="btn btn-ghost" onClick={() => setAdding(null)}>{t("common.cancel")}</button></div>
          </form>
        )}

        {forms.length === 0 && !adding && <div className="empty">{t("leads.noForms")}</div>}
        {forms.map((f) => (
          <div key={f.id} className="card col" style={{ gap: 8 }}>
            <div className="row wrap" style={{ gap: 8 }}>
              <strong className="grow">{f.name}</strong>
              <span className="badge">{f.channel ? `→ ${f.channel}` : t("leads.panelOnly")}</span>
              <span className="badge badge-accent">{t("leads.count", { n: f.leads })}</span>
              <button className="icon-btn" aria-label={t("common.delete")} onClick={() => void confirmDialog(t("leads.deleteForm"), { danger: true }).then((ok): unknown => ok && api.del(ws(`/forms/${f.id}`)).then(reload))}><I.IconTrash size={14} /></button>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <code className="mono small grow ellipsis" style={{ padding: "6px 8px", background: "var(--mfc-surface2)", borderRadius: 6 }}>{f.endpoint}</code>
              <button className="btn btn-sm" onClick={() => void copyText(f.endpoint, t("common.copied"))}><I.IconCopy size={13} /></button>
              <button className="btn btn-sm btn-primary" onClick={() => insert(f)}>{t("leads.insert")}</button>
            </div>
            <span className="hint">{t("leads.howTo")}</span>
          </div>
        ))}

        <div className="row wrap" style={{ gap: 8 }}>
          <strong className="grow">{t("leads.inbox")} ({leads.length})</strong>
          <select className="select" style={{ width: 170 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t("leads.status")}>
            <option value="">{t("leads.all")}</option>
            {STATUSES.map((s) => <option key={s} value={s}>{t(`leads.st.${s}`)}</option>)}
          </select>
        </div>
        {leads.length === 0 && <div className="hint">{t("leads.empty")}</div>}
        {leads.map((l) => (
          <div key={l.id} className={`card col lead-${l.status}`} style={{ gap: 6 }}>
            <div className="row wrap small" style={{ gap: 8 }}>
              <strong className="grow">{l.form}</strong>
              <span className="muted">{new Date(l.created_at).toLocaleString()}</span>
              <select className="select" style={{ width: 150, height: 30 }} value={l.status} onChange={(e) => void api.patch(ws(`/leads/${l.id}`), { status: e.target.value }).then(reload)} aria-label={t("leads.status")}>
                {STATUSES.map((s) => <option key={s} value={s}>{t(`leads.st.${s}`)}</option>)}
              </select>
              <button className="icon-btn" aria-label={t("common.delete")} onClick={() => void confirmDialog(t("common.confirm"), { danger: true }).then((ok): unknown => ok && api.del(ws(`/leads/${l.id}`)).then(reload))}><I.IconTrash size={14} /></button>
            </div>
            {Object.entries(l.data).map(([k, v]) => (
              <div key={k} className="small"><span className="muted">{k}:</span> {/^\+?[\d\s()-]{7,}$/.test(v) ? <a href={`tel:${v.replace(/[^\d+]/g, "")}`}>{v}</a> : v}</div>
            ))}
            {l.page && <span className="small muted ellipsis">{l.page}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
