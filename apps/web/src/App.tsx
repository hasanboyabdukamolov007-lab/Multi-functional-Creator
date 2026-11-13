import { Suspense, lazy, useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { MODULES } from "./modules";
import { Shell } from "./shell/Shell";
import { useSession } from "./lib/session";
import { useT } from "./lib/i18n";

const LoginPage = lazy(() => import("./modules/auth/LoginPage"));
const VerifyPage = lazy(() => import("./modules/auth/VerifyPage"));

function Protected({ children }: { children: React.ReactNode }) {
  const status = useSession((s) => s.status);
  const t = useT();
  if (status === "loading") return <div className="auth-wrap muted">{t("common.loading")}</div>;
  if (status === "anon") return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const refresh = useSession((s) => s.refresh);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <BrowserRouter>
      <Suspense fallback={null}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/auth/verify" element={<VerifyPage />} />
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
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
