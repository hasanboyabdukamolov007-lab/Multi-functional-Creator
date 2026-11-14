import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useT } from "../../lib/i18n";
import { toast, copyText } from "../../lib/ui";
import { confirmDialog } from "../../ui/dialog";
import { useBuilder } from "../builder/store";
import { n } from "../builder/model";
import { mediaApi, uploadFile, fmtSize, type Asset } from "./mediaApi";
import { ImageEditor } from "./ImageEditor";
import { VectorEditor } from "./VectorEditor";
import { BrandKit } from "./BrandKit";
import { Icons, Fonts } from "./IconsFonts";
import * as I from "../../ui/icons";

type Tab = "assets" | "image" | "vector" | "brand" | "icons" | "fonts";

function Assets({ t, onEdit }: { t: (k: string, v?: Record<string, string | number>) => string; onEdit: (a: Asset) => void }) {
  const [list, setList] = useState<Asset[]>([]);
  const [usage, setUsage] = useState({ used: 0, quota: 1 });
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const builderOpen = useBuilder((s) => !!s.projectId);
  const reload = useCallback(() => void mediaApi.list({ q, kind }).then((r) => (setList(r.assets), setUsage({ used: r.used, quota: r.quota }))).catch(() => setList([])), [q, kind]);
  useEffect(reload, [reload]);
  const upload = async (files: File[]) => {
    setBusy(true);
    let saved = 0;
    try {
      for (const f of files) saved += (await uploadFile(f)).saved;
      toast(saved > 0 ? t("media.uploadedSaved", { n: files.length, saved: fmtSize(saved) }) : t("media.uploaded", { n: files.length }), "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
      reload();
    }
  };
  const abs = (a: Asset) => `${location.origin}${a.url}`;
  const insert = (a: Asset) => {
    const st = useBuilder.getState();
    if (a.mime.startsWith("image/")) st.insert(n("image", { src: abs(a), alt: a.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ") }));
    else if (a.mime.startsWith("video/")) st.insert(n("video", { src: abs(a), controls: true }));
    else return toast(t("media.cantInsert"), "warning");
    toast(t("media.icons.inserted"), "success");
  };
  return (
    <div className="col" style={{ gap: 12 }}
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); void upload([...e.dataTransfer.files]); }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <input className="input" style={{ maxWidth: 260 }} placeholder={t("common.search")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("common.search")} />
        <select className="select" style={{ width: 150 }} value={kind} onChange={(e) => setKind(e.target.value)} aria-label={t("media.kind")}>
          <option value="">{t("home.allKinds")}</option><option value="image">{t("media.k.image")}</option><option value="model">3D</option><option value="video">{t("media.k.video")}</option><option value="font">{t("media.k.font")}</option><option value="application">{t("media.k.other")}</option>
        </select>
        <div className="grow" />
        <span className="small muted">{fmtSize(usage.used)} / {fmtSize(usage.quota)}</span>
        <label className="btn btn-primary" style={{ cursor: "pointer" }}>
          {busy ? <I.IconSpinner size={14} className="spin" /> : <I.IconUpload size={14} />} {t("media.upload")}
          <input type="file" multiple hidden onChange={(e) => e.target.files && void upload([...e.target.files])} />
        </label>
      </div>
      <div className={`empty ${over ? "drop-over" : ""}`} style={{ padding: 16 }}>{t("media.dropHint")}</div>
      {list.length === 0 && <div className="hint">{t("media.noAssets")}</div>}
      <div className="asset-grid">
        {list.map((a) => (
          <div key={a.id} className="card asset-card">
            <div className="asset-thumb checker">
              {a.mime.startsWith("image/") ? <img src={a.url} alt={a.name} loading="lazy" /> : a.mime.startsWith("video/") ? <video src={a.url} muted /> : <span className="muted" style={{ fontSize: 28 }}>{a.mime.startsWith("model/") ? "🧊" : a.mime.startsWith("font/") ? "Aa" : "📄"}</span>}
            </div>
            <div className="small ellipsis" title={a.name}><strong>{a.name}</strong></div>
            <div className="small muted">{fmtSize(a.size)}{a.width ? ` · ${a.width}×${a.height}` : ""}</div>
            <div className="row" style={{ gap: 2 }}>
              <button className="icon-btn" title={t("media.copyUrl")} aria-label={t("media.copyUrl")} onClick={() => void copyText(abs(a), t("common.copied"))}><I.IconCopy size={13} /></button>
              {a.mime.startsWith("image/") && a.mime !== "image/svg+xml" && <button className="icon-btn" title={t("media.edit")} aria-label={t("media.edit")} onClick={() => onEdit(a)}><I.IconPencil size={13} /></button>}
              <button className="icon-btn" disabled={!builderOpen} title={builderOpen ? t("media.insert") : t("builder.openProject")} aria-label={t("media.insert")} onClick={() => insert(a)}><I.IconBuilder size={13} /></button>
              <a className="icon-btn" href={a.url} target="_blank" rel="noopener noreferrer" aria-label={t("common.open")}><I.IconExternal size={13} /></a>
              <div className="grow" />
              <button className="icon-btn" aria-label={t("common.delete")} onClick={() => void confirmDialog(t("media.deleteConfirm"), { danger: true }).then((ok): unknown => ok && mediaApi.remove(a.id).then(reload))}><I.IconTrash size={13} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function MediaPage() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) ?? "assets";
  const [editing, setEditing] = useState<{ url: string; name: string } | null>(null);
  const tabs: Array<[Tab, string, typeof I.IconHome]> = [["assets", t("media.tab.assets"), I.IconFolder], ["image", t("media.tab.image"), I.IconMedia], ["vector", t("media.tab.vector"), I.IconShapes], ["brand", t("media.tab.brand"), I.IconPalette], ["icons", t("media.tab.icons"), I.IconSparkles], ["fonts", t("media.tab.fonts"), I.IconType]];
  return (
    <div className="col" style={{ height: "100%", gap: 0 }}>
      <div className="tabs" role="tablist">
        {tabs.map(([id, label, Icon]) => <button key={id} role="tab" aria-selected={tab === id} className={`tab ${tab === id ? "active" : ""}`} onClick={() => setParams({ tab: id })}><Icon size={13} style={{ verticalAlign: -2, marginRight: 6 }} />{label}</button>)}
      </div>
      <div className="page">
        <div className="page-narrow" style={{ maxWidth: 1240 }}>
          {tab === "assets" && <Assets t={t} onEdit={(a) => (setEditing({ url: a.url, name: a.name }), setParams({ tab: "image" }))} />}
          {tab === "image" && <ImageEditor t={t} initial={editing} />}
          {tab === "vector" && <VectorEditor t={t} />}
          {tab === "brand" && <BrandKit t={t} />}
          {tab === "icons" && <Icons t={t} />}
          {tab === "fonts" && <Fonts t={t} />}
        </div>
      </div>
    </div>
  );
}
