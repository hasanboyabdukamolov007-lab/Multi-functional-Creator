import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../../lib/api";
import { useSession } from "../../lib/session";
import { useT } from "../../lib/i18n";
import { IconSpinner } from "../../ui/icons";

export default function VerifyPage() {
  const t = useT();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const refresh = useSession((s) => s.refresh);
  const [error, setError] = useState<string | null>(null);
  const once = useRef(false);

  useEffect(() => {
    if (once.current) return;
    once.current = true;
    const token = params.get("token") ?? "";
    api
      .post("/api/auth/verify", { token })
      .then(async () => {
        await refresh();
        const next = sessionStorage.getItem("mfc.next");
        sessionStorage.removeItem("mfc.next");
        navigate(next && next.startsWith("/") && !next.startsWith("//") ? next : "/", { replace: true });
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : t("common.error")));
  }, [params, navigate, refresh, t]);

  return (
    <div className="auth-wrap">
      <div className="card auth-card" style={{ padding: 28, textAlign: "center" }}>
        {error ? (
          <div className="col" style={{ gap: 12 }}>
            <h1 style={{ fontSize: 20 }}>{t("login.failed")}</h1>
            <p className="muted">{error}</p>
            <Link className="btn btn-primary" to="/login">
              {t("login.again")}
            </Link>
          </div>
        ) : (
          <div className="row" style={{ justifyContent: "center" }}>
            <IconSpinner className="spin" size={18} /> {t("login.verifying")}
          </div>
        )}
      </div>
    </div>
  );
}
