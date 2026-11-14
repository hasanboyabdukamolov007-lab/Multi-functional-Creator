import { api } from "./api";

/** Web Push on this browser / installed app. Mobile apps register through the native bridge instead. */
export const pushSupported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

const b64uToBytes = (s: string) => {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export type EnableResult = "enabled" | "denied" | "unsupported" | "no-worker";

export async function enablePush(label: string): Promise<EnableResult> {
  if (!pushSupported()) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return "no-worker";
  const { publicKey } = await api.get<{ publicKey: string }>("/api/push/vapid");
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with another server key can't receive our messages.
  const key = sub?.options.applicationServerKey;
  if (sub && key && btoa(String.fromCharCode(...new Uint8Array(key))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") !== publicKey) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(publicKey) });
  await api.post("/api/push/devices", { kind: "webpush", label, subscription: sub.toJSON() });
  return "enabled";
}

export async function disablePush(deviceId?: string): Promise<void> {
  const sub = await currentSubscription();
  await sub?.unsubscribe().catch(() => false);
  if (deviceId) await api.del(`/api/push/devices/${deviceId}`).catch(() => undefined);
}
