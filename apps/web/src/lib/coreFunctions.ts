import { MODULES } from "../modules";
import { registry, type AppFunction } from "./registry";
import { BUILT_IN_THEMES, useTheme, type ThemeTokens } from "./theme";
import { LOCALES, t, useI18n } from "./i18n";
import { useUi, toast } from "./ui";
import { useSession } from "./session";
import { api } from "./api";
import { downloadText, pickFile, slugify } from "./download";

export function registerCoreFunctions() {
  const fns: AppFunction[] = [];

  // Navigation — one per module.
  for (const m of MODULES) {
    fns.push({
      id: `nav.${m.id}`,
      title: `Go to ${m.id}`,
      titleKey: "nav.goto",
      titleArgs: { name: m.labelKey },
      category: "Navigate",
      keywords: [m.id, ...(m.keywords ?? [])],
      run: (_a, ctx) => ctx.navigate(m.path),
    });
  }

  // Panel UI
  fns.push(
    { id: "ui.palette", title: "Open command palette", category: "Panel", shortcut: "mod+k", ai: false, run: () => useUi.getState().setPalette(!useUi.getState().paletteOpen) },
    { id: "ui.copilot.toggle", title: "Toggle Forge copilot", category: "Panel", shortcut: "mod+j", ai: false, run: () => useUi.getState().setCopilot(!useUi.getState().copilotOpen) },
    { id: "ui.sidebar.toggle", title: "Toggle sidebar", category: "Panel", shortcut: "mod+b", run: () => useUi.getState().toggleSidebar() },
    { id: "ui.onboarding", title: "Show the welcome tour", category: "Panel", keywords: ["help", "tour", "onboarding"], ai: false, run: () => useUi.getState().setOnboarding(true) },
    { id: "ui.fullscreen", title: "Toggle full screen", category: "Panel", ai: false, run: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()) },
  );

  // Themes
  for (const th of BUILT_IN_THEMES) {
    fns.push({ id: `theme.apply.${th.id}`, title: `Theme: ${th.name}`, category: "Appearance", keywords: ["theme", "color", th.tokens.scheme], run: () => useTheme.getState().setActive(th.id) });
  }
  fns.push(
    {
      id: "theme.toggle-scheme",
      title: "Toggle light / dark theme",
      category: "Appearance",
      shortcut: "mod+shift+l",
      run: () => {
        const cur = useTheme.getState().active();
        useTheme.getState().setActive(cur.tokens.scheme === "dark" ? "daylight" : "midnight-pro");
      },
    },
    { id: "theme.editor", title: "Open theme editor", category: "Appearance", run: (_a, ctx) => ctx.navigate("/settings?tab=appearance") },
    {
      id: "theme.export",
      title: "Export current theme (JSON)",
      category: "Appearance",
      ai: false,
      run: () => {
        const th = useTheme.getState().active();
        downloadText(`${slugify(th.name)}.theme.json`, JSON.stringify({ name: th.name, tokens: th.tokens }, null, 2), "application/json");
      },
    },
    {
      id: "theme.import",
      title: "Import theme (JSON)",
      category: "Appearance",
      ai: false,
      run: async () => {
        const f = await pickFile(".json,application/json");
        if (!f) return;
        const th = useTheme.getState().importTheme(await f.text());
        toast(`Theme "${th.name}" imported`, "success");
      },
    },
    {
      id: "theme.create",
      title: "Create and apply a custom theme",
      category: "Appearance",
      params: {
        type: "object",
        properties: {
          name: { type: "string" },
          tokens: {
            type: "object",
            description: "Any of: bg, surface, surface2, elevated, border, text, muted, accent, accentText, success, warning, danger (CSS colors), radius (px number), density (0.8-1.3), blur (px), scheme ('dark'|'light'), font (CSS font-family)",
          },
        },
        required: ["name", "tokens"],
      },
      run: (a) => {
        const base = useTheme.getState().active().tokens;
        const th = useTheme.getState().saveCustom(String(a.name), { ...base, ...(a.tokens as object) });
        return { id: th.id, name: th.name };
      },
    },
  );

  // Language
  for (const l of LOCALES) {
    fns.push({ id: `lang.${l.id}`, title: `Language: ${l.label} (${l.native})`, category: "Language", keywords: ["language", "locale", "til", "язык"], run: () => useI18n.getState().setLocale(l.id) });
  }

  // Workspace & account
  fns.push(
    {
      id: "workspace.create",
      title: "Create a workspace",
      category: "Workspace",
      params: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
      run: async (a) => {
        const r = await api.post<{ workspace: { id: string } }>("/api/workspaces", { name: a.name });
        await useSession.getState().refresh();
        useSession.getState().setWorkspace(r.workspace.id);
        return r.workspace;
      },
    },
    { id: "workspace.members", title: "Manage workspace members", category: "Workspace", run: (_a, ctx) => ctx.navigate("/settings?tab=workspace") },
    { id: "workspace.ai-settings", title: "Configure the AI copilot", category: "Workspace", run: (_a, ctx) => ctx.navigate("/settings?tab=ai") },
    { id: "account.logout", title: "Sign out", category: "Account", ai: false, run: async (_a, ctx) => (await useSession.getState().logout(), ctx.navigate("/login")) },
  );

  registry.register(fns);
}

/** Resolve "nav.goto" titles: "Go to {name}" with a translated module name. */
export function navTitle(labelKey: string) {
  return t("nav.goto", { name: t(labelKey) });
}

/** Panel density and corner presets applied to the active theme as a live customization. */
export function registerPanelTweaks() {
  const tweak = (patch: Partial<ThemeTokens>) => () => {
    const st = useTheme.getState();
    const th = st.active();
    st.saveCustom(`${th.name} (custom)`, { ...th.tokens, ...patch });
  };
  registry.register([
    { id: "panel.density.compact", title: "Panel density: compact", category: "Appearance", run: tweak({ density: 0.85 }) },
    { id: "panel.density.comfortable", title: "Panel density: comfortable", category: "Appearance", run: tweak({ density: 1.15 }) },
    { id: "panel.corners.sharp", title: "Panel corners: sharp", category: "Appearance", run: tweak({ radius: 3 }) },
    { id: "panel.corners.round", title: "Panel corners: round", category: "Appearance", run: tweak({ radius: 16 }) },
  ]);
}
