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

/** Connect a Telegram bot in three steps: paste the token, say hello to the bot, pick the chat. */
function TelegramWizard({ t, onDone, onClose }: { t: (k: string, v?: Record<string, string | number>) => string; onDone: () => void; onClose: () => void }) {
  const [token, setToken] = useState("");
  const [found, setFound] = useState<{ bot: string; chats: Array<{ id: string; type: string; name: string }> } | null>(null);
  const [chatId, setChatId] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  const find = () => run(async () => {
    const r = await api.post<{ bot: string; chats: Array<{ id: string; type: string; name: string }> }>(ws("/telegram/chats"), { token: token.trim() });
    setFound(r);
    if (r.chats[0] && !chatId) setChatId(r.chats[0].id);
  });
  const connect = () => run(async () => {
    await api.post(ws("/telegram/connect"), { token: token.trim(), chatId: chatId.trim() });
    toast(t("tg.connected"), "success");
    onDone();
  });
  return (
    <div className="card col" style={{ gap: 10 }}>
      <div className="row"><strong className="grow">{t("tg.title")}</strong><button className="icon-btn" aria-label={t("common.close")} onClick={onClose}><I.IconClose size={14} /></button></div>
      <ol className="small col" style={{ gap: 4, margin: 0, paddingLeft: 18 }}>
        <li>{t("tg.step1")}</li>
        <li>{t("tg.step2")}</li>
        <li>{t("tg.step3")}</li>
      </ol>
      <div className="row" style={{ gap: 6 }}>
        <input className="input mono grow" type="password" autoComplete="off" placeholder="123456789:AA…" value={token} onChange={(e) => setToken(e.target.value)} aria-label={t("tg.token")} />
        <button className="btn" disabled={busy || token.trim().length < 30} onClick={() => void find()}>{found ? t("tg.recheck") : t("tg.find")}</button>
      </div>
      {found && (
        <div className="col" style={{ gap: 6 }}>
          <span className="small">Bot: <a href={`https://t.me/${found.bot}`} target="_blank" rel="noreferrer">@{found.bot}</a></span>
          {found.chats.length === 0 && <span className="hint">{t("tg.noChats", { bot: found.bot })}</span>}
          {found.chats.map((c) => (
            <label key={c.id} className="row small" style={{ gap: 6 }}><input type="radio" name="tgchat" checked={chatId === c.id} onChange={() => setChatId(c.id)} /> {c.name} <span className="muted">· {c.type}</span></label>
          ))}
          <input className="input mono" placeholder={t("tg.manual")} value={chatId} onChange={(e) => setChatId(e.target.value)} aria-label={t("tg.manual")} />
          <div className="row"><button className="btn btn-primary" disabled={busy || !chatId.trim()} onClick={() => void connect()}>{t("tg.connect")}</button></div>
        </div>
      )}
    </div>
  );
}

/** Open the deployed Mini App from the bot's menu button. */
function MiniAppCard({ t, channels }: { t: (k: string, v?: Record<string, string | number>) => string; channels: Channel[] }) {
  const bots = channels.filter((c) => c.kind === "telegram");
  const [channelId, setChannelId] = useState(bots[0]?.id ?? "");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("Buyurtma");
  const [busy, setBusy] = useState(false);
  if (!bots.length) return null;
  const go = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ link: string }>(ws("/telegram/menu-button"), { channelId: channelId || bots[0].id, url: url.trim(), text: text.trim() || "Buyurtma" });
      toast(t("mini.done"), "success");
      window.open(r.link, "_blank", "noopener");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card col" style={{ gap: 8 }}>
      <strong>{t("mini.title")}</strong>
      <span className="hint">{t("mini.help")}</span>
      <div className="row wrap" style={{ gap: 6 }}>
        <select className="select" style={{ width: 200 }} value={channelId} onChange={(e) => setChannelId(e.target.value)} aria-label="Bot">{bots.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <input className="input grow" style={{ minWidth: 220 }} placeholder="https://mening-dokonim.vercel.app" value={url} onChange={(e) => setUrl(e.target.value)} aria-label={t("mini.url")} />
        <input className="input" style={{ width: 130 }} value={text} maxLength={30} onChange={(e) => setText(e.target.value)} aria-label={t("mini.buttonText")} />
        <button className="btn btn-primary" disabled={busy || !/^https:\/\//.test(url.trim())} onClick={() => void go()}>{t("mini.connect")}</button>
      </div>
    </div>
  );
}

/** Orders and requests from client sites: forms that post to the panel and alert Telegram, plus a simple pipeline. */
export default function LeadsPage() {
  const t = useT();
  const navigate = useNavigate();
  const [forms, setForms] = useState<Form[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [status, setStatus] = useState("");
  const [adding, setAdding] = useState<{ name: string; channelId: string } | null>(null);
  const [wizard, setWizard] = useState(false);
  const loadChannels = () => void api.get<{ channels: Channel[] }>(ws("/monitoring/channels")).then((r) => setChannels(r.channels)).catch(() => setChannels([]));
  const reload = () => {
    void api.get<{ forms: Form[] }>(ws("/forms")).then((r) => setForms(r.forms)).catch(() => setForms([]));
    void api.get<{ leads: Lead[] }>(ws(`/leads${status ? `?status=${status}` : ""}`)).then((r) => setLeads(r.leads)).catch(() => setLeads([]));
  };
  useEffect(reload, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(loadChannels, []); // eslint-disable-line react-hooks/exhaustive-deps

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
          <div className="row" style={{ gap: 6 }}>
            <button className="btn" onClick={() => setWizard(true)}><I.IconSend size={14} /> {t("tg.button")}</button>
            <button className="btn btn-primary" onClick={() => setAdding({ name: "", channelId: channels.find((c) => c.kind === "telegram")?.id ?? "" })}><I.IconPlus size={14} /> {t("leads.newForm")}</button>
          </div>
        </div>
        {wizard && <TelegramWizard t={t} onClose={() => setWizard(false)} onDone={() => (setWizard(false), loadChannels())} />}

        {adding && (
          <form className="card col" style={{ gap: 10 }} onSubmit={create}>
            <input className="input" required placeholder={t("leads.formName")} value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} />
            <select className="select" value={adding.channelId} onChange={(e) => setAdding({ ...adding, channelId: e.target.value })} aria-label={t("leads.sendTo")}>
              <option value="">{t("leads.noChannel")}</option>
              {channels.map((c) => <option key={c.id} value={c.id}>{c.kind} · {c.name}</option>)}
            </select>
            {!channels.some((c) => c.kind === "telegram") && <span className="hint">{t("leads.telegramHint")} <button type="button" className="btn btn-sm" onClick={() => setWizard(true)}>{t("tg.button")}</button></span>}
            <div className="row" style={{ gap: 8 }}><button className="btn btn-primary">{t("common.save")}</button><button type="button" className="btn btn-ghost" onClick={() => setAdding(null)}>{t("common.cancel")}</button></div>
          </form>
        )}

        <MiniAppCard t={t} channels={channels} />
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
