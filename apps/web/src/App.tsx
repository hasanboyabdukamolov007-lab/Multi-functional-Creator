import { Suspense, lazy, useEffect } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { MODULES } from "./modules";
import { Shell } from "./shell/Shell";
import { useSession } from "./lib/session";
import { useT, translate, useI18n } from "./lib/i18n";
import { setUnauthorizedHandler } from "./lib/api";
import { toast } from "./lib/ui";
import { initNative, nativeSession } from "./lib/native";

const LoginPage = lazy(() => import("./modules/auth/LoginPage"));
const VerifyPage = lazy(() => import("./modules/auth/VerifyPage"));
const StatusPage = lazy(() => import("./modules/monitoring/StatusPage"));

function NotFound() {
  const t = useT();
  return (
    <div className="page">
      <div className="empty" style={{ maxWidth: 520, margin: "10vh auto" }}>
        <div style={{ fontSize: 48, fontWeight: 800 }}>404</div>
        <p style={{ margin: "8px 0 16px" }}>{t("notFound.body")}</p>
        <Link className="btn btn-primary" to="/">{t("notFound.home")}</Link>
      </div>
    </div>
  );
}

function Protected({ children }: { children: React.ReactNode }) {
  const status = useSession((s) => s.status);
  const t = useT();
  if (status === "loading") return <div className="auth-wrap muted">{t("common.loading")}</div>;
  if (status === "anon") {
    const here = location.pathname + location.search;
    if (here !== "/" && !here.startsWith("/login")) sessionStorage.setItem("mfc.next", here);
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

/** Connects the desktop / mobile shells: in-app links from notifications, push token, session state. */
function NativeBridge() {
  const navigate = useNavigate();
  const status = useSession((s) => s.status);
  useEffect(() => initNative(navigate), [navigate]);
  useEffect(() => {
    if (status !== "loading") nativeSession(status === "ready");
  }, [status]);
  return null;
}

export default function App() {
  const refresh = useSession((s) => s.refresh);
  useEffect(() => {
    void refresh();
    setUnauthorizedHandler(() => {
      if (useSession.getState().status !== "ready") return;
      toast(translate(useI18n.getState().locale, "auth.expired"), "warning");
      void refresh();
    });
  }, [refresh]);

  return (
    <BrowserRouter>
      <NativeBridge />
      <Suspense fallback={null}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/auth/verify" element={<VerifyPage />} />
          <Route path="/status/:slug" element={<StatusPage />} />
          <Route
            element={
              <Protected>
                <Shell />
              </Protected>
            }
          >
            {MODULES.map((m) => {
              const C = m.component!;
              return <Route key={m.id} path={m.path === "/" ? "/" : `${m.path}/*`} element={<C />} />;
            })}
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
