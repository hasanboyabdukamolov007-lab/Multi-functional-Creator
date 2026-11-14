import { useEffect, useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import { api } from "../../lib/api";
import { useT } from "../../lib/i18n";
import { copyText, toast } from "../../lib/ui";
import { usePwa } from "../../lib/pwa";
import { currentSubscription, disablePush, enablePush, pushSupported } from "../../lib/push";
import { isDesktopShell, isMobileShell, onShellInfo, postToNative, type ShellInfo } from "../../lib/native";
import * as I from "../../ui/icons";

interface PushDevice {
  id: string;
  kind: "webpush" | "expo";
  label: string | null;
  created_at: string;
  last_used_at: string | null;
  endpoint: string | null;
}
export interface AppInfo {
  version: string;
  billing: boolean;
  downloads: { desktop?: string; android?: string; ios?: string };
}

/** A QR code as an SVG path (scannable in light and dark themes: always dark on white). */
export function Qr({ text, size = 168 }: { text: string; size?: number }) {
  const { path, n } = useMemo(() => {
    const q = qrcode(0, "M");
    q.addData(text);
    q.make();
    const count = q.getModuleCount();
    let d = "";
    for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) if (q.isDark(r, c)) d += `M${c + 2},${r + 2}h1v1h-1z`;
    return { path: d, n: count + 4 };
  }, [text]);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${n} ${n}`} role="img" aria-label={text} style={{ background: "#fff", borderRadius: 8 }} shapeRendering="crispEdges">
      <path d={path} fill="#111" />
    </svg>
  );
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return `${isDesktopShell() ? "Desktop app" : browser}${os ? ` on ${os}` : ""}`;
}

export default function Devices() {
  const t = useT();
  const pwa = usePwa();
  const [devices, setDevices] = useState<PushDevice[]>([]);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [subscribed, setSubscribed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const server = location.origin;
  const load = async () => {
    const r = await api.get<{ devices: PushDevice[] }>("/api/push/devices").catch(() => ({ devices: [] as PushDevice[] }));
    setDevices(r.devices);
    const sub = await currentSubscription().catch(() => null);
    setSubscribed(sub?.endpoint ?? null);
  };
  useEffect(() => {
    void load();
    void api.get<AppInfo>("/api/app-info").then(setInfo).catch(() => setInfo(null));
  }, []);

  const enable = async () => {
    setBusy(true);
    try {
      const r = await enablePush(deviceLabel());
      if (r === "enabled") toast(t("devices.pushOn"), "success");
      else toast(t(`devices.push.${r}`), "warning");
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    const r = await api.post<{ ok: boolean; sent: number }>("/api/push/test");
    toast(r.ok ? t("devices.testSent", { n: r.sent }) : t("devices.noDevices"), r.ok ? "success" : "warning");
  };

  const mobile = isMobileShell();
  const [shell, setShell] = useState<ShellInfo | null>(null);
  useEffect(() => (mobile ? onShellInfo(setShell) : undefined), [mobile]);
  return (
    <div className="col" style={{ gap: 16, maxWidth: 820 }}>
      {mobile && (
        <div className="card col" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 8 }}><I.IconPhone size={16} /><strong className="grow">{t("devices.thisApp")}</strong>{shell && <span className="badge">{shell.platform}</span>}</div>
          <label className="row small" style={{ gap: 8 }}>
            <input type="checkbox" checked={!!shell?.lock} onChange={(e) => postToNative({ type: "lock", enabled: e.target.checked })} />
            {t("devices.appLock")}
          </label>
          <div className="row"><button className="btn btn-sm" onClick={() => postToNative({ type: "change-server" })}>{t("devices.changeServer")}</button></div>
        </div>
      )}
      {/* Install / get the apps */}
      <div className="card col" style={{ gap: 12 }}>
        <strong>{t("devices.apps")}</strong>
        <div className="grid-auto" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 230px), 1fr))", gap: 10 }}>
          <div className="col app-tile">
            <div className="row" style={{ gap: 8 }}><I.IconDownload size={16} /><strong>{t("devices.pwa")}</strong></div>
            <span className="small muted">{t("devices.pwaBody")}</span>
            {pwa.installed || mobile || isDesktopShell() ? (
              <span className="badge badge-success">{t("devices.installed")}</span>
            ) : pwa.installable ? (
              <button className="btn btn-sm btn-primary" onClick={() => void pwa.install()}>{t("pwa.install")}</button>
            ) : (
              <span className="hint">{t("pwa.manual")}</span>
            )}
          </div>
          <div className="col app-tile">
            <div className="row" style={{ gap: 8 }}><I.IconLaptop size={16} /><strong>{t("devices.desktop")}</strong></div>
            <span className="small muted">{t("devices.desktopBody")}</span>
            {info?.downloads.desktop ? <a className="btn btn-sm btn-primary" href={info.downloads.desktop} target="_blank" rel="noreferrer">{t("devices.download")}</a> : <span className="hint">{t("devices.buildYourself")}</span>}
          </div>
          <div className="col app-tile">
            <div className="row" style={{ gap: 8 }}><I.IconPhone size={16} /><strong>{t("devices.mobile")}</strong></div>
            <span className="small muted">{t("devices.mobileBody")}</span>
            <div className="row wrap" style={{ gap: 6 }}>
              {info?.downloads.android && <a className="btn btn-sm btn-primary" href={info.downloads.android} target="_blank" rel="noreferrer">Android</a>}
              {info?.downloads.ios && <a className="btn btn-sm btn-primary" href={info.downloads.ios} target="_blank" rel="noreferrer">iOS</a>}
              {!info?.downloads.android && !info?.downloads.ios && <span className="hint">{t("devices.buildYourself")}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Connect another device */}
      <div className="card row wrap" style={{ gap: 16, alignItems: "flex-start" }}>
        <Qr text={server} />
        <div className="col grow" style={{ gap: 8, minWidth: 220 }}>
          <strong>{t("devices.connect")}</strong>
          <span className="small muted">{t("devices.connectBody")}</span>
          <div className="row" style={{ gap: 6 }}>
            <code className="mono small grow ellipsis" style={{ padding: "6px 8px", background: "var(--mfc-surface2)", borderRadius: 6 }}>{server}</code>
            <button className="btn btn-sm" onClick={() => void copyText(server, t("common.copied"))}><I.IconCopy size={13} /></button>
          </div>
          <span className="hint">{t("devices.codeHint")}</span>
        </div>
      </div>

      {/* Push */}
      <div className="card col" style={{ gap: 10 }}>
        <div className="row wrap" style={{ gap: 8 }}>
          <I.IconBellRing size={16} />
          <strong className="grow">{t("devices.push")}</strong>
          {!mobile && pushSupported() && !subscribed && <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void enable()}>{t("devices.enablePush")}</button>}
          {devices.length > 0 && <button className="btn btn-sm" onClick={() => void test().catch((e: Error) => toast(e.message, "error"))}>{t("devices.test")}</button>}
        </div>
        <span className="small muted">{mobile ? t("devices.pushMobile") : pushSupported() ? t("devices.pushBody") : t("devices.push.unsupported")}</span>
        {devices.length === 0 && <span className="hint">{t("devices.noDevices")}</span>}
        {devices.map((d) => {
          const here = d.kind === "webpush" && !!subscribed && d.endpoint === subscribed;
          return (
            <div key={d.id} className="row small" style={{ gap: 8 }}>
              {d.kind === "expo" ? <I.IconPhone size={15} className="muted" /> : <I.IconDesktop size={15} className="muted" />}
              <span className="grow">{d.label ?? (d.kind === "expo" ? "Mobile app" : "Browser")} {here && <span className="badge badge-success">{t("settings.thisDevice")}</span>}</span>
              <span className="muted">{d.last_used_at ? new Date(d.last_used_at).toLocaleString() : new Date(d.created_at).toLocaleDateString()}</span>
              <button
                className="icon-btn"
                aria-label={t("common.delete")}
                onClick={() => void (here ? disablePush(d.id) : api.del(`/api/push/devices/${d.id}`)).then(load)}
              >
                <I.IconTrash size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
