import { create } from "zustand";
import { load, save } from "./storage";

export interface Toast {
  id: number;
  kind: "info" | "success" | "error" | "warning";
  text: string;
  /** Optional button: an i18n key for its label and an in-app path. */
  action?: { labelKey: string; href: string };
}

interface UiState {
  paletteOpen: boolean;
  copilotOpen: boolean;
  onboardingOpen: boolean;
  sidebarCollapsed: boolean;
  /** Studio mode: only the modules a web studio sells with (the rest stay reachable from the palette). */
  focus: boolean;
  setFocus: (v: boolean) => void;
  module: string;
  toasts: Toast[];
  setPalette: (v: boolean) => void;
  setCopilot: (v: boolean) => void;
  setOnboarding: (v: boolean) => void;
  toggleSidebar: () => void;
  setModule: (m: string) => void;
  toast: (text: string, kind?: Toast["kind"], action?: Toast["action"]) => void;
  dismiss: (id: number) => void;
}

let toastSeq = 0;

export const useUi = create<UiState>((set, get) => ({
  paletteOpen: false,
  copilotOpen: load("mfc.copilotOpen", false),
  onboardingOpen: !load("mfc.onboarded", false),
  sidebarCollapsed: load("mfc.sidebarCollapsed", false),
  focus: load("mfc.focus", false),
  setFocus: (focus) => {
    save("mfc.focus", focus);
    set({ focus });
  },
  module: "home",
  toasts: [],
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setCopilot: (copilotOpen) => {
    save("mfc.copilotOpen", copilotOpen);
    set({ copilotOpen });
  },
  setOnboarding: (onboardingOpen) => {
    if (!onboardingOpen) save("mfc.onboarded", true);
    set({ onboardingOpen });
  },
  toggleSidebar: () => {
    const v = !get().sidebarCollapsed;
    save("mfc.sidebarCollapsed", v);
    set({ sidebarCollapsed: v });
  },
  setModule: (module) => set({ module }),
  toast: (text, kind = "info", action) => {
    const id = ++toastSeq;
    // Plan-limit errors from the server get an "Upgrade" button wherever they're shown.
    if (!action && kind === "error" && /Settings → Billing/.test(text)) action = { labelKey: "billing.upgrade", href: "/settings?tab=billing" };
    set({ toasts: [...get().toasts, { id, kind, text, action }].slice(-5) });
    setTimeout(() => get().dismiss(id), kind === "error" || action ? 8000 : 3500);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = (text: string, kind?: Toast["kind"], action?: Toast["action"]) => useUi.getState().toast(text, kind, action);

/** Copy text to the clipboard; never throws (some browsers deny clipboard access). */
export async function copyText(text: string, okMessage?: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    if (okMessage) toast(okMessage, "success");
    return true;
  } catch {
    // Fallback for denied permissions / insecure contexts.
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      if (ok) {
        if (okMessage) toast(okMessage, "success");
        return true;
      }
    } catch {
      /* ignore */
    }
    toast("Couldn't access the clipboard — select the text and copy it manually.", "warning");
    return false;
  }
}
