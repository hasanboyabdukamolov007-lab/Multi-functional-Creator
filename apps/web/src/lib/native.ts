/**
 * Bridge to the native shells.
 *  - Mobile (Expo, react-native-webview): the app injects `window.ReactNativeWebView` and talks over postMessage.
 *    It hands us its Expo push token (we register it with our own session cookie), opens notification links,
 *    and saves files we can't download inside a WebView.
 *  - Desktop (Tauri): the window loads this server directly; the shell defines `window.__MFC_DESKTOP__`
 *    before the page runs. It gets no IPC access — downloads and external links are handled natively.
 */
import { api } from "./api";

interface RNWebView {
  postMessage: (data: string) => void;
}
declare global {
  interface Window {
    ReactNativeWebView?: RNWebView;
    __mfcNative?: (msg: NativeMessage) => void;
    __MFC_DESKTOP__?: { version: string };
  }
}
type NativeMessage =
  | { type: "push-token"; token: string; label?: string }
  | { type: "open"; link: string }
  | { type: "saved"; name: string };

export const isMobileShell = () => typeof window !== "undefined" && !!window.ReactNativeWebView;
export const isDesktopShell = () => typeof window !== "undefined" && !!window.__MFC_DESKTOP__;
export const shellName = () => (isMobileShell() ? "mobile" : isDesktopShell() ? "desktop" : "web");

export function postToNative(msg: Record<string, unknown>) {
  window.ReactNativeWebView?.postMessage(JSON.stringify(msg));
}

let navigateFn: ((to: string) => void) | null = null;
let signedIn = false;
let pendingToken: { token: string; label?: string } | null = null;

const registerToken = (t: { token: string; label?: string }) =>
  api.post("/api/push/devices", { kind: "expo", token: t.token, label: t.label ?? "Mobile app" }).catch(() => undefined);

/** Call once at startup; `navigate` routes in-app links from notifications. */
export function initNative(navigate: (to: string) => void) {
  if (typeof window === "undefined") return;
  navigateFn = navigate;
  const cls = shellName();
  if (cls !== "web") document.documentElement.classList.add(`shell-${cls}`);
  if (!isMobileShell()) return;
  window.__mfcNative = (msg) => {
    if (msg.type === "push-token") {
      if (signedIn) void registerToken(msg);
      else pendingToken = msg;
    } else if (msg.type === "open" && msg.link.startsWith("/") && !msg.link.startsWith("//")) navigateFn?.(msg.link);
  };
  postToNative({ type: "ready" });
}

/** Tell the shell whether someone is signed in (it asks for push permission only then). */
export function nativeSession(isSignedIn: boolean) {
  signedIn = isSignedIn;
  if (!isMobileShell()) return;
  postToNative({ type: "session", signedIn: isSignedIn });
  if (isSignedIn && pendingToken) {
    void registerToken(pendingToken);
    pendingToken = null;
  }
}

/** In the mobile app, hand a file to the native side (share sheet / save) instead of a blob download. */
export async function saveViaNative(blob: Blob, name: string): Promise<boolean> {
  if (!isMobileShell()) return false;
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  postToNative({ type: "save", name, mime: blob.type || "application/octet-stream", base64: btoa(bin) });
  return true;
}
