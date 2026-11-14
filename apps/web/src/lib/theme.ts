import { create } from "zustand";
import { load, save } from "./storage";

export interface ThemeTokens {
  bg: string;
  surface: string;
  surface2: string;
  elevated: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  accentText: string;
  success: string;
  warning: string;
  danger: string;
  radius: number;
  font: string;
  mono: string;
  density: number;
  blur: number;
  scheme: "dark" | "light";
}

export interface Theme {
  id: string;
  name: string;
  builtIn?: boolean;
  tokens: ThemeTokens;
}

const SANS = `"Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
const MONO = `"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;

const dark = (o: Partial<ThemeTokens>): ThemeTokens => ({
  bg: "#0b0d12", surface: "#12151c", surface2: "#181c25", elevated: "#1e2330", border: "#272d3a", text: "#e8ebf2", muted: "#8b93a7",
  accent: "#6d5efc", accentText: "#ffffff", success: "#2fbf71", warning: "#f2a93b", danger: "#f0525d", radius: 10, font: SANS, mono: MONO, density: 1, blur: 0, scheme: "dark", ...o,
});
const light = (o: Partial<ThemeTokens>): ThemeTokens => ({
  bg: "#f5f6f9", surface: "#ffffff", surface2: "#f0f2f6", elevated: "#ffffff", border: "#dfe3ea", text: "#151821", muted: "#5d6578",
  accent: "#5b4cf0", accentText: "#ffffff", success: "#178a50", warning: "#b86e00", danger: "#d1303c", radius: 10, font: SANS, mono: MONO, density: 1, blur: 0, scheme: "light", ...o,
});

export const BUILT_IN_THEMES: Theme[] = [
  { id: "midnight-pro", name: "Midnight Pro", tokens: dark({}) },
  { id: "daylight", name: "Daylight", tokens: light({}) },
  { id: "graphite", name: "Graphite", tokens: dark({ bg: "#111111", surface: "#181818", surface2: "#1f1f1f", elevated: "#252525", border: "#2e2e2e", accent: "#e5e5e5", accentText: "#111111", muted: "#8a8a8a", radius: 6 }) },
  { id: "aurora-glass", name: "Aurora Glass", tokens: dark({ bg: "#070b1a", surface: "rgba(22,28,52,0.62)", surface2: "rgba(30,38,70,0.55)", elevated: "rgba(36,44,82,0.78)", border: "rgba(120,140,255,0.18)", accent: "#7c5cff", muted: "#97a0c3", blur: 18, radius: 14 }) },
  { id: "nordic-frost", name: "Nordic Frost", tokens: dark({ bg: "#1f2430", surface: "#262c3a", surface2: "#2c3344", elevated: "#323a4d", border: "#3b4357", text: "#e5e9f0", muted: "#9aa3b5", accent: "#88c0d0", accentText: "#1f2430", success: "#a3be8c", warning: "#ebcb8b", danger: "#bf616a" }) },
  { id: "solar-dawn", name: "Solar Dawn", tokens: light({ bg: "#fdf6e3", surface: "#fffaf0", surface2: "#f6eed8", elevated: "#fffdf7", border: "#e6dcc0", text: "#3a3326", muted: "#7a6f57", accent: "#d9480f", accentText: "#ffffff" }) },
  { id: "forest", name: "Forest", tokens: dark({ bg: "#0c1410", surface: "#111c16", surface2: "#16241c", elevated: "#1b2c22", border: "#24382c", accent: "#3ecf8e", accentText: "#06120c", muted: "#8aa596" }) },
  { id: "deep-ocean", name: "Deep Ocean", tokens: dark({ bg: "#06121f", surface: "#0b1b2c", surface2: "#102338", elevated: "#152b44", border: "#1d3754", accent: "#2f9bff", muted: "#86a1bd" }) },
  { id: "rose-quartz", name: "Rose Quartz", tokens: light({ bg: "#fbf5f7", surface: "#ffffff", surface2: "#f7eef2", border: "#efdde4", text: "#2b1c23", muted: "#7b6370", accent: "#d6336c", radius: 14 }) },
  { id: "cyber-neon", name: "Cyber Neon", tokens: dark({ bg: "#05040a", surface: "#0d0b17", surface2: "#141123", elevated: "#1a1630", border: "#2a2350", accent: "#00f0ff", accentText: "#05040a", success: "#39ff88", warning: "#ffd600", danger: "#ff2e88", muted: "#9b93c9", radius: 4 }) },
  { id: "paper", name: "Paper", tokens: light({ bg: "#f3f1ec", surface: "#fbfaf7", surface2: "#efece5", border: "#dcd7cc", text: "#22201c", muted: "#6b665c", accent: "#2b2a26", accentText: "#fbfaf7", radius: 4, font: `"Iowan Old Style", Georgia, "Times New Roman", serif` }) },
  { id: "high-contrast", name: "High Contrast", tokens: dark({ bg: "#000000", surface: "#000000", surface2: "#0a0a0a", elevated: "#111111", border: "#ffffff", text: "#ffffff", muted: "#d0d0d0", accent: "#ffd400", accentText: "#000000", radius: 4 }) },
].map((t) => ({ ...t, builtIn: true }));

export const DEFAULT_THEME = "midnight-pro";

export function applyTheme(tokens: ThemeTokens) {
  const r = document.documentElement.style;
  const set = (k: string, v: string) => r.setProperty(`--mfc-${k}`, v);
  set("bg", tokens.bg);
  set("surface", tokens.surface);
  set("surface-2", tokens.surface2);
  set("elevated", tokens.elevated);
  set("border", tokens.border);
  set("text", tokens.text);
  set("muted", tokens.muted);
  set("accent", tokens.accent);
  set("accent-text", tokens.accentText);
  set("success", tokens.success);
  set("warning", tokens.warning);
  set("danger", tokens.danger);
  set("radius", `${tokens.radius}px`);
  set("font", tokens.font);
  set("mono", tokens.mono);
  set("density", String(tokens.density));
  set("blur", `${tokens.blur}px`);
  document.documentElement.dataset.scheme = tokens.scheme;
  document.documentElement.style.colorScheme = tokens.scheme;
}

interface ThemeState {
  activeId: string;
  custom: Theme[];
  /** Live, unsaved edits from the theme editor. */
  draft: ThemeTokens | null;
  all: () => Theme[];
  active: () => Theme;
  setActive: (id: string) => void;
  setDraft: (t: ThemeTokens | null) => void;
  saveCustom: (name: string, tokens: ThemeTokens) => Theme;
  removeCustom: (id: string) => void;
  importTheme: (json: string) => Theme;
  /** Pick dark/light automatically from the device setting (phones switching at sunset, etc.). */
  followSystem: boolean;
  setFollowSystem: (v: boolean) => void;
}

export const useTheme = create<ThemeState>((set, get) => ({
  activeId: load("mfc.theme", DEFAULT_THEME),
  custom: load<Theme[]>("mfc.customThemes", []),
  draft: null,
  all: () => [...BUILT_IN_THEMES, ...get().custom],
  active: () => get().all().find((t) => t.id === get().activeId) ?? BUILT_IN_THEMES[0],
  setActive: (id) => {
    save("mfc.theme", id);
    save("mfc.theme.system", false);
    set({ activeId: id, draft: null, followSystem: false });
  },
  followSystem: load("mfc.theme.system", false),
  setFollowSystem: (v) => {
    save("mfc.theme.system", v);
    set({ followSystem: v });
    if (v) syncWithSystem();
  },
  setDraft: (draft) => set({ draft }),
  saveCustom: (name, tokens) => {
    const theme: Theme = { id: `custom-${Date.now().toString(36)}`, name, tokens };
    const custom = [...get().custom, theme];
    save("mfc.customThemes", custom);
    save("mfc.theme", theme.id);
    set({ custom, activeId: theme.id, draft: null });
    return theme;
  },
  removeCustom: (id) => {
    const custom = get().custom.filter((t) => t.id !== id);
    save("mfc.customThemes", custom);
    set({ custom, ...(get().activeId === id ? { activeId: DEFAULT_THEME } : {}) });
  },
  importTheme: (json) => {
    const parsed = JSON.parse(json) as Partial<Theme>;
    if (!parsed.tokens || typeof parsed.tokens !== "object") throw new Error("Not a theme file");
    const base = BUILT_IN_THEMES[0].tokens;
    const tokens = { ...base, ...parsed.tokens } as ThemeTokens;
    return get().saveCustom(parsed.name ?? "Imported theme", tokens);
  },
}));

// Keep the document in sync with the active theme / live draft.
useTheme.subscribe((s) => applyTheme(s.draft ?? s.active().tokens));

const SYSTEM_DARK = "midnight-pro";
const SYSTEM_LIGHT = "daylight";
function syncWithSystem() {
  if (typeof window === "undefined" || !useTheme.getState().followSystem) return;
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const id = dark ? SYSTEM_DARK : SYSTEM_LIGHT;
  if (useTheme.getState().activeId !== id) useTheme.setState({ activeId: id, draft: null });
}
if (typeof window !== "undefined") {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncWithSystem);
  syncWithSystem();
}
