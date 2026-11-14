import { Suspense, lazy, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { MODULES, moduleForPath } from "../modules";
import { useT, useI18n, LOCALES, type Locale } from "../lib/i18n";
import { useUi, toast } from "../lib/ui";
import { useSession } from "../lib/session";
import { useTheme } from "../lib/theme";
import { eventToShortcut, getCtx, prettyShortcut, registry, runFunction, setNavigate } from "../lib/registry";
import { api } from "../lib/api";
import { CommandPalette } from "./CommandPalette";
import { Toasts } from "./Toasts";
import { Onboarding } from "./Onboarding";
import { ErrorBoundary } from "./ErrorBoundary";
import { ShortcutsHelp } from "./ShortcutsHelp";
import * as I from "../ui/icons";
import { useCompact } from "../lib/media";
import { usePwa } from "../lib/pwa";
import { ask, DialogHost } from "../ui/dialog";
import { useNet } from "../lib/guards";

const CopilotPanel = lazy(() => import("../modules/copilot/CopilotPanel"));

const GROUPS = [
  ["create", "nav.group.create"],
  ["ship", "nav.group.ship"],
  ["ecosystem", "nav.group.ecosystem"],
  ["admin", "nav.group.admin"],
] as const;

function isTypingTarget(el: EventTarget | null) {
  const e = el as HTMLElement | null;
  if (!e) return false;
  return e.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(e.tagName) || !!e.closest(".monaco-editor");
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const sc = eventToShortcut(e);
      const typing = isTypingTarget(e.target);
      // Palette and copilot work everywhere; others only when not typing.
      if (typing && !["mod+k", "mod+j", "mod+s"].includes(sc)) return;
      const ctx = getCtx();
      const fn = registry.list().find((f) => f.shortcut === sc && registry.isEnabled(f.id, ctx) === true);
      if (!fn) return;
      e.preventDefault();
      runFunction(fn.id).catch((err: Error) => toast(err.message, "error"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export function Shell() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const { sidebarCollapsed, toggleSidebar, copilotOpen, setCopilot, setPalette, setModule } = useUi();
  const { user, workspaces, workspaceId, setWorkspace, logout, refresh } = useSession();
  const theme = useTheme((s) => s.active());
  const { locale, setLocale } = useI18n();
  const [menu, setMenu] = useState(false);
  const compact = useCompact();
  const pwa = usePwa();
  const online = useNet((x) => x.online);

  useEffect(() => setNavigate((p) => navigate(p)), [navigate]);
  useEffect(() => setModule(moduleForPath(location.pathname).id), [location.pathname, setModule]);
  // On phones the sidebar overlays content: start collapsed and close it after navigating.
  useEffect(() => {
    if (window.matchMedia("(max-width: 900px)").matches && !useUi.getState().sidebarCollapsed) useUi.getState().toggleSidebar();
  }, [location.pathname]);
  useShortcuts();

  const newWorkspace = async () => {
    const name = (await ask(t("shell.newWorkspace")))?.trim();
    if (!name) return;
    const r = await api.post<{ workspace: { id: string } }>("/api/workspaces", { name });
    await refresh();
    setWorkspace(r.workspace.id);
  };

  return (
    <div className="shell">
      <a className="skip-link" href="#mfc-main" onClick={(e) => (e.preventDefault(), document.getElementById("mfc-main")?.focus())}>{t("shell.skip")}</a>
      <header className="topbar">
        <button className="icon-btn" onClick={toggleSidebar} aria-label="Toggle sidebar">
          <I.IconMenu size={18} />
        </button>
        <div className="brand">
          <span className="brand-mark">M</span>
          <span className="hide-sm">{t("app.name")}</span>
        </div>
        <select className="select input-sm hide-sm" style={{ width: 200, marginLeft: 8 }} value={workspaceId ?? ""} aria-label={t("shell.workspace")}
          onChange={(e) => (e.target.value === "__new" ? void newWorkspace() : setWorkspace(e.target.value))}>
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} · {w.role}
            </option>
          ))}
          <option value="__new">+ {t("shell.newWorkspace")}</option>
        </select>
        <div className="grow" />
        {compact ? (
          <button className="icon-btn" onClick={() => setPalette(true)} aria-label={t("shell.palette")}>
            <I.IconSearch size={18} />
          </button>
        ) : (
          <button className="btn" style={{ minWidth: 240, justifyContent: "space-between", color: "var(--mfc-muted)" }} onClick={() => setPalette(true)}>
            <span className="row" style={{ gap: 8 }}>
              <I.IconSearch size={15} /> {t("shell.palette")}
            </span>
            <kbd>{prettyShortcut("mod+k")}</kbd>
          </button>
        )}
        <div className="grow hide-sm" />
        <select className="select input-sm hide-sm" style={{ width: 120 }} value={locale} aria-label="Language" onChange={(e) => setLocale(e.target.value as Locale)}>
          {LOCALES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.native}
            </option>
          ))}
        </select>
        <button className="icon-btn" title={theme.name} aria-label="Toggle light/dark theme" onClick={() => runFunction("theme.toggle-scheme")}>
          {theme.tokens.scheme === "dark" ? <I.IconMoon size={17} /> : <I.IconSun size={17} />}
        </button>
        <button className={`btn ${copilotOpen ? "btn-primary" : ""}`} onClick={() => setCopilot(!copilotOpen)} title={`${t("shell.toggleCopilot")} (${prettyShortcut("mod+j")})`}>
          <I.IconSparkles size={15} /> <span className="hide-xs">Forge</span>
        </button>
        <div style={{ position: "relative" }}>
          <button className="icon-btn" onClick={() => setMenu(!menu)} aria-label="Account" title={user?.email}>
            <span className="brand-mark" style={{ width: 26, height: 26, fontSize: 12 }}>
              {(user?.name ?? user?.email ?? "?")[0].toUpperCase()}
            </span>
          </button>
          {menu && (
            <div className="modal" style={{ position: "absolute", right: 0, top: 38, width: 260, padding: 8, zIndex: 50 }} onMouseLeave={compact ? undefined : () => setMenu(false)}>
              <div className="small muted ellipsis" style={{ padding: "6px 8px" }}>
                {user?.email}
              </div>
              {compact && (
                <div className="col" style={{ gap: 6, padding: "4px 8px 8px" }}>
                  <select className="select input-sm" value={workspaceId ?? ""} aria-label={t("shell.workspace")} onChange={(e) => (e.target.value === "__new" ? void newWorkspace() : setWorkspace(e.target.value))}>
                    {workspaces.map((w) => (
                      <option key={w.id} value={w.id}>{w.name} · {w.role}</option>
                    ))}
                    <option value="__new">+ {t("shell.newWorkspace")}</option>
                  </select>
                  <select className="select input-sm" value={locale} aria-label="Language" onChange={(e) => setLocale(e.target.value as Locale)}>
                    {LOCALES.map((l) => <option key={l.id} value={l.id}>{l.native}</option>)}
                  </select>
                </div>
              )}
              {pwa.installable && (
                <button className="nav-item" onClick={() => (setMenu(false), void pwa.install())}>
                  <I.IconDownload size={16} /> {t("pwa.install")}
                </button>
              )}
              <button className="nav-item" onClick={() => (setMenu(false), navigate("/settings"))}>
                <I.IconSettings size={16} /> {t("nav.settings")}
              </button>
              <button className="nav-item" onClick={() => (setMenu(false), void logout().then(() => navigate("/login")))}>
                <I.IconLogout size={16} /> {t("shell.signOut")}
              </button>
            </div>
          )}
        </div>
      </header>

      {compact && !sidebarCollapsed && <div className="drawer-backdrop" onClick={toggleSidebar} aria-hidden="true" />}
      {compact && menu && <div className="drawer-backdrop transparent" onClick={() => setMenu(false)} aria-hidden="true" />}
      <nav className={`sidebar ${sidebarCollapsed ? "collapsed" : ""}`} aria-label="Modules">
        {GROUPS.map(([g, key]) => (
          <div key={g}>
            <div className="nav-group-title">{t(key)}</div>
            {MODULES.filter((m) => m.group === g).map((m) => (
              <NavLink key={m.id} to={m.path} end={m.path === "/"} className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`} title={t(m.labelKey)}>
                <m.icon size={18} />
                <span className="nav-label">{t(m.labelKey)}</span>
                {m.phase > 1 && <span className="nav-badge">P{m.phase}</span>}
              </NavLink>
            ))}
          </div>
        ))}
        <div className="grow" />
        <div className="nav-label small muted" style={{ padding: "0 8px" }}>
          {t("common.functions", { n: registry.size })}
        </div>
      </nav>

      <main className="main" id="mfc-main" tabIndex={-1}>
        {!online && (
          <div className="update-bar offline-bar" role="alert">
            <I.IconWarning size={15} /> <span className="grow">{t("net.offline")}</span>
          </div>
        )}
        {pwa.updateReady && (
          <div className="update-bar" role="status">
            <I.IconSparkles size={15} /> <span className="grow">{t("pwa.update")}</span>
            <button className="btn btn-sm btn-primary" onClick={pwa.applyUpdate}>{t("pwa.reload")}</button>
          </div>
        )}
        <ErrorBoundary resetKey={location.pathname}>
          <Suspense fallback={<div className="page muted">{t("common.loading")}</div>}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>

      {copilotOpen && (
        <aside className="copilot-dock" aria-label="Copilot">
          <ErrorBoundary compact>
            <Suspense fallback={<div className="page muted">{t("common.loading")}</div>}>
              <CopilotPanel />
            </Suspense>
          </ErrorBoundary>
        </aside>
      )}

      <CommandPalette />
      <DialogHost />
      <Onboarding />
      <ShortcutsHelp />
      <Toasts />
    </div>
  );
}
