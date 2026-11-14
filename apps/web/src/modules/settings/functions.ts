import { registry, type AppFunction } from "../../lib/registry";
import { api } from "../../lib/api";
import { ws } from "../../lib/session";
import { enablePush, pushSupported } from "../../lib/push";

/** Platform & billing functions: plans, push, installing the apps. */
export function registerPlatformFunctions() {
  const fns: AppFunction[] = [
    { id: "billing.open", title: "Billing: plan, usage and limits", category: "Billing", keywords: ["plan", "subscription", "upgrade", "pricing", "invoice", "tarif", "obuna", "тариф", "подписка", "оплата"], run: (_a, ctx) => ctx.navigate("/settings?tab=billing") },
    {
      id: "billing.usage",
      title: "Show this workspace's usage against its plan",
      category: "Billing",
      keywords: ["limits", "quota", "how many projects"],
      run: async () => {
        const b = await api.get<{ enabled: boolean; plan: string; usage: Record<string, number>; limits: Record<string, number | null> }>(ws("/billing"));
        return { plan: b.plan, billing: b.enabled ? "on" : "off (self-hosted, unlimited)", usage: Object.fromEntries(Object.entries(b.usage).map(([k, v]) => [k, `${v} / ${b.limits[k] ?? "∞"}`])) };
      },
    },
    { id: "billing.upgrade", title: "Upgrade the workspace plan", category: "Billing", keywords: ["pro", "team", "upgrade", "buy"], ai: false, run: (_a, ctx) => ctx.navigate("/settings?tab=billing") },
    { id: "devices.open", title: "Devices & apps: desktop, mobile, push notifications", category: "Platform", keywords: ["android", "ios", "iphone", "windows", "mac", "linux", "desktop app", "mobile app", "install", "qr", "telefon", "ilova", "приложение", "телефон"], run: (_a, ctx) => ctx.navigate("/settings?tab=devices") },
    {
      id: "devices.push.enable",
      title: "Turn on push notifications on this device",
      category: "Platform",
      keywords: ["notify me", "push", "notifications", "bildirishnoma", "уведомления"],
      when: () => (pushSupported() ? true : "This browser doesn't support push — install the app or use the mobile app"),
      run: async () => {
        const r = await enablePush(navigator.userAgent.includes("Android") ? "Android browser" : "Browser");
        return r === "enabled" ? "Push notifications are on for this device." : `Couldn't enable push: ${r}`;
      },
    },
    { id: "devices.push.test", title: "Send a test push notification to my devices", category: "Platform", keywords: ["test push"], run: async () => api.post<{ ok: boolean; sent: number }>("/api/push/test") },
  ];
  registry.register(fns);
}
