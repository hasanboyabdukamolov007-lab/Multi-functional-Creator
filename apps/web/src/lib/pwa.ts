import { create } from "zustand";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface PwaState {
  installable: boolean;
  installed: boolean;
  updateReady: boolean;
  install: () => Promise<boolean>;
  applyUpdate: () => void;
}

let deferred: InstallPromptEvent | null = null;
let waiting: ServiceWorker | null = null;

export const usePwa = create<PwaState>((set) => ({
  installable: false,
  installed: typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true),
  updateReady: false,
  install: async () => {
    if (!deferred) return false;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    set({ installable: false, installed: outcome === "accepted" });
    return outcome === "accepted";
  },
  applyUpdate: () => {
    waiting?.postMessage("skip-waiting");
    navigator.serviceWorker?.addEventListener("controllerchange", () => location.reload(), { once: true });
  },
}));

/** Wire install / update events. Call once at startup. */
export function initPwa() {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    usePwa.setState({ installable: true });
  });
  window.addEventListener("appinstalled", () => usePwa.setState({ installable: false, installed: true }));
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        const track = (w: ServiceWorker | null) => {
          if (!w) return;
          w.addEventListener("statechange", () => {
            if (w.state === "installed" && navigator.serviceWorker.controller) {
              waiting = w;
              usePwa.setState({ updateReady: true });
            }
          });
        };
        track(reg.installing);
        reg.addEventListener("updatefound", () => track(reg.installing));
        // Check for a new version every 30 minutes while the app stays open.
        setInterval(() => void reg.update().catch(() => undefined), 30 * 60_000);
      })
      .catch(() => undefined);
  });
}
