import { useState } from "react";
import { api, ApiError } from "../../lib/api";
import { useT } from "../../lib/i18n";
import { IconSpinner } from "../../ui/icons";

export default function LoginPage() {
  const t = useT();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ devLink?: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ ok: boolean; devLink?: string }>("/api/auth/magic-link", { email });
      setSent({ devLink: r.devLink });
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
              {sent.devLink && (
                <>
                  <p className="hint">{t("login.devNote")}</p>
                  <a className="btn btn-primary" href={sent.devLink}>
                    {t("login.devLink")}
                  </a>
                </>
              )}
              <button className="btn btn-ghost" onClick={() => setSent(null)}>
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
