import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../../lib/api";
import { useSession } from "../../lib/session";
import { useT } from "../../lib/i18n";
import { IconSpinner } from "../../ui/icons";

export default function LoginPage() {
  const t = useT();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ devLink?: string; devCode?: string } | null>(null);
  const [code, setCode] = useState("");
  const refresh = useSession((s) => s.refresh);
  const navigate = useNavigate();

  const verifyCode = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/auth/verify-code", { email, code: value });
      await refresh();
      const next = sessionStorage.getItem("mfc.next");
      sessionStorage.removeItem("mfc.next");
      navigate(next && next.startsWith("/") && !next.startsWith("//") ? next : "/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ ok: boolean; devLink?: string; devCode?: string }>("/api/auth/magic-link", { email });
      setSent({ devLink: r.devLink, devCode: r.devCode });
      setCode("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand" style={{ justifyContent: "center", marginBottom: 24, fontSize: 18 }}>
          <span className="brand-mark">M</span> {t("app.name")}
        </div>
        <div className="card" style={{ padding: 28 }}>
          {sent ? (
            <div className="col" style={{ gap: 12 }}>
              <h1 style={{ fontSize: 20 }}>{t("login.sent")}</h1>
              <p className="muted">{t("login.sentBody", { email })}</p>
              <form className="col" style={{ gap: 8 }} onSubmit={(e) => (e.preventDefault(), code.length === 6 && void verifyCode(code))}>
                <label htmlFor="code" className="small muted">{t("login.codeLabel")}</label>
                <div className="row" style={{ gap: 8 }}>
                  <input
                    id="code"
                    className="input mono code-input"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="\d{6}"
                    maxLength={6}
                    placeholder="000000"
                    value={code}
                    disabled={busy}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                      setCode(v);
                      if (v.length === 6) void verifyCode(v);
                    }}
                    aria-label={t("login.codeLabel")}
                  />
                  <button className="btn btn-primary" disabled={busy || code.length !== 6}>{busy ? <IconSpinner size={15} className="spin" /> : t("login.codeSubmit")}</button>
                </div>
                {sent.devCode && <span className="hint">{t("login.devCode", { code: sent.devCode })}</span>}
              </form>
              {error && <div className="badge badge-danger" style={{ whiteSpace: "normal" }}>{error}</div>}
              {sent.devLink && (
                <>
                  <p className="hint">{t("login.devNote")}</p>
                  <a className="btn btn-primary" href={(() => { try { const u = new URL(sent.devLink); return u.pathname + u.search; } catch { return sent.devLink; } })()}>
                    {t("login.devLink")}
                  </a>
                </>
              )}
              <button className="btn btn-ghost" onClick={() => (setSent(null), setError(null))}>
                {t("login.again")}
              </button>
            </div>
          ) : (
            <form className="col" style={{ gap: 14 }} onSubmit={submit}>
              <div>
                <h1 style={{ fontSize: 20 }}>{t("login.title")}</h1>
                <p className="muted" style={{ marginTop: 6 }}>
                  {t("login.subtitle")}
                </p>
              </div>
              <div className="field">
                <label htmlFor="email">{t("login.email")}</label>
                <input id="email" className="input" type="email" required autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              {error && <div className="badge badge-danger" style={{ whiteSpace: "normal" }}>{error}</div>}
              <button className="btn btn-primary" disabled={busy}>
                {busy && <IconSpinner size={15} className="spin" />} {t("login.send")}
              </button>
            </form>
          )}
        </div>
        <p className="muted small" style={{ textAlign: "center", marginTop: 16 }}>
          {t("app.tagline")}
        </p>
      </div>
    </div>
  );
}
